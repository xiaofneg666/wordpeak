<script setup>
// 学习舱:新词学习三幕流(编码 → 回忆 → 巩固)——全站第一次有「教你怎么记一个词」的完整教学闭环。
// 新词来源:今日航线 /api/plan(档案驱动)→ 降级复习队列新词 → 降级词库未学词;
// 深链 openLearn(wordId) 落到指定词(词卡/家族页跳进来)。
// 认知科学设计依据见三个 Act 组件头部注释;总原则:每日 10-25 分钟短 session > 周末长突击。
import { computed, onMounted, onActivated, ref } from 'vue'
import { api } from '../api.js'
import { classifyWordState, STRENGTH_LEARN } from '../utils/wordState'
import { useUniverse } from '../stores/universe'
import EncodeAct from '../components/learn/EncodeAct.vue'
import RecallAct from '../components/learn/RecallAct.vue'
import ConsolidateAct from '../components/learn/ConsolidateAct.vue'
import EmptyState from '../components/EmptyState.vue'

const store = useUniverse()

const phase = ref('loading') // loading → idle(计划概要) → flow(三幕) → done(终幕)
const queue = ref([])        // 本场词 id 队列
const idx = ref(0)
const act = ref('encode')    // encode → recall → consolidate
const selfGrades = ref([])   // [{ wordId, kind:'known'|'fuzzy'|'unknown' }]
const startedAt = ref(0)
const actSeq = ref(0)        // 幕切换 key,保证动画重放
let deepLinked = false       // 深链指定词进来:跳过计划概要直接开

const word = computed(() => store.words.find((w) => w.id === queue.value[idx.value]) || null)
const familyWords = computed(() => {
  if (!word.value) return []
  return store.words.filter((x) => x.family === word.value.family && x.id !== word.value.id).slice(0, 6)
})
const rootStory = computed(() => (word.value ? store.rootStories[word.value.root] ?? null : null))

// 三幕的仪器刻度:三颗四芒星沿轨道连线,走完的幕升为金(点亮),当前幕呼吸
const ACTS = [
  { key: 'encode', label: '编码' },
  { key: 'recall', label: '回忆' },
  { key: 'consolidate', label: '巩固' },
]
function actPast(key) {
  const order = ['encode', 'recall', 'consolidate']
  return order.indexOf(act.value) > order.indexOf(key)
}

// 词 chip 的记忆五态着色(与圣殿星球同口径:critical/due/new/learning/mastered)。
// 分类走统一 util;learning 档里再按强度分「学习中/褪色」两档视觉
function stateCls(id) {
  const s = store.states[id]
  const k = classifyWordState(s)
  if (k === 'learning') return (s?.strength ?? 0) > STRENGTH_LEARN ? 'st-learning' : 'st-fading'
  return 'st-' + k
}

const planSummary = computed(() => {
  if (!store.plan) return null
  return {
    n: store.plan.new_words?.count ?? queue.value.length,
    minutes: store.plan.new_words?.minutes ?? Math.round(queue.value.length * 1.5),
    sleep: !!store.plan.sleep_hint,
  }
})

const gradeCount = computed(() => {
  const c = { known: 0, fuzzy: 0, unknown: 0 }
  for (const g of selfGrades.value) c[g.kind] = (c[g.kind] ?? 0) + 1
  return c
})
const unknownIds = computed(() => selfGrades.value.filter((g) => g.kind === 'unknown').map((g) => g.wordId))
const elapsedMin = computed(() =>
  startedAt.value ? Math.max(1, Math.round((Date.now() - startedAt.value) / 60000)) : 0)

