<script setup>
import { computed, ref, onMounted, onUnmounted } from 'vue'
import { useUniverse } from '../stores/universe'
import { message } from '../ui'
import GalaxyCanvas from '../three/GalaxyCanvas.vue'
import WordPanel from '../components/WordPanel.vue'
import EmptyState from '../components/EmptyState.vue'
import { CHAPTERS } from '../three/galaxy/flightpath.js'

const store = useUniverse()
const learned = computed(() => store.stats?.learned ?? Object.values(store.states).filter((s) => !s.is_new).length)
const due = computed(() => store.stats?.due_today ?? 0)

// 「只看已点亮」:未学的星整体压暗,你学过的全亮着 —— 星系里一眼回答"我学过什么"
const learnFocus = ref(false)
function toggleLearnFocus() {
  learnFocus.value = !learnFocus.value
  window.dispatchEvent(new CustomEvent('wv:learnFocus', { detail: { on: learnFocus.value } }))
}

// 圣殿版 HUD 极简:左下角一个数据点(词数 / 复习),词根标签是 CSS2D
// 图例 5 态对齐星球真实分类(planet._classify):濒临遗忘红 / 待复习琥珀 / 未学哑光灰 / 学习中青 / 已掌握亮银
const LEGEND = [
  { key: 'critical', label: '濒临遗忘', dot: 'rgba(248,113,113,0.92)' },
  { key: 'due',      label: '待复习',  dot: 'rgba(245,166,35,0.92)' },
  { key: 'unlearned', label: '未学',    dot: 'rgba(139,149,163,0.85)' },
  { key: 'learning',  label: '学习中',  dot: 'rgba(34,211,238,0.9)' },
  { key: 'mastered',  label: '已掌握',  dot: 'rgba(244,246,249,0.95)' },
]

// 引擎构建期轻量遮罩:消费真实开场事件撤掉(引擎开始播开场=场景已就绪),
// 另挂 4s 兜底——引擎异常(无 WebGL 等)时不把用户锁在遮罩里
const building = ref(true)
onMounted(() => { setTimeout(() => { building.value = false }, 4000) })

// === 航行 HUD:开场字幕 / 章节字幕 / 航路刻度 / 继续航行 ===
const introStage = ref(null) // 'birds' | 'word' | 'pull' | 'end' | null
const flightP = ref(0)
const flightEngaged = ref(false)
const flightChapter = ref(0)
const chapterCaption = ref('')
const showRail = computed(() => introStage.value === 'pull' || introStage.value === 'end')
const showResume = computed(() => introStage.value === 'end' && !flightEngaged.value && !store.selectedWordId)
let captionTimer = 0

// 航程进 URL:?chapter=N —— 刷新/分享回来直达章节;写 replaceState 不进历史栈
function syncChapterUrl(ch) {
  try {
    const u = new URL(window.location.href)
    u.searchParams.set('chapter', String(ch))
    window.history.replaceState({}, '', u)
  } catch { /* 隐私模式等,URL 同步失败不影响航行 */ }
}
const pendingChapter = (() => {
  const n = Number(new URLSearchParams(window.location.search).get('chapter'))
  return Number.isInteger(n) && n >= 0 && n < CHAPTERS.length ? n : null
})()

function showChapter(label) {
  chapterCaption.value = label
  clearTimeout(captionTimer)
  captionTimer = setTimeout(() => { chapterCaption.value = '' }, 2800)
}
function onIntro(e) {
  introStage.value = e.detail.stage
  if (e.detail.stage) building.value = false
  if (e.detail.stage === 'end' && pendingChapter != null && pendingChapter > 0) jumpChapter(pendingChapter)
}
function onFlight(e) {
  const { engaged, p, chapter } = e.detail
  if (engaged != null) flightEngaged.value = engaged
  if (p != null) flightP.value = p
  if (chapter != null && chapter !== flightChapter.value) {
    flightChapter.value = chapter
    showChapter(CHAPTERS[chapter].label)
    syncChapterUrl(chapter)
  }
}
function jumpChapter(i) {
  window.dispatchEvent(new CustomEvent('wv:flightJump', { detail: CHAPTERS[i].from }))
}
function resumeFlight(autoplay = false) {
  window.dispatchEvent(new CustomEvent('wv:flightResume', { detail: { autoplay } }))
}

