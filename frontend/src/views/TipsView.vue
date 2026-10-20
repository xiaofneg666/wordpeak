<script setup>
import { ref, computed, watch, onUnmounted } from 'vue'
import { useUniverse, MODULE_LABELS } from '../stores/universe'
import { speak } from '../speech'
import EmptyState from '../components/EmptyState.vue'

const store = useUniverse()

const CATEGORIES = ['全部', '发音技巧', '词汇记忆', '语法理解', '听力方法', '口语输出', '学习方法']

// 分类偏好持久化:进入时恢复,切换时写入 profile.prefs.tipCategory
const savedCat = store.profile?.prefs?.tipCategory
const cat = ref(CATEGORIES.includes(savedCat) ? savedCat : '全部')
// 档案是异步拉取的:用户没手动切分类之前,以档案里保存的分类为准
let catTouched = false
watch(
  () => store.profile?.prefs?.tipCategory,
  (v) => { if (!catTouched && CATEGORIES.includes(v)) cat.value = v },
)
function setCat(c) {
  catTouched = true
  cat.value = c
  store.setPref('tipCategory', c)
}

const query = ref('')

// 出处书籍数(页头统计用)
const bookCount = computed(() => new Set(store.tips.map((t) => t.source_book)).size)

const filtered = computed(() => {
  let list = store.tips
  if (cat.value !== '全部') list = list.filter((t) => t.category === cat.value)
  const q = query.value.trim().toLowerCase()
  if (q) {
    list = list.filter((t) =>
      t.title.toLowerCase().includes(q) || t.content.toLowerCase().includes(q) ||
      t.source_book.toLowerCase().includes(q) || t.example.toLowerCase().includes(q))
  }
  return list
})

const byCategoryCount = computed(() => {
  const map = {}
  for (const t of store.tips) map[t.category] = (map[t.category] || 0) + 1
  return map
})

const MODULE_VIEWS = { galaxy: 'galaxy', phonetics: 'phonetics', grammar: 'grammar', listening: 'listening', speaking: 'speaking', reading: 'reading', tips: 'tips', bookshelf: 'bookshelf', dashboard: 'dashboard', review: 'galaxy' }
// MODULE_LABELS 从 store 统一导出(与 NavBar/领地一致),不再自造「语法城」「画像」简称
// 未映射的 key 不再静默吞掉(点了没反应最难排查):落到观星台并打警告
function go(view) {
  const v = MODULE_VIEWS[view] || 'dashboard'
  if (view && !MODULE_VIEWS[view]) console.warn('[Tips] 未映射的模块 key,兜回观星台:', view)
  store.setView(v)
}

// ---- 今日一策深化:从 Dashboard 带过来的推荐技巧 + "为什么是这条"理由 ----
const recTip = computed(() => (store.pendingTipId ? store.tips.find((t) => t.id === store.pendingTipId) : null))
// 深链进来时自动切到该技巧所属分类,保证推荐卡可见(只改显示,不写回档案偏好)
// immediate:深链的 pendingTipId 在本视图挂载前就设好了,不带它初值即非空时 watch 不触发
watch(recTip, (t) => {
  if (t && CATEGORIES.includes(t.category)) { catTouched = true; cat.value = t.category }
}, { immediate: true })
// 离开即清:否则下次进技巧库还会弹出陈旧的「为什么是这条」推荐卡
onUnmounted(() => store.clearPendingTip())

// related_modules → stats.accuracy_by_module 的 key(review 归入词汇)
const ACC_KEYS = { galaxy: 'vocab', review: 'vocab', phonetics: 'phonetics', grammar: 'grammar', listening: 'listening', speaking: 'speaking', reading: 'reading' }
const ACC_NAMES = { vocab: '词汇', phonetics: '发音', grammar: '语法', listening: '听力', speaking: '口语', reading: '阅读' }