// ---- 组队:本场学哪些词 ----
async function buildQueue() {
  // 航线「学 N 个新词」站带来的词数上限(消费即清,别影响下一场)
  const capN = store.pendingLearnCount || null
  if (capN) store.clearPendingLearnCount()

  // 深链指定词(词卡/家族页跳进来):只学这一个
  if (store.pendingLearnWordId) {
    const id = store.pendingLearnWordId
    store.clearPendingLearnWord()
    if (store.words.some((w) => w.id === id)) { deepLinked = true; return [id] }
  }

  // ① 今日航线的新词(档案 goal/self_level 驱动,已学的跳过)
  let plan = store.plan
  if (!plan) plan = await store.loadPlan()
  const learnedNow = (id) => {
    const s = store.states[id]
    return s && !s.is_new
  }
  let ids = (plan?.new_words?.word_ids || []).filter((id) => !learnedNow(id))
    .filter((id) => store.words.some((w) => w.id === id))
  if (ids.length) return ids.slice(0, capN ?? 8)

  // ② 降级:复习队列的新词位
  if (store.user) {
    try {
      const q = await api.reviewQueue(store.user.id, capN ?? 8)
      ids = q.filter((x) => x.is_new && !learnedNow(x.word_id)).map((x) => x.word_id)
      if (ids.length) return ids.slice(0, capN ?? 8)
    } catch { /* 后端不可达继续降级 */ }
  }

  // ③ 兜底:词库里还没学过的,按难度先易后难
  const learned = new Set(Object.keys(store.states).map(Number))
  return store.words.filter((w) => !learned.has(w.id)).slice(0, capN ?? 5).map((w) => w.id)
}

async function begin() {
  startedAt.value = Date.now()
  actSeq.value++
  act.value = 'encode'
  phase.value = 'flow'
}

// 三幕状态机推进
function nextAct() {
  if (act.value === 'encode') { act.value = 'recall'; actSeq.value++; return }
  if (act.value === 'recall') { act.value = 'consolidate'; actSeq.value++; return }
  // 巩固完毕 → 下一词或终幕
  if (idx.value + 1 < queue.value.length) { idx.value++; act.value = 'encode'; actSeq.value++ }
  else { phase.value = 'done' }
}
function onGraded(kind) {
  selfGrades.value.push({ wordId: word.value?.id, kind })
}

// 把「不认识」的词再来一轮(主动回忆:间隔极短的第二次提取也是有效练习)
function retryUnknown() {
  if (!unknownIds.value.length) return
  queue.value = [...unknownIds.value]
  idx.value = 0
  selfGrades.value = selfGrades.value.filter((g) => g.kind !== 'unknown')
  begin()
}

// 首次挂载与「回舱时带新深链」共用:组队+决定落点
async function bootstrap() {
  if (!store.words.length) {
    try { await store.loadUniverse() } catch { /* 词库不可达,idle 会给空态 */ }
  }
  if (store.user && !store.plan) store.loadPlan() // 不阻塞:idle 概要异步补
  queue.value = await buildQueue()
  if (!queue.value.length) { phase.value = 'idle'; return }
  if (deepLinked) { await begin(); return } // 单词深链:直接进第一幕
  phase.value = 'idle'
}
onMounted(bootstrap)
// KeepAlive 后 onMounted 只跑一次:回舱若带着新深链(词卡/航线),按它重开一场;
// 没有则原样保留现场——三幕进行中的进度不再被切视图清零
onActivated(async () => {
  if (store.pendingLearnWordId || store.pendingLearnCount) await bootstrap()
})
</script>