// === 终幕「我的星座」:航路尽头,已学星连成只属于你的星链 ===
const finaleOn = ref(false)
const finaleLearned = ref(0)
// 星座命名:点亮词最多的词根家族为你冠名(星图命名式,同源语言)
const constellationName = computed(() => {
  const count = {}
  for (const w of store.words) {
    const s = store.states[w.id]
    if (s && !s.is_new) count[w.root] = (count[w.root] || 0) + 1
  }
  const top = Object.entries(count).sort((a, b) => b[1] - a[1])[0]
  return top ? `${String(top[0]).toUpperCase()}- 星群` : null
})
const remaining = computed(() => Math.max(0, store.words.length - learned.value))
function onFinale(e) {
  const { on, learned: n } = e.detail || {}
  finaleOn.value = !!on
  if (on) finaleLearned.value = n ?? learned.value
}
// 导出:版面文案发引擎截帧合成,回传 dataURL 后落盘
function exportStarmap() {
  const name = constellationName.value || '第一颗星'
  window.dispatchEvent(new CustomEvent('wv:exportStarmap', { detail: {
    title: `「${name}」`,
    subtitle: `你点亮了 ${finaleLearned.value} 颗星 · 还剩 ${remaining.value} 颗在暗处等光`,
    footer: '词峰 WORDPEAK · THE NIGHT SKY OF ENGLISH',
  }}))
}
function onStarmap(e) {
  const a = document.createElement('a')
  a.href = e.detail?.url
  a.download = `wordpeak-${constellationName.value ? constellationName.value.replace(/[^\w-]+/g, '') : 'starmap'}.png`
  a.click()
  message.success('星图已保存 — 分享你的星座')
}
// 返航:跳回第二幕重新巡游(终幕星链自动收回)
function sailAgain() {
  jumpChapter(1)
}

// 监听要在 setup 里立即挂(不能等 onMounted):GalaxyCanvas 是子组件,
// 引擎 build→_startIntro 的 'wv:intro' 事件早于父组件 onMounted 发出
window.addEventListener('wv:intro', onIntro)
window.addEventListener('wv:flight', onFlight)
window.addEventListener('wv:finale', onFinale)
window.addEventListener('wv:starmap', onStarmap)
onUnmounted(() => {
  window.removeEventListener('wv:intro', onIntro)
  window.removeEventListener('wv:flight', onFlight)
  window.removeEventListener('wv:finale', onFinale)
  window.removeEventListener('wv:starmap', onStarmap)
  clearTimeout(captionTimer)
})
</script>

