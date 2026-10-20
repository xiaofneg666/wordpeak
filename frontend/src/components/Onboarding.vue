<script setup>
// 首课 5 词:hydro 家族(hydrogen / hydrate / dehydrate / hydraulic / hydroelectric)
// id 与后端 words 表实际值对齐(words.json 种入后的自增 id)— 改种子时这里同步改
// 3D 房间由 RoomEngine 渲染(frontend/src/three/galaxy/roomEngine.js),
// 点击球 → 弹 2D 词卡 → 点「记住了」→ 球变绿 + 自动跳下一个未学词
import { ref, onMounted, onUnmounted, computed, nextTick } from 'vue'
import { useUniverse } from '../stores/universe'
import { api } from '../api'
import { message } from '../ui'
import { RoomEngine } from '../three/galaxy/roomEngine.js'
import AppGlyph from './AppGlyph.vue'

const FIRST5 = [
  { id: 255, word: 'hydrate',    ipa: '/ˈhaɪdreɪt/',     meaning: '补水；水合物',    coll: 'hydrate the skin / 给皮肤补水',           ex_en: 'Drink enough water to stay hydrated.',  ex_zh: '运动时要喝够水,保持身体水分充足。' },
  { id: 256, word: 'dehydrate', ipa: '/ˌdiːhaɪˈdreɪt/', meaning: '（使）脱水',      coll: 'dehydrated food / 脱水食品',              ex_en: 'Too much salt can dehydrate you.',        ex_zh: '盐吃多了会让身体脱水。' },
  { id: 257, word: 'hydraulic', ipa: '/haɪˈdrɔːlɪk/',   meaning: '液压的,水力的',   coll: 'hydraulic brakes / 液压刹车',             ex_en: 'The hydraulic lift raised the car.',      ex_zh: '液压升降机把车升了起来。' },
  { id: 254, word: 'hydrogen',  ipa: '/ˈhaɪdrədʒən/',   meaning: '氢',              coll: 'hydrogen fuel / 氢燃料',                  ex_en: 'Water is made of hydrogen and oxygen.',  ex_zh: '水由氢和氧构成。' },
  { id: 258, word: 'hydroelectric', ipa: '/ˌhaɪdrəʊɪˈlektrɪk/', meaning: '水力发电的',  coll: 'hydroelectric power / 水电',               ex_en: 'The dam produces hydroelectric power.',   ex_zh: '水电站大坝发电。' },
]

const GOALS = [
  { key: 'exam', name: '考试', hint: '四六级、考研、雅思托福' },
  { key: 'study', name: '出国留学', hint: '要应付国外的课堂和生活' },
  { key: 'work', name: '工作', hint: '邮件、会议、文档都用得上' },
  { key: 'interest', name: '兴趣', hint: '看剧、读书,想把英语学好' },
]
const LEVELS = [
  { key: 'beginner', name: '初级', hint: '词汇量还小,音标不太熟' },
  { key: 'intermediate', name: '中级', hint: '能读懂简单文章,听力还吃力' },
  { key: 'advanced', name: '高级', hint: '底子不错,想再往上走' },
]
const NAME_POOL = ['小陈', '小林', '小赵', '小周', '小李', '小吴', '小杨', '小徐', '阿May', '阿Ken', '阿杰', '阿Ray']
const STEPS_ALL = [
  { no: 1, label: '首课' },     // ← 改:从"欢迎"变成"首课 5 词"
  { no: 2, label: '目标' },
  { no: 3, label: '路线' },
  { no: 4, label: '起名' },
]
// 自愿模式没有"起名"一步(账号已存在);兜底模式保留 4 步
const STEPS = computed(() => (voluntary.value ? STEPS_ALL.slice(0, 3) : STEPS_ALL))
const maxStep = computed(() => (voluntary.value ? 3 : 4))
const STEP_NOTES = {
  1: '先把 48 个音标读准。音标不准,听力永远跟不上——你听到的和你以为的不一样。',
  2: '语法不求背完,读句子能看懂结构就行,是后面阅读和听力的地基。',
  3: '读和听一起上,单词放进语境里记。每天该复习哪些词,算法替你排好了。',
  4: '开口跟读,把前面积累的东西用出来。学习画像会告诉你哪个模块弱,回头补。',
}