// 理由生成:该技巧命中的模块里找正确率最低的,结合最弱词根等用户当前数据
const recReason = computed(() => {
  const t = recTip.value
  if (!t) return ''
  const acc = store.stats?.accuracy_by_module || {}
  const hits = [...new Set((t.related_modules || []).map((m) => ACC_KEYS[m]).filter(Boolean))]
  if (!hits.length) return `这条技巧出自《${t.source_book}》,是方法论里的经典一环——现在数据还不足以更精准地推荐,先练起来,之后的"今日一策"会越来越懂你。`
  const worst = hits.map((k) => ({ k, v: acc[k] ?? 0 })).sort((a, b) => a[1] - b[1])[0]
  if (!worst.v) {
    return `你还没有在「${ACC_NAMES[worst.k]}」模块留下答题记录。这条出自《${t.source_book}》的技巧正好帮你从零建立正确的${ACC_NAMES[worst.k]}习惯——去练几题,系统就能根据你的数据给出更精准的推荐。`
  }
  const learnedAll = Object.entries(acc).filter(([, v]) => v > 0)
  const weakestAll = learnedAll.sort((a, b) => a[1] - b[1])[0]
  let reason = `你在「${ACC_NAMES[worst.k]}」的正确率只有 ${Math.round(worst.v * 100)}%,是这条技巧命中的模块里最薄弱的一环`
  if (weakestAll && weakestAll[0] === worst.k) reason += ',也是你六大模块中最弱的一个'
  if (worst.k === 'vocab') {
    const wr = (store.stats?.weakest_roots || [])[0]
    if (wr) reason += `(最薄弱词根 ${String(wr.root).toUpperCase()}-,正确率仅 ${Math.round(wr.accuracy * 100)}%)`
  }
  reason += `。这条出自《${t.source_book}》的技巧正对症,点下面的按钮马上去练。`
  return reason
})

const recModule = computed(() => (recTip.value?.related_modules || [])[0] || null)
function goRecModule() {
  const m = recModule.value
  store.clearPendingTip()
  if (m) go(m)
}