<template>
  <div class="scene-wrap">
    <GalaxyCanvas />

    <!-- 电影暗角:边缘压暗 40%,视线向中心聚拢(纯装饰层,不挡交互) -->
    <div class="galaxy-vignette" aria-hidden="true" />

    <!-- 左下:极小数据 + 状态图例(航行时收声让位给章节字幕,终幕让位给星座) -->
    <div class="hud-corner" :class="{ dim: flightEngaged, gone: finaleOn }">
      <div class="hud-data">
        <span class="hud-num">{{ learned || 0 }}</span>
        <span class="hud-slash">/ {{ store.words.length }}</span>
        <span class="hud-cap">点亮</span>
        <span v-if="due > 0" class="hud-due">· {{ due }} 词待复习</span>
      </div>
      <button class="hud-chip" :class="{ on: learnFocus }" @click="toggleLearnFocus">
        {{ learnFocus ? '✓ 只看已点亮 — 点回全部星星' : '只看已点亮 · 我学过的' }}
      </button>
      <!-- 已掌握 = 点亮:色点走场景金(LEGEND 数组不动,由 mastered 类覆写) -->
      <div class="hud-legend">
        <span
          v-for="item in LEGEND" :key="item.key"
          class="hud-leg-row" :class="{ mastered: item.key === 'mastered' }"
        >
          <span class="hud-leg-dot" :style="{ '--dot': item.dot }" />
          <span class="hud-leg-label">{{ item.label }}</span>
        </span>
      </div>
      <!-- 操作提示:斜杠分节 + mono,替换原全角破折号长串(排版交给样式层的行高与字距) -->
      <div class="hud-tip">
        滚动 · 航行 / 拖拽 · 自由漫游 / 点一只鸟 · 解封词档案 / 双击词根 · 只留这一族
      </div>
    </div>

    <!-- 开场字幕:鸟群引路 + 一词特写期浮现,拉出时淡出 -->
    <Transition name="capfade">
      <div v-if="introStage === 'birds' || introStage === 'word'" class="intro-caption">
        每一个词，都是一只鸟。<span class="intro-sub">EVERY WORD IS A BIRD</span>
      </div>
    </Transition>

    <!-- 章节字幕:两侧刻线 + 字距收拢(CSS 单动画走完整个 2.8s 生命周期) -->
    <div v-if="chapterCaption" :key="chapterCaption" class="flight-chapter">
      <span class="ch-label">{{ chapterCaption }}</span>
    </div>

    <!-- 航路刻度:右缘竖轨(窄屏横排成底部一排幕点,触屏不再整条消失),4+ 幕节点可点跳转,填充线=已过航程,光点=当前航程 -->
    <div v-if="showRail" class="flight-rail" aria-label="航路刻度">
      <div class="flight-rail-line" />
      <div class="flight-rail-fill" :style="{ '--fp': flightP }" />
      <button
        v-for="(c, i) in CHAPTERS" :key="i"
        class="flight-rail-dot"
        :class="{ passed: flightP >= c.from, active: flightChapter === i }"
        :style="{ '--pos': c.from }"
        :data-label="c.label"
        @click="jumpChapter(i)"
      />
      <div class="flight-rail-thumb" :style="{ '--fp': flightP }" />
    </div>

    <!-- 继续航行:脱离航路(拖拽漫游/看完词卡)后,从当前视野平滑接回航路 -->
    <Transition name="capfade">
      <button v-if="showResume" class="flight-resume" @click="resumeFlight()">
        继续航行 ↓
      </button>
    </Transition>

    <!-- 终幕:我的星座 —— 已学星连成金色星链,星空下浮出只属于你的命名 -->
    <Transition name="capfade">
      <div v-if="finaleOn" class="finale-panel">
        <div class="finale-kicker">终幕 · MY CONSTELLATION</div>
        <!-- 星座名逐字从模糊里凝出:与 3D 星链绘制同一时刻的"命名仪式" -->
        <BlurText
          :text="constellationName || '第一颗星'"
          as="div"
          class="finale-name"
          :stagger="70"
        />
        <div v-if="finaleLearned > 0" class="finale-line">
          你点亮了 {{ finaleLearned }} 颗星 · 还剩 {{ remaining }} 颗在暗处等光
        </div>
        <div v-else class="finale-line finale-line-dim">
          宇宙仍在等它的第一颗星 —— 去解封一颗词，让它记住你
        </div>
        <div class="finale-actions">
          <button v-if="finaleLearned > 0" class="finale-btn primary" @click="exportStarmap">
            导出星图
          </button>
          <button class="finale-btn" @click="sailAgain">返航 · 再巡一次</button>
        </div>
      </div>
    </Transition>

    <div v-if="!store.fetching && !store.words.length" class="galaxy-empty">
      <EmptyState
        title="词库里还没有鸟落进来"
        desc="词汇数据刷新一下通常就能加载出来;一直空着,晚点再来"
      />
    </div>

    <WordPanel v-if="store.selectedWordId" />

    <Transition name="fade">
      <div v-if="building" class="galaxy-loading" aria-label="构建展厅中">
        <div class="galaxy-loading-dot" />
        <div class="galaxy-loading-text">构建展厅中</div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
/* === 场景字幕配色:画布恒为深空(引擎 scene.background=#05070f),
   浮在画布上的字幕不随页面主题换深字——晴空下锁回深空基底自己的亮阶
   (取 styles.css :root 调色板同值/同族派生,不发明新色相) === */