<template>
  <div class="view-scroll">
    <div class="view-inner fade-in">
      <div class="terr-head">
        <div class="terr-kicker">TERRITORY · LEARNING POD</div>
        <!-- 领地名逐字凝出(衬线三字正适合);terrRise 在 scoped 里置空,让逐字入场独占 -->
        <BlurText text="学习舱" as="h2" class="terr-title" :stagger="110" />
        <div class="terr-latin">THE LEARNING POD</div>
        <div class="terr-rule" aria-hidden="true" />
        <p class="terr-sub">
          每个新词走三幕:编码(拆词根·看故事·进语境)→ 回忆(先自己想 10 秒再翻面)→ 巩固(拼一遍、挂进同族网络)。今天学什么、学几个,由你的档案和到期词决定。
        </p>
      </div>

      <!-- loading:一颗暗星在呼吸(加载态给足仪式感,不跳动) -->
      <div v-if="phase === 'loading'" class="learn-stage learn-loading">
        <span class="ll-star" aria-hidden="true" />
        <p class="ll-text">正在为你编排今天的词…</p>
      </div>

      <!-- 计划概要:今日名单像登舱点名,逐级浮现(cascade);词 chip 再逐枚上星(stagger) -->
      <div v-else-if="phase === 'idle'" class="learn-stage learn-idle dots-host cascade">
        <span class="dots-decor dots-fade" aria-hidden="true" style="--dots-o:.3" />
        <template v-if="queue.length">
          <div class="li-count">
            <CountNum class="li-count-num" :v="queue.length" />
            <span class="li-count-unit">个新词</span>
          </div>
          <p class="li-meta">
            预计 {{ planSummary?.minutes ?? Math.round(queue.length * 1.5) }} 分钟 · {{ planSummary?.n === queue.length ? '来自你的今日航线' : '按难度先易后难' }}
          </p>
          <p v-if="planSummary?.sleep" class="li-sleep">已经晚了——睡前一小时是记忆巩固的黄金档,学完这批正好带着它们入睡</p>
          <div class="li-words stagger">
            <span
              v-for="id in queue" :key="id"
              class="li-word-chip" :class="stateCls(id)"
              :title="store.words.find((w) => w.id === id)?.meaning"
            >{{ store.words.find((w) => w.id === id)?.word }}</span>
          </div>
          <button class="btn primary li-start" @click="begin">进入第一幕 · 编码</button>
        </template>
        <EmptyState
          v-else
          icon="完" title="词库都学完了"
          desc="新词全走完三幕了——去复习队列巩固,或在词汇圣殿里点亮更多星"
        >
          <div class="li-empty-actions">
            <button class="btn primary" @click="store.openReview()">去复习队列 →</button>
            <button class="btn" @click="store.setView('galaxy')">去词汇圣殿点亮更多星 →</button>
          </div>
        </EmptyState>
      </div>

      <!-- 三幕流:learn-flow 给三幕一座「舞台底」,不再裸站页底 -->
      <div v-else-if="phase === 'flow'" class="learn-stage learn-flow">
        <!-- 顶部进度:词序 + 三幕刻度 + 退出(进度不丢,回来接着学) -->
        <div class="learn-progress">
          <span class="lp-count">第 {{ idx + 1 }} / {{ queue.length }} 个词</span>
          <div class="lp-steps" aria-hidden="true">
            <template v-for="(s, i) in ACTS" :key="s.key">
              <div class="lp-step" :class="{ active: act === s.key, past: actPast(s.key) }">
                <svg class="lp-star" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M12 3.5 13.4 10.6 20.5 12 13.4 13.4 12 20.5 10.6 13.4 3.5 12 10.6 10.6Z" /></svg>
                <span>{{ s.label }}</span>
              </div>
              <svg v-if="i < ACTS.length - 1" class="lp-link" viewBox="0 0 24 4" aria-hidden="true">
                <path class="lp-link-bg" d="M2 2 H22" />
                <path class="lp-link-lit" :class="{ lit: actPast(s.key) }" d="M2 2 H22" />
              </svg>
            </template>
          </div>
          <!-- 三幕进行中唯一的出口:此前深链进来的用户被锁在流程里,只能靠切 NavBar 弃档 -->
          <button class="btn ghost small lp-exit" @click="store.setView('dashboard')">先不学了 · 回到计划</button>
        </div>

        <component
          :is="act === 'encode' ? EncodeAct : act === 'recall' ? RecallAct : ConsolidateAct"
          :key="`${idx}-${act}-${actSeq}`"
          :word="word"
          :root-story="rootStory"
          :family-words="familyWords"
          @next="nextAct"
          @graded="onGraded"
        />
      </div>

      <!-- 终幕:结算像收束仪式,逐级浮现;计数滚上来,三档自评逐枚点亮 -->
      <div v-else-if="phase === 'done'" class="learn-stage learn-done cascade">
        <div class="ld-kicker">本场完成</div>
        <div class="ld-count">
          <CountNum class="ld-count-num" :v="selfGrades.length" />
          <span class="ld-count-unit">个词 · {{ elapsedMin }} 分钟</span>
        </div>
        <div class="ld-grades stagger">
          <span class="ld-grade known"><b>{{ gradeCount.known }}</b>认识</span>
          <span class="ld-grade fuzzy"><b>{{ gradeCount.fuzzy }}</b>模糊</span>
          <span class="ld-grade unknown"><b>{{ gradeCount.unknown }}</b>不认识</span>
        </div>
        <p class="ld-note">
          {{ gradeCount.unknown > 0
            ? '不认识的词今天就会再排给你——多见几次就熟了,别急着一次记住。'
            : '模糊和认识之间只差几次见面——FSRS 会替你盯着每个词的记忆概率,到点就排进复习。' }}
        </p>
        <div class="ld-actions">
          <button v-if="unknownIds.length" class="btn" @click="retryUnknown">把 {{ unknownIds.length }} 个不认识的再来一轮</button>
          <button class="btn primary" @click="store.openReview()">趁热去复习一轮</button>
          <button class="btn ghost" @click="store.setView('dashboard')">回到今日航线</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.learn-stage { max-width: 680px; margin: 0 auto; padding: 10px 0 40px; }