// 技巧里的英文例句部分可朗读:取 example 里引号内的英文片段
function englishOf(example) {
  const m = example.match(/[a-zA-Z][a-zA-Z' \-.,!?/ːʃðθŋʊə:()]*/g)
  return m ? m.join(' ').slice(0, 120) : example
}

// ---- 五步展开:steps/practice/why 有内容的技巧可展开实操步骤(内容扩深后 48 条全覆盖) ----
const expanded = ref(new Set())
function toggleSteps(id) {
  const s = new Set(expanded.value)
  if (s.has(id)) s.delete(id); else s.add(id)
  expanded.value = s
}
</script>

<template>
  <div class="view-scroll">
    <div class="view-inner fade-in">
      <div class="terr-head">
        <div class="terr-kicker">TERRITORY · NOTES</div>
        <h2 class="terr-title"><BlurText text="技巧库" as="span" /></h2>
        <div class="terr-latin">FIELD NOTES</div>
        <div class="terr-rule" aria-hidden="true" />
        <p class="terr-sub">
          连读弱读、词根记法、拆句大法、影子跟读……每条技巧都注明出处与对应训练模块。学一条，马上点进去练一条。
        </p>
      </div>
      <div class="ph-stats" style="margin: -10px 0 22px">
        <span class="ph-stat"><b><CountNum :v="store.tips.length" mono /></b> 条技巧</span>
        <span class="ph-stat"><b><CountNum :v="bookCount" mono /></b> 本好书</span>
      </div>

      <div class="tips-controls">
        <div class="tips-tabs">
          <button
            v-for="c in CATEGORIES" :key="c"
            class="nav-tab" :class="{ active: cat === c }"
            @click="setCat(c)"
          >{{ c }}
            <span v-if="c !== '全部'" class="cat-count">{{ byCategoryCount[c] || 0 }}</span>
          </button>
        </div>
        <input v-model="query" class="tips-search" placeholder="搜索技巧 / 书名 / 关键词…" />
      </div>

      <!-- 从"今日一策"带过来的推荐:点阵台面上一颗点亮的金星 -->
      <div v-if="recTip" class="card rec-panel dots-host">
        <span class="dots-decor dots-fade" aria-hidden="true" style="--dots-o:.18" />
        <div class="rec-kicker">
          <span class="rec-star" aria-hidden="true" />
          <span class="rec-tag">为什么是这条</span>
        </div>
        <div class="rec-title">「{{ recTip.title }}」</div>
        <div class="rec-reason">{{ recReason }}</div>
        <div class="rec-actions">
          <button v-if="recModule" class="btn small primary" @click="goRecModule">{{ MODULE_LABELS[recModule] || recModule }} · 去练这条 →</button>
          <button class="btn small ghost" @click="store.clearPendingTip()">收起</button>
        </div>
      </div>

      <!-- 技巧加载中:skeleton 占位 -->
      <div v-if="store.fetching" class="grid cols-3">
        <div v-for="i in 3" :key="i" class="card sk-tip-card">
          <div class="skeleton sk-line" :style="{ width: '46%', height: '18px' }" />
          <div class="skeleton sk-line" :style="{ width: '88%', height: '18px', marginTop: '14px' }" />
          <div class="skeleton sk-line" :style="{ width: '96%', marginTop: '10px' }" />
          <div class="skeleton sk-line" :style="{ width: '64%', marginTop: '10px' }" />
        </div>
      </div>

      <!-- 无技巧数据:空态 -->
      <EmptyState
        v-else-if="!store.tips.length"
        icon="策" title="技巧库还空着"
        desc="48 条实战技巧刷新一下通常就能加载出来;一直空着,晚点再来"
      />

      <!-- 搜索/筛选无结果:空态 -->
      <EmptyState
        v-else-if="!filtered.length"
        icon="寻" title="没有匹配的技巧"
        :desc="query.trim() ? `没有找到和「${query.trim()}」相关的技巧,换个关键词试试` : '当前分类下没有技巧,看看其他分类吧'"
      >
        <button class="btn" @click="setCat('全部'); query = ''">查看全部技巧</button>
      </EmptyState>

      <template v-else>
        <div class="grid cols-3 stagger">
        <div v-for="t in filtered" :key="t.id" class="card tip-card" :class="{ hot: cat === '全部' && t.level === 1, rec: t.id === store.pendingTipId }">
          <div class="tip-top">
            <span class="chip cyan">{{ t.category }}</span>
            <span class="tip-level">L{{ t.level }}</span>
          </div>
          <div class="tip-title">{{ t.title }}</div>
          <p class="tip-content">{{ t.content }}</p>

          <div v-if="t.example" class="tip-example">
            <span class="tip-ex-label">例</span>
            <span class="tip-ex-text">{{ t.example }}</span>
            <button class="play-btn" title="朗读英文部分" @click="speak(englishOf(t.example))">
              <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                <path fill="currentColor" d="M3 9v6h4l5 4V5L7 9H3z" />
                <path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M16 8a5 5 0 0 1 0 8" />
                <path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M19 5.5a9 9 0 0 1 0 13" />
              </svg>
            </button>
          </div>

          <!-- 怎么练:展开步骤(实操步骤 + 本站练法 + 科学依据) -->
          <button
            v-if="t.steps?.length"
            class="tip-steps-toggle" :class="{ open: expanded.has(t.id) }"
            @click="toggleSteps(t.id)"
          >
            <span>怎么练{{ expanded.has(t.id) ? '' : ` · ${t.steps.length} 步` }}</span>
            <svg class="tip-steps-caret" viewBox="0 0 24 24" width="12" height="12" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" d="m6 9 6 6 6-6" /></svg>
          </button>
          <div v-if="t.steps?.length && expanded.has(t.id)" class="tip-steps">
            <ol class="tip-steps-list cascade">
              <li v-for="(s, i) in t.steps" :key="i"><span class="tip-step-no">{{ i + 1 }}</span>{{ s }}</li>
            </ol>
            <p v-if="t.practice" class="tip-practice"><b>本站练法</b>{{ t.practice }}</p>
            <p v-if="t.why" class="tip-why">{{ t.why }}</p>
          </div>

          <div class="tip-footer">
            <span class="tip-source" title="出自">出自 {{ t.source_book }}</span>
            <div class="tip-links">
              <button
                v-for="m in t.related_modules" :key="m"
                class="btn small ghost" @click="go(m)"
              >{{ MODULE_LABELS[m] || m }} →</button>
            </div>
          </div>
        </div>
      </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
/* 加载骨架 */
.sk-tip-card { padding: 20px; }
.sk-line { height: 12px; }

/* BlurText 接管「技巧库」入场:全局 terrRise 在本视图置空,避免双重动画 */
.terr-title { animation: none; }

/* 推荐卡:点阵台面上的一颗点亮金星——此刻全库最该看的一条 */
.rec-panel {
  position: relative; overflow: hidden;
  margin-bottom: 20px; border-color: var(--line-accent);
  background:
    radial-gradient(480px 260px at 92% -40%, color-mix(in srgb, var(--accent) 12%, transparent), transparent 65%),
    var(--surface);
  animation: riseIn 0.5s var(--ease) both;
}
.rec-kicker { display: inline-flex; align-items: center; gap: 8px; }
/* 四芒金星:与暗物质区/竞技场星墙同一颗星,词之心塔尖灯色 */
.rec-star {
  width: 11px; height: 11px; flex-shrink: 0;
  clip-path: polygon(50% 0, 58% 42%, 100% 50%, 58% 58%, 50% 100%, 42% 58%, 0 50%, 42% 42%);
  background: var(--gold);
  filter: drop-shadow(0 0 5px color-mix(in srgb, var(--gold) 45%, transparent));
  animation: starPop 0.5s var(--ease-squish-2) 0.15s backwards;
}
[data-theme='light'] .rec-star { filter: none; }
@keyframes starPop { from { transform: scale(0.3); opacity: 0; } }
.rec-tag {
  font-family: var(--mono); font-size: var(--fs-2xs); font-weight: 600;
  letter-spacing: 0.24em; color: var(--accent);
}
/* 推荐条目名:星图命名式衬线 */
.rec-title {
  font-family: var(--serif);
  font-size: var(--fs-xl); font-weight: 600; letter-spacing: 0.06em;
  margin: 10px 0 12px;
}
.rec-reason { font-size: var(--fs-sm); color: var(--text-2); line-height: 1.8; max-width: 760px; }
.rec-actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 12px; }
.tip-card.rec { border-color: color-mix(in srgb, var(--accent) 55%, transparent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 15%, transparent); }

.tips-controls { display: flex; gap: 12px; flex-wrap: wrap; align-items: center; margin-bottom: 20px; }
.tips-tabs { display: flex; gap: 4px; flex-wrap: wrap; flex: 1; }
.cat-count { font-size: var(--fs-2xs); opacity: 0.7; margin-left: 3px; }
.tips-search {
  padding: 8px 14px; border-radius: 9px; font-size: var(--fs-sm); font-family: inherit; min-width: 220px;
  background: color-mix(in srgb, var(--info) 7%, transparent); border: 1px solid var(--line); color: var(--text); outline: none;
}
.tips-search:focus { border-color: var(--accent); box-shadow: 0 0 12px color-mix(in srgb, var(--accent) 20%, transparent); }

.tip-card { display: flex; flex-direction: column; }
.tip-card.hot { border-color: var(--line-accent); }
/* 核心心法(Lv.1):顶部 accent 刻线,像书页里伸出的一枚签 */
.tip-card.hot::after {
  content: ''; position: absolute; left: 0; right: 0; top: 0; height: 2px;
  background: var(--grad-accent); opacity: 0.7;
}
.tip-top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
/* 等级标:mono 铭牌 */
.tip-level {
  font-family: var(--mono); font-size: var(--fs-2xs); letter-spacing: 0.05em;
  font-variant-numeric: tabular-nums;
  color: var(--text-3); border: 1px solid var(--line); border-radius: 5px; padding: 1px 7px;
}
.tip-title { font-size: var(--fs-md); font-weight: 700; line-height: 1.4; margin-bottom: 8px; }
.tip-content { font-size: var(--fs-sm); color: var(--text-2); line-height: 1.75; flex: 1; }
.tip-example {
  margin-top: 12px; padding: 9px 12px; border-radius: 9px; display: flex; align-items: center; gap: 9px;
  background: color-mix(in srgb, var(--info) 6%, transparent); border: 1px solid var(--line); font-size: var(--fs-sm);
}
/* 「例」字:小方印,典籍批注的落款感 */
.tip-ex-label {
  flex-shrink: 0; width: 20px; height: 20px; border-radius: 5px;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: var(--fs-2xs); font-weight: 700; color: var(--accent);
  background: var(--accent-soft);
  border: 1px solid color-mix(in srgb, var(--accent) 30%, transparent);
}
.tip-ex-text { flex: 1; line-height: 1.6; word-break: break-word; }
/* 朗读键:落到例句条自己的小圆位上 */
.tip-example .play-btn {
  display: inline-flex; align-items: center; justify-content: center;
  width: 26px; height: 26px; border-radius: 6px; color: var(--text-3);
  transition: all 0.2s var(--ease); flex-shrink: 0;
}
.tip-example .play-btn:hover { color: var(--accent); background: var(--accent-soft); opacity: 1; }
.tip-footer {
  margin-top: 14px; padding-top: 12px; border-top: 1px dashed var(--line);
  display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap;
}
.tip-source { font-size: var(--fs-xs); color: var(--text-3); }
.tip-links { display: flex; gap: 6px; flex-wrap: wrap; }
.tip-links .btn { font-size: var(--fs-xs); padding: 4px 10px; }

/* 怎么练:展开区 */
.tip-steps-toggle {
  display: flex; align-items: center; gap: 6px; margin-top: 12px;
  background: none; border: none; padding: 0; cursor: pointer;
  font-size: var(--fs-xs); color: var(--accent); letter-spacing: 0.04em;
  transition: color 0.2s var(--ease);
}
.tip-steps-toggle:hover { color: var(--accent-hover); }
.tip-steps-caret { transition: transform .22s var(--ease); color: currentColor; }
.tip-steps-toggle.open .tip-steps-caret { transform: rotate(180deg); }
.tip-steps {
  margin-top: 10px; padding: 12px 14px; border: 1px solid var(--line);
  border-radius: 10px; background: color-mix(in srgb, var(--info) 5%, transparent);
  animation: riseIn 0.3s var(--ease) both;
}
/* 口诀逐条升起(ol 挂全局 .cascade),练法与依据再慢半拍跟上 */
.tip-steps .tip-practice, .tip-steps .tip-why { animation: riseIn 0.4s var(--ease) 0.24s backwards; }
.tip-steps-list { list-style: none; display: flex; flex-direction: column; gap: 7px; }
.tip-steps-list li { display: flex; gap: 9px; font-size: var(--fs-sm); color: var(--text-2); line-height: 1.7; }
.tip-step-no {
  flex-shrink: 0; width: 17px; height: 17px; margin-top: 2px; border-radius: 5px;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: var(--fs-2xs); font-family: var(--mono, monospace); color: var(--accent);
  border: 1px solid color-mix(in srgb, var(--accent) 45%, transparent);
}
.tip-practice { font-size: var(--fs-xs); color: var(--text-2); line-height: 1.7; margin-top: 10px; }
.tip-practice b {
  color: var(--accent); font-size: var(--fs-2xs); letter-spacing: 0.14em;
  margin-right: 8px; font-weight: 600;
}
.tip-why { font-size: var(--fs-2xs); color: var(--text-3); margin-top: 6px; line-height: 1.6; }
</style>