.scene-wrap {
  --cap-text: var(--text);
  --cap-sub: var(--text-2);
  --cap-dim: var(--text-3);
  --cap-line: color-mix(in srgb, var(--text-2) 20%, transparent);
}
:root[data-theme='light'] .scene-wrap {
  --cap-text: #f5f7fa;   /* = 深空基底 --text */
  --cap-sub: #a8b0c0;    /* = 深空基底 --text-2 */
  --cap-dim: #8b94a8;    /* 深空 text-3→text-2 之间的派生阶(小字幕对比兜底) */
  --cap-line: rgba(168, 176, 192, 0.22);
}

/* === 词汇圣殿 HUD:左下角极简 === */
.hud-corner {
  position: absolute; left: 22px; bottom: 20px; z-index: 10;
  display: flex; flex-direction: column; gap: 10px; align-items: flex-start;
  max-width: calc(100vw - 44px);
  padding: 16px 20px 17px; border-radius: var(--r-lg);
  /* 读出板:与 .scene-hud/.scene-tip 同一玻璃配方,
     让裸文字落回仪器语言(顺带解决浅色主题下深字贴深画布不可读) */
  background: color-mix(in srgb, var(--surface) 80%, transparent);
  border: 1px solid var(--line-strong);
  box-shadow: var(--shadow-scene);
  backdrop-filter: blur(22px) saturate(1.4);
  -webkit-backdrop-filter: blur(22px) saturate(1.4);
  pointer-events: none; /* 雕塑不抢点击;需要点击的元素自开 */
  animation: riseIn 0.6s var(--ease) 0.3s backwards; /* 不用 both:终态交给 css,transition 才活得了 */
  transition: opacity 0.5s var(--ease);
}
/* 航行中收声:左下数据让位给章节字幕 */
.hud-corner.dim { opacity: 0.45; }
.hud-data {
  font-family: var(--mono); font-size: var(--fs-sm); color: var(--text-2);
  display: flex; gap: 6px; align-items: baseline;
  letter-spacing: 0.04em;
}
/* 点亮数是圣殿的「名字时刻」:衬线大字 + 场景金,读数一眼可辨 */
.hud-num {
  font-family: var(--serif); font-size: 30px; font-weight: 600;
  color: var(--gold-scene); line-height: 1;
  text-shadow: 0 0 18px color-mix(in srgb, var(--gold-scene) 30%, transparent);
}
.hud-slash { color: var(--text-3); }
.hud-cap { color: var(--text-3); }
.hud-due { color: var(--accent); margin-left: 4px; }
.hud-legend {
  display: flex; gap: 14px;
  /* 三段读出(数据+开关 / 图例 / 提示)之间发丝线分层:玻璃读出板上的仪表分区 */
  padding-top: 8px; border-top: 1px solid var(--line);
}
.hud-leg-row { display: inline-flex; align-items: center; gap: 5px; font-size: var(--fs-xs); color: var(--text-3); letter-spacing: 0.04em; }
.hud-leg-dot {
  width: 7px; height: 7px; border-radius: 50%;
  background: var(--dot);
  box-shadow: 0 0 6px var(--dot);
}
/* 已掌握 = 点亮:色点换场景金(画布恒深空,--gold-scene 不随页面主题翻成暗琥珀),覆写不吃 LEGEND 数组 */
.hud-leg-row.mastered .hud-leg-dot {
  background: var(--gold-scene);
  box-shadow: 0 0 6px color-mix(in srgb, var(--gold-scene) 60%, transparent);
}
.hud-tip {
  /* mono 仪表小字 + 斜杠分节 + 松行高:替代原全角破折号长串裸排 */
  font-family: var(--mono);
  font-size: var(--fs-xs); color: var(--text-3); letter-spacing: 0.05em;
  line-height: 1.9; max-width: 480px;
  padding-top: 8px; border-top: 1px solid var(--line);
}