/* 三幕舞台底:hairline 边 + r-xl + 顶部极淡 accent 氛围(5%,只做内衬不提亮)——三幕「登台」有台面 */
.learn-flow {
  position: relative;
  border: 1px solid var(--line); border-radius: var(--r-xl);
  padding: 28px 24px 36px;
  background:
    radial-gradient(480px 200px at 50% -70px, color-mix(in srgb, var(--accent) 5%, transparent), transparent 70%),
    var(--surface);
}
/* 台口一道鎏金发丝线:舞台的「幕沿」,光从台口照进来 */
.learn-flow::before {
  content: ''; position: absolute; left: 24px; right: 24px; top: 0; height: 1px;
  background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--gold) 45%, transparent), transparent);
}
@media (max-width: 640px) { .learn-flow { padding: 18px 14px 28px; } }

/* 页头领地名交给 BlurText 逐字凝出:全局 .terr-title 自带的 terrRise 在此置空,避免双重入场 */
.terr-title { animation: none; }

/* loading:一颗暗星呼吸 + mono 读数(高度收拢,切换到概要/三幕不跳屏) */
.learn-loading {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 16px; min-height: 240px; padding: 40px 0;
}
.ll-star {
  width: 14px; height: 14px;
  background: var(--text-3); opacity: 0.45;
  clip-path: polygon(50% 0, 58% 42%, 100% 50%, 58% 58%, 50% 100%, 42% 58%, 0 50%, 42% 42%);
  animation: llBreath 1.8s ease-in-out infinite;
}
.ll-text {
  font-family: var(--mono); font-size: var(--fs-xs); letter-spacing: 0.2em;
  color: var(--text-3);
}
@keyframes llBreath { 0%, 100% { opacity: 0.35; transform: scale(0.9); } 50% { opacity: 0.85; transform: scale(1.1); } }