const store = useUniverse()
// 自愿模式:已建号(进站自动建的游客号)后从 Dashboard 推荐卡进来 ——
// 随时可关、不用起名(3 步:首课/目标/路线),写档案 + 学词都记在当前账号上
// 非自愿模式 = 首次进站建号失败的兜底,保留原 4 步流程
const voluntary = computed(() => !!store.user)
const step = ref(1)
const goal = ref(null)
const level = ref(null)
const name = ref('')
const busy = ref(false)
const err = ref('')
const roadmap = ref([])
const starsLoaded = ref(false)

// ===== 首课 5 词状态 =====
const learnedSet = ref(new Set())  // 已记住的 word.id
const activeWord = ref(FIRST5[0])  // 当前高亮/等用户点的词
const cardVisible = ref(false)      // 2D 词卡是否显示
const cardPos = ref({ x: 0, y: 0 }) // 词卡屏幕坐标(挨着被点的球)

// 3D 引擎引用
let roomEngine = null
const canvasContainer = ref(null)
// 主题切换 → 3D 房间换色(球 emissive / 光圈 / 补光)
const onThemeChange = () => roomEngine?.applyTheme()
// 自愿模式:Esc 也能随时退出(不强制)
function onEsc(e) { if (e.key === 'Escape' && voluntary.value) store.closeOnboarding() }

onMounted(async () => {
  window.addEventListener('keydown', onEsc)
  try { roadmap.value = await api.roadmap() } catch { /* 静默 */ }
  setTimeout(() => { starsLoaded.value = true }, 100)
  // 主题切换跟随(App.vue 派发,与 GalaxyCanvas 同一事件源)
  window.addEventListener('wv:themechange', onThemeChange)
  // 第 1 步进入后等 DOM 挂载 canvas 再实例化 3D
  await nextTick()
  if (canvasContainer.value) {
    try {
      roomEngine = new RoomEngine(canvasContainer.value, {
        words: FIRST5,
        onTap: (wordId, screenX, screenY) => {
          // 找对应词 → 弹卡
          const w = FIRST5.find((x) => x.id === wordId)
          if (!w) return
          activeWord.value = w
          cardPos.value = { x: screenX, y: screenY }
          cardVisible.value = true
        },
      })
    } catch (e) {
      console.error('[Onboarding] RoomEngine 启动失败:', e)
      message.error('3D 场景加载失败,请刷新重试')
    }
  }
})

onUnmounted(() => {
  window.removeEventListener('keydown', onEsc)
  window.removeEventListener('wv:themechange', onThemeChange)
  if (roomEngine) { roomEngine.dispose(); roomEngine = null }
})

const canNext = () => {
  if (step.value === 1) return learnedSet.value.size === FIRST5.length
  if (step.value === 2) return goal.value !== null
  return true
}

function next() { if (step.value < maxStep.value && canNext()) step.value++ }
function back() { if (step.value > 1) step.value-- }

// 自愿模式收尾:目标/水平写档案、已点"记住了"的词落库 → 回主页
async function finish() {
  busy.value = true
  try {
    if (goal.value || level.value) {
      await store.saveProfile({ goal: goal.value, self_level: level.value })
      store.loadProfile()
    }
    for (const w of FIRST5) {
      if (learnedSet.value.has(w.id)) {
        try { await store.api_learnWord(w.id) } catch { /* 单条失败不影响收尾 */ }
      }
    }
    await store.refreshStats()
  } catch { /* 档案/落库失败也放人回主页,主页会再刷新 */ }
  busy.value = false
  store.closeOnboarding()
}

function suggest() {
  let n = name.value
  while (n === name.value) n = NAME_POOL[Math.floor(Math.random() * NAME_POOL.length)]
  name.value = n
}

function rememberWord() {
  const id = activeWord.value.id
  if (learnedSet.value.has(id)) return
  // 球变绿 + 收缩(0.6s 动效)
  if (roomEngine) roomEngine.markLearned(id)
  // 关闭卡
  cardVisible.value = false
  // 加入已学集合(响应式)
  learnedSet.value = new Set([...learnedSet.value, id])
  // 自动跳下一个未学词
  const next5 = FIRST5.find((x) => !learnedSet.value.has(x.id))
  if (next5) activeWord.value = next5
  // 5 词全学完 → 自动跳到第 2 步
  if (learnedSet.value.size === FIRST5.length) {
    setTimeout(() => { step.value = 2 }, 800)
  }
}