/* 电影暗角:四角压暗,画面立刻"有取景框" */
.galaxy-vignette {
  position: absolute; inset: 0; z-index: 5;
  pointer-events: none;
  background:
    radial-gradient(ellipse 120% 90% at 50% 46%, transparent 58%, rgba(2,4,10,0.55) 100%);
}

/* 加载遮罩(引擎构建期):文字/光点走场景配色(浮在深空画布上) */
.galaxy-loading {
  position: absolute; inset: 0; z-index: 6;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px;
  pointer-events: none;
  background: radial-gradient(circle at center, color-mix(in srgb, var(--glow-accent) 7%, transparent), transparent 60%);
}
.galaxy-loading-dot {
  width: 40px; height: 40px; border-radius: 50%;
  background: color-mix(in srgb, var(--glow-accent) 55%, transparent);
  box-shadow: 0 0 12px var(--glow-accent), 0 0 24px color-mix(in srgb, var(--glow-accent) 35%, transparent);
  animation: galaxyPulse 1.4s ease-in-out infinite;
}
.galaxy-loading-text {
  color: var(--cap-sub); font-size: var(--fs-sm);
  font-family: var(--mono);
  letter-spacing: 0.34em; text-indent: 0.34em;
  /* 复用章节字幕的「字距收拢」动画语言(0.55→0.34em 同一对数字),叠一层淡入:光点脉冲时字在对焦 */
  animation: loadingTrack 1.8s var(--ease) both;
}
@keyframes loadingTrack {
  from { letter-spacing: 0.55em; text-indent: 0.55em; opacity: 0; }
  to { letter-spacing: 0.34em; text-indent: 0.34em; opacity: 1; }
}
@keyframes galaxyPulse {
  0%, 100% { transform: scale(0.85); opacity: 0.7; }
  50% { transform: scale(1.15); opacity: 1; }
}

/* 词库为空遮罩 */
.galaxy-empty {
  position: absolute; inset: 0; z-index: 7;
  display: flex; align-items: center; justify-content: center;
  background: color-mix(in srgb, var(--bg) 80%, transparent);
  backdrop-filter: blur(6px);
}

/* === 开场字幕:一词特写期的世界宣言(拉出时淡出) === */
.intro-caption {
  position: absolute; left: 50%; bottom: 23vh; transform: translateX(-50%);
  z-index: 8; white-space: nowrap; pointer-events: none; text-align: center;
  font-size: clamp(22px, 3.2vw, 38px); color: var(--cap-text);
  letter-spacing: 0.42em; text-indent: 0.42em; /* 补偿末字间距,视觉真正居中 */
  font-family: var(--serif);
  text-shadow: 0 2px 26px rgba(0, 0, 0, 0.75), 0 0 40px rgba(0, 0, 0, 0.4);
}
/* 英文小注:衬线中文宣言下面一行等宽小字,电影片头的双语排版 */
.intro-sub {
  display: block; margin-top: 2px;
  font-family: var(--mono); font-size: var(--fs-2xs); font-weight: 500;
  color: var(--cap-dim); letter-spacing: 0.52em; text-indent: 0.52em;
  text-transform: uppercase;
}
/* 宣言与小注之间:一枚场景金小星 + 两侧发丝线 —— 命名仪式前的停顿 */
.intro-sub::before {
  content: '✦';
  display: block; width: 170px; margin: 13px auto 12px;
  text-align: center; line-height: 1;
  font-family: var(--serif); font-size: var(--fs-2xs); color: var(--gold-scene);
  text-shadow: 0 0 12px color-mix(in srgb, var(--gold-scene) 45%, transparent);
  background:
    linear-gradient(to right, transparent, var(--cap-line)) left center / 38% 1px no-repeat,
    linear-gradient(to left, transparent, var(--cap-line)) right center / 38% 1px no-repeat;
}