/* idle 概要:点阵铺底(今日名单的星图底纹),级联交给 .cascade */
.learn-idle {
  position: relative; text-align: center; padding-top: 26px;
  min-height: 240px;
}
/* 点阵层不参与收束级联(它是底纹,不是内容) */
.learn-idle .dots-decor { animation: none; }
.li-count { animation-delay: 0.06s; }
/* 场次计数 = 今天待点亮的星:数字直接用金 + 暖晕(预点亮),与终幕计数同一语言 */
.li-count-num {
  font-family: var(--serif);
  font-size: 64px; font-weight: 600; color: var(--gold); line-height: 1;
  font-variant-numeric: tabular-nums;
  text-shadow: 0 0 30px color-mix(in srgb, var(--gold) 25%, transparent);
}
.li-count-unit { font-size: var(--fs-md); color: var(--text-2); margin-left: 6px; }
.li-meta { font-size: var(--fs-sm); color: var(--text-3); margin: 12px 0 6px; }
.li-sleep { font-size: var(--fs-xs); color: var(--accent-3); margin-bottom: 6px; }
.li-words { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; margin: 22px 0 30px; }
/* 记忆五态着色(与圣殿星球同一口径);词用衬线——它们是词星的名字,不是界面标签;
   底沉一档 + 字号升 fs-lg:名字要够大够实,配得起衬线 */
.li-word-chip {
  font-family: var(--serif); font-size: var(--fs-lg); color: var(--text-2);
  border: 1px solid var(--line); border-radius: 999px; padding: 4px 14px;
  background: var(--surface-sunken);
  transition: transform .18s var(--ease), box-shadow .18s var(--ease);
}
/* 小 chip 的轻抬:-2px 即可,它们是名单不是主角 */
.li-word-chip:hover { transform: translateY(-2px); box-shadow: var(--shadow-sm); }
/* 记忆五态着色(与圣殿星球同一口径) */
.li-word-chip.st-new { color: var(--text-3); }
.li-word-chip.st-learning { color: var(--accent); border-color: var(--line-accent); }
.li-word-chip.st-mastered { color: var(--gold); border-color: color-mix(in srgb, var(--gold) 40%, transparent); }
.li-word-chip.st-due { color: var(--warn); border-color: color-mix(in srgb, var(--warn) 40%, transparent); }
.li-word-chip.st-critical { color: var(--danger); border-color: color-mix(in srgb, var(--danger) 40%, transparent); }
.li-word-chip.st-fading { color: var(--warn); border-color: color-mix(in srgb, var(--warn) 35%, transparent); }
/* 主 CTA 换鎏金渐变:出发与趁热是「点亮」的起手式(金),与幕内推进(青)分工;
   尺寸沿用原 primary 舱位,hover 换金光软影 */
.learn-idle .li-start,
.learn-done .ld-actions .btn.primary {
  background: linear-gradient(135deg, var(--gold), var(--gold-dim));
  border-color: transparent; color: var(--on-accent); font-weight: 600;
  font-size: var(--fs-md); padding: 11px 30px;
}
.learn-idle .li-start:hover,
.learn-done .ld-actions .btn.primary:hover {
  transform: translateY(-2px);
  box-shadow: 0 10px 28px color-mix(in srgb, var(--gold) 32%, transparent);
}
/* 晴空下 gold-dim 与 gold 同值,渐变退化为纯色——第二段用 color-mix 压暗一档,保住鎏金层次 */
[data-theme='light'] .learn-idle .li-start,
[data-theme='light'] .learn-done .ld-actions .btn.primary {
  background: linear-gradient(135deg, var(--gold), color-mix(in srgb, var(--gold) 80%, #7c3a0a));
}

.li-empty-actions { display: flex; justify-content: center; gap: 10px; flex-wrap: wrap; }

/* 三幕进度条:一档小影让轨道「浮」在舞台上;非交互件,hover 只给一档描边回应 */
.learn-progress {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  border: 1px solid var(--line); border-radius: 999px; padding: 8px 18px; margin-bottom: 30px;
  background: var(--surface);
  box-shadow: var(--shadow-sm);
  transition: border-color .25s var(--ease);
}
.learn-progress:hover { border-color: var(--line-strong); }
.lp-count { font-size: var(--fs-xs); font-family: var(--mono, monospace); color: var(--text-3); letter-spacing: 0.06em; white-space: nowrap; }
.lp-exit { white-space: nowrap; flex-shrink: 0; }
.lp-steps { display: flex; align-items: center; gap: 8px; }
.lp-step {
  display: inline-flex; align-items: center; gap: 6px;
  font-size: var(--fs-xs); letter-spacing: 0.14em; color: var(--text-3); transition: color .25s ease;
}
.lp-star { width: 13px; height: 13px; }
/* 当前幕:青色 + 星体呼吸(一颗被点亮的活星,不是流光) */
.lp-step.active { color: var(--accent); }
.lp-step.active .lp-star { animation: lpBreath 2.2s ease-in-out infinite; }
@keyframes lpBreath { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.22); } }
/* 走完的幕:金(词之心塔尖灯的同款点亮语言) */
.lp-step.past { color: var(--gold); }
.lp-step.past .lp-star path { fill: currentColor; }
/* 轨道连线:底线灰,走过的段升金 */
.lp-link { width: 26px; height: 4px; }
.lp-link path { stroke-width: 1.5; fill: none; }
.lp-link-bg { stroke: var(--line-strong); }
.lp-link-lit { stroke: transparent; transition: stroke .4s var(--ease); }
.lp-link-lit.lit { stroke: var(--gold); }