const progress = computed(() => `${learnedSet.value.size} / ${FIRST5.length}`)

async function go() {
  // 自愿模式不会走到这里(没有起名步),防御性兜底
  if (voluntary.value) return finish()
  const username = name.value.trim() || NAME_POOL[Math.floor(Math.random() * NAME_POOL.length)]
  busy.value = true; err.value = ''
  try {
    const user = await api.ensureUser(username)
    store.setUser(user)
    if (goal.value || level.value) {
      await store.saveProfile({ goal: goal.value, self_level: level.value })
      await store.loadProfile()
    }
    // 5 词的"记住"先乐观落地,后端学到即落库
    for (const w of FIRST5) {
      if (learnedSet.value.has(w.id)) {
        try { await store.api_learnWord(w.id) } catch { /* 单条失败不影响整体进入 */ }
      }
    }
    await store.loadUniverse()
  } catch (e) {
    const detail = e?.name === 'TimeoutError' ? '请求超时'
      : e?.name === 'AbortError' ? '请求被中断'
      : (e?.message || String(e))
    err.value = `连不上后端 (localhost:8000)：${detail} — 若后端已启动,请检查浏览器代理是否拦截了 localhost`
    message.error(`无法连接后端：${detail}`)
    busy.value = false
  }
}
</script>