/* === 章节字幕:两侧刻线夹一行衬线小字,单动画走完 2.8s 生命周期 === */
.flight-chapter {
  position: absolute; left: 50%; bottom: 86px; transform: translateX(-50%);
  z-index: 8; pointer-events: none;
  display: flex; align-items: center; gap: 14px;
  animation: chapterFade 2.8s var(--ease) both;
}
.flight-chapter::before, .flight-chapter::after {
  content: ''; width: 30px; height: 1px; flex: none;
  background: linear-gradient(to right, transparent, var(--cap-line));
}
.flight-chapter::after { background: linear-gradient(to left, transparent, var(--cap-line)); }
.ch-label {
  display: inline-block; white-space: nowrap;
  font-size: var(--fs-md); color: var(--cap-text); /* 章节名提亮一档:字幕是一幕的「名字」,值得最亮阶 */
  font-family: var(--serif);
  text-shadow: 0 1px 14px rgba(0, 0, 0, 0.7);
  animation: chapterTrack 2.8s var(--ease) both;
}
@keyframes chapterFade {
  0% { opacity: 0; transform: translateX(-50%) translateY(6px); }
  12% { opacity: 1; transform: translateX(-50%) translateY(0); }
  82% { opacity: 1; }
  100% { opacity: 0; }
}
@keyframes chapterTrack { from { letter-spacing: 0.55em; } to { letter-spacing: 0.34em; } }

/* 字幕统一入场:失焦到聚焦(不只是 fade) */
.capfade-enter-active, .capfade-leave-active {
  transition: opacity 0.7s var(--ease), filter 0.7s var(--ease);
}
.capfade-enter-from, .capfade-leave-to { opacity: 0; filter: blur(6px); }

/* === 航路刻度:右缘竖轨(填充线=已过航程,菱形幕点可点跳) === */
.flight-rail {
  position: absolute; right: 20px; top: 50%; transform: translateY(-50%);
  height: 34vh; width: 16px; z-index: 10; pointer-events: none;
}
.flight-rail-line {
  position: absolute; right: 7px; top: 0; bottom: 0; width: 1px;
  background: linear-gradient(to bottom, transparent, var(--cap-line) 15%, var(--cap-line) 85%, transparent);
}
/* 已过航程:底线上一道 accent 填充,带一点辉光 —— "走过多少路"一眼可读
   (--fp 是 JS 进度 0-1,横竖两版共用;窄屏横排时 width 接管;
   浮在画布上的发光用 --glow-accent:引擎发光令牌,浅色主题下比 UI accent 亮) */
.flight-rail-fill {
  position: absolute; right: 7px; top: 0; width: 1px; height: calc(var(--fp, 0) * 100%);
  background: linear-gradient(to bottom, color-mix(in srgb, var(--glow-accent) 10%, transparent), var(--glow-accent) 70%);
  box-shadow: 0 0 6px color-mix(in srgb, var(--glow-accent) 55%, transparent);
  transition: height 0.15s linear;
}
.flight-rail-thumb {
  position: absolute; right: 4px; width: 7px; height: 7px; border-radius: 50%;
  top: calc(var(--fp, 0) * 100%); transform: translateY(-50%);
  background: var(--glow-accent);
  box-shadow: 0 0 8px var(--glow-accent), 0 0 16px color-mix(in srgb, var(--glow-accent) 40%, transparent);
}
.flight-rail-dot {
  position: absolute; right: 5px; width: 5px; height: 5px;
  top: calc(var(--pos, 0) * 100%); transform: translateY(-50%);
  border: 0; padding: 0; cursor: pointer; pointer-events: auto;
  background: transparent; --diamond: var(--cap-sub);
}
/* 菱形本体挪到 ::before:按钮自身不再 rotate(45deg) ——
   之前整个按钮旋转,::after 标签跟着斜 45°,玻璃胶囊必须落在正交坐标系里才立得住 */