/* 终幕:收束级联由 .cascade 承担,三档计数用语义 token(暖夜下自动粉彩) */
.learn-done { text-align: center; padding-top: 30px; }
/* 终幕 kicker:两侧金四芒星收束点缀——「完成=点亮=金」的最后一记 */
.ld-kicker {
  display: flex; align-items: center; justify-content: center; gap: 14px;
  font-size: var(--fs-2xs); letter-spacing: 0.32em; color: var(--text-3);
}
.ld-kicker::before, .ld-kicker::after {
  content: ''; flex-shrink: 0; width: 7px; height: 7px; background: var(--gold); opacity: 0.75;
  clip-path: polygon(50% 0, 58% 42%, 100% 50%, 58% 58%, 50% 100%, 42% 58%, 0 50%, 42% 42%);
}
/* 终幕计数:本场的点亮总数 —— 金 + 暖晕,终幕就是一个收束的点亮仪式 */
.ld-count-num {
  font-family: var(--serif);
  font-size: 64px; font-weight: 600; color: var(--gold); line-height: 1.1;
  display: inline-block; margin: 14px 0 4px;
  font-variant-numeric: tabular-nums;
  text-shadow: 0 0 30px color-mix(in srgb, var(--gold) 25%, transparent);
}
.ld-count-unit { font-size: var(--fs-md); color: var(--text-2); }
.ld-grades { display: flex; justify-content: center; gap: 14px; margin: 24px 0 10px; flex-wrap: wrap; }
/* 三档自评 pill:各自 8% 同色底 + 同色 hairline 边——不看数字也能扫一眼分档 */
.ld-grade { display: inline-flex; align-items: baseline; font-size: var(--fs-sm); color: var(--text-2); padding: 4px 14px; border-radius: 999px; border: 1px solid transparent; }
.ld-grade b { font-size: var(--fs-xl); font-weight: 600; margin-right: 5px; font-variant-numeric: tabular-nums; }
.ld-grade.known { background: color-mix(in srgb, var(--success) 8%, transparent); border-color: color-mix(in srgb, var(--success) 28%, transparent); }
.ld-grade.fuzzy { background: color-mix(in srgb, var(--warn) 8%, transparent); border-color: color-mix(in srgb, var(--warn) 28%, transparent); }
.ld-grade.unknown { background: color-mix(in srgb, var(--danger) 8%, transparent); border-color: color-mix(in srgb, var(--danger) 28%, transparent); }
.ld-grade.known b { color: var(--success); }
.ld-grade.fuzzy b { color: var(--warn); }
.ld-grade.unknown b { color: var(--danger); }
.ld-note { font-size: var(--fs-sm); color: var(--text-3); line-height: 1.8; max-width: 480px; margin: 0 auto 26px; }
.ld-actions { display: flex; justify-content: center; gap: 12px; flex-wrap: wrap; }
.ld-actions .btn { font-size: var(--fs-base); }
</style>