<template>
  <div class="onboard">
    <!-- 自愿模式随时可关:右上 ✕ / Esc;关了主页推荐卡还在,想学再点 -->
    <button v-if="voluntary" class="onboard-close" title="先去逛逛 · 主页随时有首课入口" @click="store.closeOnboarding()">✕</button>
    <div class="bg-layer">
      <div class="bg-blob bg-1" />
      <svg class="bg-stars" :class="{ loaded: starsLoaded }" viewBox="0 0 800 600" preserveAspectRatio="xMidYMid slice">
        <circle v-for="i in 60" :key="i"
          :cx="(i * 73) % 800" :cy="(i * 131) % 600" :r="(i % 3) * 0.5 + 0.5"
          :fill="i % 4 === 0 ? 'var(--accent)' : 'var(--text-3)'" :opacity="0.2 + (i % 3) * 0.15" />
      </svg>
    </div>

    <div class="onboard-shell">
      <!-- 步骤指示器 -->
      <div class="steps-indicator">
        <template v-for="(s, i) in STEPS" :key="s.no">
          <div class="step-pill" :class="{ done: step > s.no, current: step === s.no }">
            <span class="step-pill-no">{{ step > s.no ? '✓' : s.no }}</span>
            <span class="step-pill-label">{{ s.label }}</span>
          </div>
          <div v-if="i < STEPS.length - 1" class="step-link" :class="{ done: step > s.no }" />
        </template>
      </div>

      <!-- ===== 第 1 步:首课 5 词(hydro 家族) ===== -->
      <div v-if="step === 1" :key="1" class="step-body step-room">
        <div class="room-header">
          <div class="onboard-kicker">
            <span class="dot" /> {{ FIRST5.length }} 词 · hydro 词根 · 水 / 水力
          </div>
          <h1 class="onboard-h1">点 5 个发光球,学 5 个词</h1>
          <p class="onboard-desc">
            每个球是一样跟水有关的东西,点一下 → 卡片告诉你它叫什么、怎么用、怎么记住。
            <br />
            <span class="dim">{{ voluntary
              ? `这 5 个词只是个开头,词库里还有 ${store.words.length} 词、40 个词根家族在等你。`
              : `记完 5 个就解锁完整版词峰,${store.words.length} 词、40 个词根家族在等你。` }}</span>
          </p>
          <div class="room-progress">
            <span class="rp-num">{{ progress }}</span>
            <span class="rp-label">已学</span>
          </div>
        </div>

        <!-- 3D 房间(占 ~60% 高度) -->
        <div class="room-canvas-wrap">
          <div ref="canvasContainer" class="room-canvas" />
          <!-- 当前等用户点的词的浮动提示(右上角小气泡) -->
          <div class="room-hint">
            下一个 → <strong>{{ activeWord.word }}</strong> · {{ activeWord.meaning }}
          </div>
        </div>

        <!-- 2D 词卡:点击 3D 球后弹出 -->
        <transition name="card-pop">
          <div v-if="cardVisible" class="word-card" :style="{ left: cardPos.x + 'px', top: cardPos.y + 'px' }">
            <div class="wc-head">
              <div class="wc-word">{{ activeWord.word }}</div>
              <div class="wc-ipa">{{ activeWord.ipa }}</div>
            </div>
            <div class="wc-mean">{{ activeWord.meaning }}</div>
            <div class="wc-coll">{{ activeWord.coll }}</div>
            <div class="wc-ex">
              <div class="wc-ex-en">{{ activeWord.ex_en }}</div>
              <div class="wc-ex-zh">{{ activeWord.ex_zh }}</div>
            </div>
            <div class="wc-foot">
              <button class="wc-skip" @click="cardVisible = false">跳过</button>
              <button class="wc-ok" @click="rememberWord">记住了 ✓</button>
            </div>
          </div>
        </transition>

        <!-- 完成态:5 词全记住后显示 -->
        <transition name="complete-rise">
          <div v-if="learnedSet.size === FIRST5.length" class="room-done">
            <div class="rd-emoji"><AppGlyph name="spark" :size="26" /></div>
            <div class="rd-title">5 个词已经认识你了</div>
            <div class="rd-sub">下一步:告诉我们你想用英语做什么</div>
            <button class="btn primary launch" @click="step = 2">继续 →</button>
          </div>
        </transition>
      </div>

      <!-- ===== 第 2 步:目标 + 自评水平 ===== -->
      <div v-else-if="step === 2" :key="2" class="step-body">
        <div class="step-heading">你学英语是为了什么</div>
        <p class="step-sub">选一个就行,首页的推荐会照着它来。之后在设置里随时能改。</p>
        <div class="pick-grid">
          <button
            v-for="g in GOALS" :key="g.key" type="button"
            class="pick-card" :class="{ on: goal === g.key }" @click="goal = g.key"
          >
            <div class="pick-name">{{ g.name }}</div>
            <div class="pick-hint">{{ g.hint }}</div>
          </button>
        </div>
        <div class="step-heading pick-gap">现在的水平</div>
        <p class="step-sub">自己估一下就行,练几轮后数据会比自评更准。</p>
        <div class="pick-grid">
          <button
            v-for="l in LEVELS" :key="l.key" type="button"
            class="pick-card" :class="{ on: level === l.key }" @click="level = l.key"
          >
            <div class="pick-name">{{ l.name }}</div>
            <div class="pick-hint">{{ l.hint }}</div>
          </button>
        </div>
      </div>

      <!-- ===== 第 3 步:四步学习路线 ===== -->
      <div v-else-if="step === 3" :key="3" class="step-body">
        <div class="step-heading">四步学习路线</div>
        <p class="step-sub">前两步打地基,后两步把英语用起来。每一步在词峰里都有对应的练习,按顺序走就行。</p>
        <div v-if="roadmap.length" class="roadmap-strip roadmap-vertical">
          <div v-for="(s, i) in roadmap" :key="s.step" class="roadmap-step" :style="{ animationDelay: `${i * 0.08}s` }">
            <span class="step-no">{{ s.step }}</span>
            <div class="step-body-text">
              <div class="step-title">{{ s.title }}<span class="step-weeks">{{ s.weeks }}</span></div>
              <div class="step-note">{{ STEP_NOTES[s.step] || s.goal }}</div>
              <div class="step-book">配套书:{{ s.book }}</div>
            </div>
          </div>
        </div>
        <p v-else class="step-sub" style="opacity: 0.7">路线图加载中——不影响开始,进入后在「轨道书库」能看到完整路线。</p>
      </div>

      <!-- ===== 第 4 步:起名,进入应用 ===== -->
      <div v-else :key="4" class="step-body step-body-narrow">
        <div class="step-heading">怎么称呼你</div>
        <p class="step-sub">名字只用来记你的学习进度,之后可以在设置里改。</p>
        <div class="onboard-form">
          <div class="input-row">
            <input
              v-model="name" class="onboard-input" placeholder="比如:小陈、阿May,或直接填你的名字"
              :disabled="busy" @keydown.enter="go" autofocus
            />
            <button class="btn ghost dice" type="button" :disabled="busy" @click="suggest" title="换一个称呼">
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                <rect x="3" y="3" width="18" height="18" rx="4.5" fill="none" stroke="currentColor" stroke-width="1.8" />
                <circle cx="8.5" cy="8.5" r="1.6" fill="currentColor" />
                <circle cx="15.5" cy="8.5" r="1.6" fill="currentColor" />
                <circle cx="12" cy="12" r="1.6" fill="currentColor" />
                <circle cx="8.5" cy="15.5" r="1.6" fill="currentColor" />
                <circle cx="15.5" cy="15.5" r="1.6" fill="currentColor" />
              </svg>
            </button>
          </div>
          <button class="btn primary launch" :disabled="busy" @click="go">
            <span v-if="!busy">开始学</span>
            <span v-else class="loading-dots">
              <i /><i /><i /><i /><span>正在进入</span>
            </span>
          </button>
          <p v-if="err" class="onboard-err">{{ err }}</p>
        </div>
      </div>

      <!-- 前进 / 后退(只在非第 1 步显底部按钮,第 1 步"记住 5 词"自动跳) -->
      <div v-if="step !== 1" class="step-nav">
        <button v-if="step > 1" class="btn ghost step-back" :disabled="busy" @click="back">← 上一步</button>
        <button
          v-if="step < maxStep" class="btn primary step-next" :disabled="!canNext()"
          :title="step === 2 && !goal ? '先选一个目标' : ''" @click="next"
        >下一步 →</button>
        <!-- 自愿模式最后一步:收尾回主页(不用起名,账号已存在) -->
        <button v-else-if="voluntary" class="btn primary step-next" :disabled="busy" @click="finish">
          {{ busy ? '正在保存…' : '完成首课,回到主页 →' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* === 背景(与旧版一致) === */
.onboard { position: fixed; inset: 0; z-index: 200; display: flex; align-items: center; justify-content: center; background: var(--bg); overflow: hidden; }
/* 自愿模式:随时可关的右上角 ✕ */
.onboard-close {
  position: absolute; top: 18px; right: 18px; z-index: 210;
  width: 36px; height: 36px; border-radius: 50%;
  background: color-mix(in srgb, var(--surface) 80%, transparent); border: 1px solid var(--line);
  color: var(--text-3); font-size: var(--fs-base); cursor: pointer; backdrop-filter: blur(12px);
  transition: all 0.18s var(--ease);
}
.onboard-close:hover { color: var(--text); border-color: var(--line-strong); background: var(--surface-hover); }
.bg-layer { position: absolute; inset: 0; pointer-events: none; }
.bg-blob { position: absolute; border-radius: 50%; filter: blur(120px); width: 60vmax; height: 60vmax;
  background: color-mix(in srgb, var(--accent) 60%, var(--accent-2)); top: -20%; left: -15%; opacity: 0.22;
  animation: drift1 16s ease-in-out infinite alternate; }
@keyframes drift1 { to { transform: translate(8vmax, 6vmax) scale(1.15); } }
.bg-stars { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; transition: opacity 1.5s var(--ease); }
.bg-stars.loaded { opacity: 1; }
.bg-stars circle { animation: twinkle 3s ease-in-out infinite alternate; }
@keyframes twinkle { from { opacity: 0.1 } to { opacity: 0.7 } }

/* shell 原本是 max-width 760 居中,首课改成"全宽深色块",所以 step-room 用更宽布局 */
.onboard-shell { position: relative; z-index: 1; text-align: center;
  width: min(760px, 92vw); padding: 28px 24px; animation: riseIn 0.6s var(--ease); }

/* 步骤指示器(沿用) */
.steps-indicator { display: flex; align-items: center; justify-content: center; gap: 10px; margin-bottom: 30px; animation: riseIn 0.5s var(--ease) both; }
.step-pill { display: inline-flex; align-items: center; gap: 7px; padding: 6px 14px; border-radius: 999px;
  background: var(--surface); border: 1px solid var(--line); color: var(--text-3); font-size: var(--fs-xs); font-weight: 500; transition: all 0.35s var(--ease); }
.step-pill-no { width: 20px; height: 20px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center;
  font-family: var(--mono); font-size: var(--fs-2xs); font-weight: 700; background: var(--surface-sunken); border: 1px solid var(--line); transition: all 0.35s var(--ease); }
.step-pill.current { color: var(--accent); border-color: var(--line-accent); background: var(--accent-soft);
  box-shadow: 0 0 18px color-mix(in srgb, var(--accent) 18%, transparent); }
.step-pill.current .step-pill-no { background: var(--accent); border-color: var(--accent); color: #fff; }
.step-pill.done { color: var(--success); border-color: color-mix(in srgb, var(--success) 35%, transparent); }
.step-pill.done .step-pill-no { background: color-mix(in srgb, var(--success) 14%, transparent); border-color: color-mix(in srgb, var(--success) 40%, transparent); color: var(--success); }
.step-link { width: 34px; height: 2px; border-radius: 1px; background: var(--line-strong); overflow: hidden; position: relative; }
.step-link.done { background: linear-gradient(90deg, var(--success), color-mix(in srgb, var(--success) 35%, transparent)); }
.step-body { animation: riseIn 0.45s var(--ease) both; }
.step-body-narrow { max-width: 460px; margin: 0 auto; }

/* ===== 第 1 步 · 房间屏 ===== */
.step-room { max-width: 1000px; }
.room-header { margin-bottom: 18px; }
.onboard-kicker { display: inline-flex; align-items: center; gap: 10px; padding: 6px 14px; border-radius: 999px;
  background: var(--surface); border: 1px solid var(--line); font-size: var(--fs-xs); color: var(--text-2);
  letter-spacing: 0.04em; margin-bottom: 16px; backdrop-filter: blur(12px); }
.onboard-kicker .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--success); box-shadow: 0 0 8px var(--success); }
.onboard-h1 { font-size: 32px; font-weight: 700; letter-spacing: -0.025em; margin: 0 0 10px; }
.onboard-desc { color: var(--text-2); line-height: 1.8; font-size: var(--fs-base); max-width: 720px; margin: 0 auto 14px; }
.onboard-desc .dim { color: var(--text-3); font-size: var(--fs-sm); }
.room-progress { display: inline-flex; align-items: baseline; gap: 6px; padding: 6px 12px; border-radius: 999px;
  background: var(--accent-soft); border: 1px solid var(--line-accent); }
.rp-num { font-family: var(--mono); font-size: var(--fs-md); font-weight: 700; color: var(--accent); }
.rp-label { font-size: var(--fs-xs); color: var(--text-2); }

/* 3D 画布:640×360 桌面 / 100% 宽移动
   3D 房间是暗舞台:画框渐变保持深色,浅色页面上呈"取景框"效果而非坏掉 */
.room-canvas-wrap { position: relative; width: 100%; max-width: 880px; margin: 0 auto; aspect-ratio: 16/9;
  border-radius: 16px; overflow: hidden; border: 1px solid var(--line-strong);
  background: linear-gradient(180deg, #05070f, #0b101f);
  box-shadow: var(--shadow-xl), 0 0 0 6px var(--accent-soft), inset 0 0 0 1px var(--accent-glow); }
.room-canvas { position: absolute; inset: 0; }
.room-hint { position: absolute; right: 14px; top: 14px; padding: 8px 14px; border-radius: 999px;
  background: color-mix(in srgb, var(--surface) 80%, transparent); border: 1px solid var(--line);
  font-size: var(--fs-xs); color: var(--text-2); backdrop-filter: blur(12px); pointer-events: none; }
.room-hint strong { color: var(--accent); font-weight: 600; }

/* 2D 词卡(贴在被点的球旁边) */
.word-card { position: fixed; z-index: 250; transform: translate(-50%, -110%); min-width: 320px; max-width: 360px;
  padding: 16px 18px; border-radius: 14px; text-align: left;
  background: color-mix(in srgb, var(--surface) 92%, transparent); border: 1px solid var(--line-strong);
  backdrop-filter: blur(20px); box-shadow: var(--shadow-lg); }
.wc-head { display: flex; align-items: baseline; gap: 10px; margin-bottom: 6px; }
.wc-word { font-size: var(--fs-xl); font-weight: 700; color: var(--text); letter-spacing: -0.01em; }
.wc-ipa { font-family: var(--mono); font-size: var(--fs-xs); color: var(--text-3); }
.wc-mean { font-size: var(--fs-base); color: var(--accent); font-weight: 600; margin-bottom: 10px; }
.wc-coll { font-size: var(--fs-xs); color: var(--text-2); margin-bottom: 12px; padding: 8px 10px; border-radius: 8px;
  background: var(--surface-sunken); border-left: 2px solid var(--accent); }
.wc-ex { padding: 8px 10px; border-radius: 8px; background: var(--surface-sunken); margin-bottom: 14px; }
.wc-ex-en { font-size: var(--fs-xs); color: var(--text); margin-bottom: 2px; }
.wc-ex-zh { font-size: var(--fs-2xs); color: var(--text-3); }
.wc-foot { display: flex; gap: 8px; justify-content: flex-end; }
.wc-skip { padding: 7px 12px; border-radius: 8px; background: transparent; border: 1px solid var(--line); color: var(--text-2);
  font-size: var(--fs-xs); cursor: pointer; transition: all 0.18s var(--ease); }
.wc-skip:hover { background: var(--surface-hover); color: var(--text); }
.wc-ok { padding: 7px 14px; border-radius: 8px; border: none;
  background: linear-gradient(135deg, var(--accent), var(--success)); color: #fff; font-size: var(--fs-xs); font-weight: 600;
  cursor: pointer; transition: all 0.18s var(--ease); box-shadow: 0 6px 18px color-mix(in srgb, var(--accent) 28%, transparent); }
.wc-ok:hover { transform: translateY(-1px); }
.card-pop-enter-active, .card-pop-leave-active { transition: opacity 0.18s var(--ease), transform 0.22s var(--ease); }
.card-pop-enter-from, .card-pop-leave-to { opacity: 0; transform: translate(-50%, -100%) scale(0.96); }

/* 完成态 */
.room-done { margin-top: 22px; padding: 18px 24px; border-radius: 14px;
  background: color-mix(in srgb, var(--success) 8%, transparent); border: 1px solid color-mix(in srgb, var(--success) 30%, transparent); }
.rd-emoji { color: var(--success); margin-bottom: 4px; }
.rd-title { font-size: var(--fs-md); font-weight: 600; margin-bottom: 4px; }
.rd-sub { font-size: var(--fs-sm); color: var(--text-2); margin-bottom: 12px; }
.complete-rise-enter-active { transition: opacity 0.4s var(--ease), transform 0.4s var(--ease); }
.complete-rise-enter-from { opacity: 0; transform: translateY(8px); }

/* ===== 第 2/3/4 步沿用原样式 ===== */
.step-heading { font-size: var(--fs-2xl); font-weight: 700; letter-spacing: -0.02em; margin-bottom: 8px; }
.step-heading.pick-gap { margin-top: 34px; }
.step-sub { color: var(--text-2); font-size: var(--fs-base); line-height: 1.8; margin: 0 auto 24px; max-width: 480px; }
.pick-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; max-width: 560px; margin: 0 auto 6px; }
.pick-card { padding: 16px 14px; border-radius: 14px; text-align: left;
  background: var(--surface); border: 1px solid var(--line); cursor: pointer; font-family: inherit;
  transition: all 0.22s var(--ease); animation: riseIn 0.45s var(--ease) both; }
.pick-card:hover { border-color: var(--line-accent); background: var(--surface-hover); }
.pick-card.on { border-color: var(--accent); background: var(--accent-soft);
  box-shadow: 0 0 0 1px var(--accent), 0 0 18px color-mix(in srgb, var(--accent) 14%, transparent); }
.pick-name { font-size: var(--fs-md); font-weight: 600; color: var(--text); }
.pick-card.on .pick-name { color: var(--accent); }
.pick-hint { font-size: var(--fs-xs); color: var(--text-3); margin-top: 4px; line-height: 1.6; }
.roadmap-strip.roadmap-vertical { display: flex; flex-direction: column; gap: 10px; max-width: 560px; margin: 0 auto; }
.roadmap-step { display: flex; align-items: center; gap: 12px; padding: 14px 16px;
  background: var(--surface); border: 1px solid var(--line); border-radius: 12px; text-align: left;
  backdrop-filter: blur(16px); transition: transform 0.25s var(--ease), border-color 0.25s; animation: riseIn 0.5s var(--ease) both; }
.roadmap-step:hover { transform: translateX(3px); border-color: var(--line-accent); }
.roadmap-step .step-no { width: 28px; height: 28px; border-radius: 9px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  font-family: var(--mono); font-size: var(--fs-xs); font-weight: 700; color: var(--accent);
  background: var(--accent-soft); border: 1px solid var(--line-accent); }
.roadmap-step .step-title { font-size: var(--fs-base); font-weight: 600; color: var(--text); }
.roadmap-step .step-weeks { font-size: var(--fs-2xs); color: var(--text-3); margin-left: 4px; font-weight: 400; }
.roadmap-step .step-note { font-size: var(--fs-xs); color: var(--text-2); margin-top: 3px; line-height: 1.7; }
.roadmap-step .step-book { font-size: var(--fs-2xs); color: var(--text-3); margin-top: 4px; }
.onboard-form { animation: riseIn 0.5s var(--ease) 0.2s both; }
.input-row { display: flex; gap: 8px; margin-bottom: 12px }
.onboard-input { flex: 1; padding: 14px 18px; border-radius: 12px;
  font-size: var(--fs-md); text-align: center; font-family: inherit;
  background: var(--surface); border: 1px solid var(--line-strong); color: var(--text); outline: none; transition: all 0.2s var(--ease);
  backdrop-filter: blur(16px); }
.onboard-input:focus { border-color: var(--accent); box-shadow: 0 0 0 4px var(--accent-soft); }
.dice { padding: 14px 16px; font-size: var(--fs-md); }
.launch { width: 100%; }
.onboard-err { color: var(--danger); margin-top: 10px; font-size: var(--fs-sm); }
.step-nav { display: flex; align-items: center; justify-content: center; gap: 12px; margin-top: 28px; animation: riseIn 0.5s var(--ease) 0.3s both; }
.step-back { min-width: 110px; }
.step-next { min-width: 200px; justify-content: center; }
.loading-dots { display: inline-flex; align-items: center; gap: 6px; justify-content: center }
.loading-dots i { width: 6px; height: 6px; border-radius: 50%; background: currentColor; animation: dotJump 1.2s infinite ease-in-out; }
.loading-dots i:nth-child(2) { animation-delay: .15s }
.loading-dots i:nth-child(3) { animation-delay: .3s }
.loading-dots i:nth-child(4) { animation-delay: .45s }
.loading-dots span { margin-left: 6px; }
@keyframes dotJump { 0%, 60%, 100% { transform: translateY(0); opacity: 0.5 } 30% { transform: translateY(-6px); opacity: 1 } }

@media (max-width: 720px) {
  .onboard-shell { padding: 20px 12px; }
  .step-pill-label { display: none; }
  .step-link { width: 22px; }
  .step-heading { font-size: var(--fs-xl); }
  .step-heading.pick-gap { margin-top: 26px; }
  .pick-grid { grid-template-columns: 1fr; }
  .step-next { min-width: 160px; }
  .step-room .onboard-h1 { font-size: var(--fs-xl); }
  .step-room .onboard-desc { font-size: var(--fs-sm); }
  .word-card { min-width: 280px; max-width: 320px; left: 12px !important; right: 12px; }
  /* 移动端词卡居中显示(覆盖 fixed left) */
  .word-card[style] { left: 50% !important; top: 50% !important; transform: translate(-50%, -50%); }
}

@keyframes riseIn { from { opacity: 0; transform: translateY(8px) } to { opacity: 1; transform: translateY(0) } }
</style>