.flight-rail-dot::before {
  content: ''; position: absolute; inset: 0;
  transform: rotate(45deg); /* 菱形幕点,和衬线刻字的仪式感同频 */
  background: var(--diamond); opacity: 0.5;
  transition: transform 0.3s var(--ease), opacity 0.3s var(--ease),
    background-color 0.3s var(--ease), box-shadow 0.3s var(--ease);
}
.flight-rail-dot.passed { --diamond: var(--glow-accent); }
.flight-rail-dot.passed::before { opacity: 0.85; }
.flight-rail-dot.active::before { opacity: 1; box-shadow: 0 0 8px var(--glow-accent); }
.flight-rail-dot:hover::before { transform: rotate(45deg) scale(1.7); }
/* hover 标签:幕名从点旁浮出,套 hud-chip 同款玻璃胶囊配方(表面玻璃 + hairline + blur) */
.flight-rail-dot::after {
  content: attr(data-label);
  position: absolute; right: 14px; top: 50%;
  transform: translateY(-50%) translateX(5px);
  padding: 3px 10px; border-radius: 999px;
  background: color-mix(in srgb, var(--surface) 72%, transparent);
  border: 1px solid var(--line); color: var(--text-3);
  font-family: var(--font); font-size: var(--fs-2xs);
  letter-spacing: 0.1em; white-space: nowrap; pointer-events: none;
  backdrop-filter: blur(14px) saturate(1.3);
  -webkit-backdrop-filter: blur(14px) saturate(1.3);
  opacity: 0; transition: opacity 0.25s var(--ease), transform 0.25s var(--ease);
}
.flight-rail-dot:hover::after { opacity: 1; transform: translateY(-50%) translateX(0); }

/* === 继续航行:脱离航路后接回 === */
.flight-resume {
  position: absolute; right: 18px; bottom: 22px; z-index: 12;
  padding: 7px 16px; border-radius: 999px;
  background: color-mix(in srgb, var(--surface) 72%, transparent);
  border: 1px solid var(--line-accent); color: var(--accent);
  font-family: var(--font); font-size: var(--fs-xs); font-weight: 600;
  letter-spacing: 0.06em; cursor: pointer;
  backdrop-filter: blur(16px) saturate(1.4);
  -webkit-backdrop-filter: blur(16px) saturate(1.4);
  transition: background 0.2s var(--ease), box-shadow 0.2s var(--ease);
}
.flight-resume:hover {
  transform: translateY(-2px);
  background: var(--accent-soft);
  box-shadow: 0 0 18px color-mix(in srgb, var(--accent) 25%, transparent);
}

/* === 终幕「我的星座」:星空下浮出的命名石碑 === */
.hud-corner.gone { opacity: 0; }
.finale-panel {
  position: absolute; left: 50%; bottom: 9vh; transform: translateX(-50%);
  z-index: 12; pointer-events: none; text-align: center;
  display: flex; flex-direction: column; align-items: center; gap: 10px;
  padding: 0 20px;
}
.finale-kicker {
  font-family: var(--mono); font-size: var(--fs-2xs); font-weight: 500;
  color: var(--cap-dim); letter-spacing: 0.5em; text-indent: 0.5em;
  animation: unsealRise 0.6s var(--ease) 0.1s backwards;
}
/* 星座名本体交给 BlurText 逐字凝出,容器自身入场动画置空,避免双重动画 */
.finale-name {
  font-family: var(--serif);
  font-size: clamp(26px, 4.2vw, 46px); font-weight: 600;
  color: var(--gold-scene); /* 全宇宙唯一的暖:与词峰之心塔尖灯同源 */
  letter-spacing: 0.14em; text-indent: 0.14em;
  text-shadow: 0 2px 30px rgba(0, 0, 0, 0.8), 0 0 46px color-mix(in srgb, var(--gold-scene) 18%, transparent);
}
.finale-line {
  font-family: var(--serif);
  font-size: var(--fs-base); color: var(--cap-sub); letter-spacing: 0.22em; text-indent: 0.22em;
  animation: unsealRise 0.6s var(--ease) 0.4s backwards;
}
.finale-line-dim { color: var(--cap-dim); }
.finale-actions {
  display: flex; gap: 10px; margin-top: 10px; pointer-events: auto;
  animation: unsealRise 0.6s var(--ease) 0.56s backwards;
}
.finale-btn {
  padding: 8px 20px; border-radius: 999px; cursor: pointer;
  background: color-mix(in srgb, var(--surface) 72%, transparent);
  border: 1px solid var(--line-strong); color: var(--text-2);
  font-family: var(--font); font-size: var(--fs-xs); font-weight: 500; letter-spacing: 0.06em;
  backdrop-filter: blur(16px) saturate(1.4);
  -webkit-backdrop-filter: blur(16px) saturate(1.4);
  transition: all 0.25s var(--ease);
}
.finale-btn:hover {
  transform: translateY(-2px);
  border-color: var(--line-accent); color: var(--text);
  box-shadow: 0 0 18px color-mix(in srgb, var(--accent) 18%, transparent);
}
.finale-btn.primary {
  border-color: var(--line-accent); color: var(--gold-scene);
}
.finale-btn.primary:hover {
  background: color-mix(in srgb, var(--gold-scene) 10%, transparent);
  box-shadow: 0 0 22px color-mix(in srgb, var(--gold-scene) 22%, transparent);
}
@media (max-width: 600px) {
  /* 窄屏:刻度轨不再整条消失——横排成底部一排菱形幕点,触屏也能跳幕
     (竖版 height/top 的 inline 全换成了 --fp/--pos 变量,这里 width/left 接管) */
  .flight-rail {
    right: 50%; transform: translateX(50%); top: auto; bottom: 18px;
    height: 12px; width: min(72vw, 320px);
  }
  .flight-rail-line {
    right: auto; left: 0; top: 5.5px; bottom: auto; width: 100%; height: 1px;
    background: linear-gradient(to right, transparent, var(--line-strong) 15%, var(--line-strong) 85%, transparent);
  }
  .flight-rail-fill {
    right: auto; left: 0; top: 5.5px; height: 1px; width: calc(var(--fp, 0) * 100%);
    background: linear-gradient(to right, color-mix(in srgb, var(--accent) 10%, transparent), var(--accent) 70%);
    transition: width 0.15s linear;
  }
  .flight-rail-thumb {
    right: auto; top: 3px; left: calc(var(--fp, 0) * 100%); transform: translateX(-50%);
  }
  .flight-rail-dot {
    right: auto; top: 2.5px; left: calc(var(--pos, 0) * 100%);
    width: 7px; height: 7px; /* 触屏手指目标大一点 */
    transform: translateX(-50%);
  }
  .flight-rail-dot:hover::before { transform: rotate(45deg) scale(1.5); }
  /* 触屏没有 hover:幕名直接钉在当前幕点下方,常亮 */
  .flight-rail-dot::after {
    right: auto; left: 50%; top: 16px;
    transform: translateX(-50%);
  }
  .flight-rail-dot.active::after { opacity: 1; transform: translateX(-50%); }
  .intro-caption { letter-spacing: 0.2em; text-indent: 0.2em; bottom: 26vh; }
}

/* 只看已点亮:读出板上的一枚胶囊开关,开着时它就是当前视角的说明书 */
.hud-chip {
  margin: 4px 0 8px; padding: 6px 15px; border-radius: 999px; cursor: pointer;
  background: color-mix(in srgb, var(--surface) 72%, transparent);
  border: 1px solid var(--line); color: var(--text-3);
  font-family: var(--font); font-size: var(--fs-sm); font-weight: 500; letter-spacing: 0.05em;
  backdrop-filter: blur(14px) saturate(1.3);
  -webkit-backdrop-filter: blur(14px) saturate(1.3);
  transition: all 0.25s var(--ease);
}
.hud-chip:hover {
  transform: translateY(-2px);
  border-color: var(--line-accent); color: var(--text);
}
.hud-chip.on {
  border-color: var(--line-accent); color: var(--accent);
  box-shadow: 0 0 16px color-mix(in srgb, var(--accent) 16%, transparent);
}

.fade-enter-active, .fade-leave-active { transition: opacity 0.3s var(--ease); }
.fade-enter-from, .fade-leave-to { opacity: 0; }

/* 窄屏:读出板贴边收窄,长提示行隐藏,别把 3D 画面盖满 */
@media (max-width: 600px) {
  .hud-corner { left: 12px; bottom: 12px; padding: 10px 12px 11px; max-width: calc(100vw - 24px); }
  .hud-tip { display: none; }
  .hud-legend { gap: 10px; }
}
</style>
