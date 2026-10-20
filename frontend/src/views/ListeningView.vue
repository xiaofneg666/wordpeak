<script setup>
import { ref, computed, watch, onMounted, onUnmounted, onActivated, onDeactivated, nextTick } from 'vue'
import HowToTrain from '../components/HowToTrain.vue'
import SettleCard from '../components/SettleCard.vue'
import { useUniverse } from '../stores/universe'
import { api } from '../api'
import { speak, stopSpeaking } from '../speech'
import EmptyState from '../components/EmptyState.vue'
import { message } from '../ui'

const store = useUniverse()
const listening = computed(() => store.passages.filter((p) => p.type === 'listening'))
const pid = ref(null)
const p = computed(() => listening.value.find((x) => x.id === pid.value))

const rate = ref(0.9)
const playing = ref(false)
const activeIdx = ref(-1)
const answers = ref({})
const results = ref({})
const submitted = ref(null)
const loopIdx = ref(-1) // AB 循环中的句子下标(-1 = 未开启)
const showZh = ref({}) // 句子译文:精听默认收起,点了才亮(与阅读号同口径)

function toggleZh(i) { showZh.value = { ...showZh.value, [i]: !showZh.value[i] } }

let alive = true
// 波形 canvas 无法吃 color-mix/rgba token:缓存主题色,主题切换事件里刷新并重绘
const waveColors = { accent: '#22d3ee', success: '#4ade80' }
function refreshWaveColors() {
  try {
    const cs = getComputedStyle(document.documentElement)
    const a = cs.getPropertyValue('--accent').trim()
    const s = cs.getPropertyValue('--success').trim()
    if (a) waveColors.accent = a
    if (s) waveColors.success = s
  } catch { /* 读不到沿用缓存 */ }
  drawWave()
}
onMounted(() => {
  window.addEventListener('wv:themechange', refreshWaveColors)
  refreshWaveColors()
})
onUnmounted(() => window.removeEventListener('wv:themechange', refreshWaveColors))
// 语速:进入时恢复你上次调好的档位(档案优先),改动后写回档案
const clampRate = (v) => Math.min(1.2, Math.max(0.6, Number(v) || 0.9))
onMounted(() => {
  window.addEventListener('resize', fitCanvas); fitCanvas()
  // 错题本深链:带着具体语料进入(取 loadUniverse 已灌好的 store.passages)
  if (store.pendingPassage?.mod === 'listening') { pid.value = store.pendingPassage.id; store.pendingPassage = null }
  const saved = store.profile.prefs.speechRate ?? store.settings.speechRate
  if (saved != null) rate.value = clampRate(saved)
})
// KeepAlive 回谷:可能带着错题深链的新篇(正在精听的篇切走再回来直接落那篇)
onActivated(() => {
  alive = true
  if (store.pendingPassage?.mod === 'listening') { pid.value = store.pendingPassage.id; store.pendingPassage = null }
  drawWave() // 后台停掉过游标循环,回谷重画一次当前波形
})
// KeepAlive 切走:朗读/波形循环别在后台继续(alive 停更新,回谷恢复)
onDeactivated(() => { stopSpeaking(); cancelAnimationFrame(waveRaf); waveRaf = 0; alive = false })
// 档案异步加载晚于挂载时补一次同步(写回的是同值,不会互相打架)
watch(() => store.profile.prefs.speechRate, (v) => { if (v != null) rate.value = clampRate(v) })
onUnmounted(() => {
  alive = false
  window.removeEventListener('resize', fitCanvas)
  cancelAnimationFrame(waveRaf)
  stopSpeaking()
})
watch(() => [pid.value, rate.value], () => nextTick(fitCanvas))
// 语速落库:滑块松手(@change)或点快捷档时写一次,避免拖动过程中反复请求
function commitRate() { store.setPref('speechRate', rate.value) }
function setRate(r) { rate.value = r; commitRate() }
const rateHint = computed(() =>
  rate.value <= 0.7 ? '跟不上就保持这档'
  : rate.value >= 1.1 ? '和日常说话差不多了'
  : '这档听顺了再往上调')

function pickPassage(x) {
  stopSpeaking()
  pid.value = x.id
  answers.value = {}; results.value = {}; submitted.value = null
  playing.value = false; activeIdx.value = -1; loopIdx.value = -1; showZh.value = {}
}

// 信号轨道的小声纹:从篇目标题确定性生成 7 根能量柱(同一篇每次一样,不闪随机)
function waveOf(x) {
  const seed = [...x.title].reduce((a, c) => a + c.charCodeAt(0) * 7, 11)
  return Array.from({ length: 7 }, (_, i) =>
    24 + Math.round(58 * Math.abs(Math.sin((seed + i * 13) * 0.37) * Math.cos((seed + i * 5) * 0.21))))
}

// ---------- 共享波形条 ----------
// 合成语音拿不到真实采样,按句文本确定性生成静态伪波形;
// 每句一段能量条(宽度∝估算时长),句间边界画 mark,播放时绿色游标扫过对应区间。
const waveCanvas = ref(null)
const BARS_PER_SEC = 26 // 每秒画多少根能量条
let waveRaf = 0
let segT0 = 0       // 当前句播放起始时间戳(游标推进用)
let cursorIdx = -1  // 游标当前所在句
let cursorProgress = 0

function pseudoBars(text, n) {
  const seed = [...text].reduce((a, c) => a + c.charCodeAt(0), 0)
  return Array.from({ length: n }, (_, i) => {
    const t = i * 0.31 + seed * 0.11
    return 0.16 + 0.84 * Math.abs(Math.sin(t * 3.1) * Math.cos(t * 1.7))
  })
}
// 估算单句朗读时长(秒):词数 / (2.5 词每秒 × 语速) + 收尾留白
function estSec(s) {
  const words = s.en.split(/\s+/).filter(Boolean).length
  return words / (2.5 * rate.value) + 0.4
}
const segs = computed(() => {
  if (!p.value) return []
  return p.value.sentences.map((s) => {
    const sec = estSec(s)
    return { sec, bars: pseudoBars(s.en, Math.max(14, Math.round(sec * BARS_PER_SEC))) }
  })
})

function fitCanvas() {
  const cvs = waveCanvas.value
  if (!cvs) return
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  cvs.width = Math.round((cvs.clientWidth || 600) * dpr)
  cvs.height = Math.round(64 * dpr)
  drawWave()
}

// 句区间布局(画布像素坐标):每根能量条等宽,句间留缝
function layoutSegs() {
  const list = segs.value
  const cvs = waveCanvas.value
  if (!list.length || !cvs) return []
  const dpr = cvs.height / 64
  const gap = 10 * dpr
  const totalBars = list.reduce((a, s) => a + s.bars.length, 0)
  const unit = (cvs.width - gap * (list.length - 1)) / totalBars
  let x = 0
  return list.map((seg, i) => {
    const w = seg.bars.length * unit
    const box = { i, x, w, unit }
    x += w + gap
    return box
  })
}

function drawWave() {
  const cvs = waveCanvas.value
  if (!cvs) return
  const ctx2d = cvs.getContext('2d')
  const W = cvs.width, H = cvs.height
  ctx2d.clearRect(0, 0, W, H)
  const boxes = layoutSegs()
  if (!boxes.length) return
  const dpr = H / 64
  const padTop = 14 * dpr
  const avail = H - padTop - 2 * dpr
  const idx = loopIdx.value >= 0 ? loopIdx.value : activeIdx.value
  const progress = cursorIdx === idx ? cursorProgress : -1
  boxes.forEach((box) => {
    const seg = segs.value[box.i]
    const active = box.i === idx
    // 句边界 mark:竖线 + 句号(canvas 无 alpha token,用 globalAlpha 分档)
    ctx2d.globalAlpha = active ? 0.85 : 0.28
    ctx2d.fillStyle = waveColors.accent
    ctx2d.fillRect(box.x, 1.5 * dpr, 1.4 * dpr, H - 3 * dpr)
    ctx2d.font = `${9 * dpr}px ${getComputedStyle(cvs).fontFamily || 'monospace'}`
    ctx2d.fillText(String(box.i + 1), box.x + 3 * dpr, 9.5 * dpr)
    // 能量条:当前句高亮发光 / 已播过半亮 / 未播暗
    ctx2d.globalAlpha = active ? 0.95 : box.i < idx ? 0.45 : 0.22
    if (active) { ctx2d.shadowColor = waveColors.accent; ctx2d.shadowBlur = 5 * dpr }
    const barW = Math.max(1, box.unit * 0.62)
    seg.bars.forEach((v, k) => {
      const h = Math.max(2 * dpr, v * avail)
      ctx2d.fillRect(box.x + k * box.unit + (box.unit - barW) / 2, padTop + (avail - h) / 2, barW, h)
    })
    ctx2d.shadowBlur = 0
    ctx2d.globalAlpha = 1
    // 播放头游标:绿色光标扫过当前句区间
    if (active && progress >= 0) {
      const cx = box.x + progress * box.w
      ctx2d.shadowColor = waveColors.success
      ctx2d.shadowBlur = 8 * dpr
      ctx2d.fillStyle = waveColors.success
      ctx2d.fillRect(cx, 0, 2 * dpr, H)
      ctx2d.beginPath()
      ctx2d.moveTo(cx - 3 * dpr, 0)
      ctx2d.lineTo(cx + 5 * dpr, 0)
      ctx2d.lineTo(cx + 1 * dpr, 5 * dpr)
      ctx2d.closePath()
      ctx2d.fill()
      ctx2d.shadowBlur = 0
    }
  })
}

function tickCursor() {
  const idx = loopIdx.value >= 0 ? loopIdx.value : activeIdx.value
  if (!alive || idx < 0 || !segs.value[idx]) {
    cursorIdx = -1; cursorProgress = 0
    drawWave()
    waveRaf = 0
    return
  }
  cursorIdx = idx
  cursorProgress = Math.min(1, (performance.now() - segT0) / 1000 / segs.value[idx].sec)
  drawWave()
  waveRaf = requestAnimationFrame(tickCursor)
}
function startCursor(i) {
  segT0 = performance.now()
  cursorProgress = 0
  cursorIdx = i
  if (!waveRaf) waveRaf = requestAnimationFrame(tickCursor)
}

// 点击波形区间 → 播放对应句
function onWaveClick(e) {
  const cvs = waveCanvas.value
  if (!cvs || !p.value) return
  const rect = cvs.getBoundingClientRect()
  const cx = (e.clientX - rect.left) * (cvs.width / rect.width)
  const hit = layoutSegs().find((b) => cx >= b.x - 6 && cx <= b.x + b.w + 6)
  if (hit) replayOne(hit.i)
}

function playAll() {
  if (!p.value) return
  loopIdx.value = -1
  playing.value = true
  const seq = (i) => {
    if (!alive || !playing.value) { if (alive) { activeIdx.value = -1; drawWave() } return }
    if (i >= p.value.sentences.length) { playing.value = false; activeIdx.value = -1; drawWave(); return }
    activeIdx.value = i
    startCursor(i)
    speak(p.value.sentences[i].en, { rate: rate.value, absolute: true, onend: () => seq(i + 1) })
  }
  seq(0)
}
function stop() {
  stopSpeaking()
  playing.value = false; activeIdx.value = -1; loopIdx.value = -1
}
function replayOne(i) {
  if (!p.value) return
  loopIdx.value = -1
  activeIdx.value = i
  startCursor(i)
  speak(p.value.sentences[i].en, {
    rate: rate.value,
    absolute: true, // 滑杆恢复的就是全局 speechRate,不能再乘基准
    onend: () => {
      if (alive && activeIdx.value === i && loopIdx.value < 0) { activeIdx.value = -1; drawWave() }
    },
  })
}

// ---------- 单句循环(循环按钮或长按喇叭触发,再点一次退出) ----------
function toggleLoop(i) {
  if (loopIdx.value === i) { loopIdx.value = -1; stopSpeaking(); activeIdx.value = -1; return }
  stopSpeaking()
  playing.value = false
  loopIdx.value = i
  loopOnce(i)
}
function loopOnce(i) {
  if (!alive || loopIdx.value !== i || !p.value) return
  activeIdx.value = i
  startCursor(i)
  speak(p.value.sentences[i].en, {
    rate: rate.value,
    absolute: true,
    onend: () => { if (alive && loopIdx.value === i) setTimeout(() => loopOnce(i), 700) }, // 句间留 0.7s 喘息
  })
}
// 长按喇叭 500ms 进入循环;提前松开则按普通单句播放
let lpTimer = 0
function playDown(i) { lpTimer = setTimeout(() => { lpTimer = 0; toggleLoop(i) }, 500) }
function playUp(i) { if (lpTimer) { clearTimeout(lpTimer); lpTimer = 0; replayOne(i) } }
function playLeave() { if (lpTimer) { clearTimeout(lpTimer); lpTimer = 0 } }

// 上次这篇的成绩(结算卡对比行):提交前先取——此刻库里最新一条就是「上次」
async function lastAccuracy(passageId) {
  try {
    const r = await api.historyPassages('listening', store.user?.id, 20)
    return r?.items?.find((i) => i.passage_id === passageId)?.accuracy ?? null
  } catch { return null }
}

async function pick(qi, oi) {
  if (answers.value[qi] !== undefined || !p.value) return
  const correct = oi === p.value.questions[qi].answer
  answers.value = { ...answers.value, [qi]: oi }
  results.value = { ...results.value, [qi]: correct }
  if (Object.keys({ ...answers.value, [qi]: oi }).length === p.value.questions.length) {
    const right = Object.values({ ...results.value, [qi]: correct }).filter(Boolean).length
    const prev = await lastAccuracy(p.value.id)
    submitted.value = { right, total: p.value.questions.length, accuracy: right / p.value.questions.length, prev }
    try { await store.api_submitListening(p.value.id, right, p.value.questions.length); store.refreshStats() }
    catch { message.warning('成绩没能入库(后端不可达)，本轮结果只在本页显示') }
  }
}

// 结算一句话:按真实正确率分档说,不空夸也不一棍子打死
function resultLine(sb) {
  if (sb.accuracy >= 0.9) return `${sb.right}/${sb.total} 全对，这篇你听懂了`
  if (sb.accuracy >= 0.7) return `对了 ${sb.right}/${sb.total}，把错题的解释看一眼，下一遍会顺很多`
  if (sb.accuracy >= 0.5) return `对了 ${sb.right}/${sb.total}，建议调回 0.6x 把错的那几句再听一遍`
  return `对了 ${sb.right}/${sb.total}，不急，回到上面的波形从第一句重新过一遍`
}

function optCls(qi, oi, q) {
  if (answers.value[qi] === undefined) return ''
  if (oi === q.answer) return 'correct'
  if (oi === answers.value[qi]) return 'wrong'
  return ''
}
</script>

<template>
  <div class="view-scroll">
    <div class="view-inner fade-in">
      <div class="terr-head">
        <div class="terr-kicker">TERRITORY · LISTENING</div>
        <h2 class="terr-title"><BlurText text="回声谷" as="span" /></h2>
        <div class="terr-latin">ECHO CANYON</div>
        <div class="terr-rule" aria-hidden="true" />
        <p class="terr-sub">
          声音在岩壁间来回弹。第一遍用 0.6x 慢速进谷，哪句没跟上就单独循环那一句，听顺了再做下面的题出谷。
        </p>
      </div>

      <!-- 怎么练才有效:方法论条(收起一行,展开步骤) -->
      <HowToTrain view="listening" />

      <!-- 语料加载中:skeleton 占位 -->
      <template v-if="store.fetching">
        <div class="passage-head">
          <span v-for="i in 3" :key="i" class="skeleton sk-pick" :style="{ width: `${100 + i * 20}px` }" />
        </div>
        <div class="card">
          <div class="skeleton sk-line" :style="{ width: '38%', height: '18px' }" />
          <div class="skeleton sk-line" :style="{ width: '100%', height: '48px', marginTop: '14px' }" />
          <div v-for="i in 4" :key="i" class="skeleton sk-line" :style="{ width: `${96 - i * 4}%`, height: '52px', marginTop: '10px' }" />
        </div>
      </template>

      <!-- 无语料:空态 -->
      <EmptyState
        v-else-if="!listening.length"
        icon="谷" title="这里还没有听力语料"
        desc="语料刷新一下通常就能加载出来;一直空着,晚点再来"
      />

      <template v-else>
        <!-- 还没选信号:回声谷的信号轨道——每条信号是一个从谷底传来的声纹,不是一张卡片 -->
        <div v-if="!p" class="signal-list">
          <div class="signal-hint text-mono">PICK A SIGNAL · 谷里有 {{ listening.length }} 条信号，点一条开始精听</div>
          <button
            v-for="(x, i) in listening" :key="x.id"
            class="signal-row" @click="pickPassage(x)"
          >
            <span class="sr-index">{{ String(i + 1).padStart(2, '0') }}</span>
            <span class="sr-wave" aria-hidden="true">
              <i v-for="(b, k) in waveOf(x)" :key="k" :style="{ height: b + '%', '--i': k }" />
            </span>
            <span class="sr-body">
              <span class="sr-title">{{ x.title }}</span>
              <span class="sr-sub">Lv.{{ x.level }} · {{ x.sentences.length }} 句 · {{ x.questions?.length || 0 }} 道验收题</span>
            </span>
            <span class="sr-go" aria-hidden="true">→</span>
          </button>
        </div>

        <!-- 已在听某条信号:回总览 + 换台 pills(此前选中态没有任何「回列表」的路) -->
        <div v-else class="passage-head">
          <button class="btn ghost small ph-back-all" title="回到全部信号列表" @click="pid = null; stopSpeaking()">← 全部信号</button>
          <button
            v-for="x in listening" :key="x.id"
            class="passage-pick" :class="{ active: pid === x.id }"
            @click="pickPassage(x)"
          >{{ x.title }} <span class="pp-lv">Lv.{{ x.level }}</span></button>
        </div>

        <!-- 还没选信号时的引导已在 signal-list 的 hint 行里,不再放空态卡 -->

        <div v-if="p" class="card player-card dots-host">
        <!-- 玻璃播放器:点阵底纹是这条信号的空气,内容层自动抬到点阵之上 -->
        <span class="dots-decor dots-fade" aria-hidden="true" style="--dots-o:.22" />
        <div class="player">
          <div class="player-meta">
            <div class="player-id">
              <div class="player-kicker">SIGNAL LOCKED · 锁定这一条信号</div>
              <div class="player-title">{{ p.title }}</div>
              <div class="player-sub">{{ p.sentences.length }} 句 · {{ p.questions.length }} 题 · Lv.{{ p.level }}</div>
            </div>
            <div class="player-chips">
              <span v-if="playing" class="chip live"><i class="live-dot" aria-hidden="true" />播放中</span>
              <span v-if="loopIdx >= 0" class="chip amber">正在循环第 {{ loopIdx + 1 }} 句，再点一次循环按钮就停</span>
              <span v-if="submitted" class="chip" :class="submitted.accuracy >= 0.7 ? 'green' : 'amber'">
                正确率 {{ Math.round(submitted.accuracy * 100) }}%
              </span>
            </div>
          </div>

          <div class="player-controls">
            <button v-if="!playing" class="btn primary play-btn" @click="playAll">
              <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>播放全文
            </button>
            <button v-else class="btn danger play-btn" @click="stop">
              <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>停止
            </button>
            <div class="rate-selector">
              <span class="rate-label">RATE · 语速</span>
              <!-- 轨道填充色:纯视觉模板表达式,按 rate 算渐变断点,滑杆拖到哪亮到哪 -->
              <input
                v-model.number="rate" type="range" min="0.6" max="1.2" step="0.05" :disabled="playing" class="rate-slider"
                :style="{ background: `linear-gradient(90deg, var(--accent) ${(((rate - 0.6) / 0.6) * 100).toFixed(1)}%, var(--surface-active) ${(((rate - 0.6) / 0.6) * 100).toFixed(1)}%)` }"
                @change="commitRate"
              />
              <span class="rate-val">{{ rate.toFixed(2) }}x</span>
              <span class="rate-hint">{{ rateHint }}</span>
            </div>
            <div class="speed-marks">
              <span v-for="r in [0.6, 0.8, 1.0, 1.2]" :key="r"
                class="speed-mark" :class="{ active: Math.abs(rate - r) < 0.03 }"
                @click="setRate(r)"
              >{{ r }}x</span>
            </div>
          </div>

          <div class="sentence-rail">
            <div
              v-for="(s, i) in p.sentences" :key="i"
              class="sentence-card" :class="{ active: activeIdx === i, done: i < activeIdx, loop: loopIdx === i }"
              :style="{ '--i': i }"
            >
              <button
                class="sentence-play" :title="`听第 ${i + 1} 句（长按可进入循环）`"
                @pointerdown.prevent="playDown(i)" @pointerup="playUp(i)" @pointerleave="playLeave"
              ><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg></button>
              <button
                class="sentence-loop" :class="{ on: loopIdx === i }"
                :title="loopIdx === i ? '停止循环这一句' : '单独循环这一句'"
                @click="toggleLoop(i)"
              ><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/></svg></button>
              <div class="sentence-num">{{ String(i + 1).padStart(2, '0') }}</div>
              <div class="sentence-body">
                <div class="sentence-en">{{ s.en }}</div>
                <div v-if="showZh[i]" class="sentence-zh fade-in">{{ s.zh }}</div>
                <button class="zh-toggle" :class="{ on: showZh[i] }" @click="toggleZh(i)">
                  {{ showZh[i] ? '收起译文' : '看译文' }}
                </button>
              </div>
            </div>
          </div>

          <!-- 底部共享波形条:句边界 mark + 播放头游标;播放/循环中亮起 ON AIR -->
          <div class="wave-strip" :class="{ live: playing || loopIdx >= 0 }">
            <div class="wave-head">
              <span class="wh-kicker">WAVEFORM · 声纹轨道</span>
              <span class="wh-text">点哪一段就播哪一句；想反复听某句，长按喇叭或点循环按钮</span>
              <span class="wh-live" aria-hidden="true"><i />ON AIR</span>
            </div>
            <canvas ref="waveCanvas" class="wave-canvas" title="点击波形区间播放该句" @click="onWaveClick"></canvas>
          </div>
        </div>
      </div>

      <div v-if="p && p.questions?.length" class="card quiz-card">
        <div class="card-head quiz-head">
          <div class="qh-left">
            <div class="quiz-kicker">COMPREHENSION CHECK</div>
            <div class="h-section">听后验收</div>
          </div>
          <!-- 答题进度读数:mono HUD,答完切绿 -->
          <div class="quiz-progress" :class="{ done: Object.keys(answers).length >= p.questions.length }">
            <span class="qp-label">{{ Object.keys(answers).length >= p.questions.length ? '答完' : '已答' }}</span>
            <span class="qp-num">{{ Object.keys(answers).length }}<i>/{{ p.questions.length }}</i></span>
          </div>
        </div>
        <!-- 每题独立浅卡:答完左缘点亮金色刻线(验收完成=点亮),题号升为 mono 键帽 -->
        <div
          v-for="(q, qi) in p.questions" :key="qi"
          class="quiz-row" :class="{ answered: answers[qi] !== undefined }"
        >
          <div class="quiz-title"><span class="qt-num">{{ qi + 1 }}</span>{{ q.q }}</div>
          <div class="quiz-options">
            <button
              v-for="(o, oi) in q.options" :key="oi"
              class="quiz-opt" :class="optCls(qi, oi, q)"
              :disabled="answers[qi] !== undefined" @click="pick(qi, oi)"
            ><span class="qk" aria-hidden="true">{{ String.fromCharCode(65 + oi) }}</span><span class="qo-text">{{ o }}</span></button>
          </div>
          <div v-if="answers[qi] !== undefined" class="quiz-feedback" :class="results[qi] ? 'ok' : 'no'">
            <span v-if="results[qi]" class="fb-line">答对了。{{ q.explain }}</span>
            <template v-else>
              <span class="fb-line">不对。{{ q.explain }}</span>
              <button class="btn small ghost quiz-replay" @click="rate = 0.6; commitRate(); playAll()">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg>
                调回 0.6x 重听全文
              </button>
            </template>
          </div>
        </div>
        <!-- 结算仪式:环长满 + 上次这篇对比,不再是一行字 -->
        <SettleCard
          v-if="submitted"
          :score="submitted.accuracy" :right="submitted.right" :total="submitted.total"
          :prev="submitted.prev" kicker="ECHO RECEIVED · 回声定位"
          :title="resultLine(submitted)"
        />
      </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
/* .ph-header / .passage-pick / .terr-head / .signal-*: 已在全局 styles.css 提供 */

/* BlurText 接管「回声谷」三字入场:全局 terrRise 在本视图置空,避免与逐字 blur 双重动画 */
.terr-title { animation: none; }

.passage-head { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 20px; }

/* 语料加载骨架 */
.sk-pick { height: 30px; border-radius: 8px; }

.player-card { padding: 0; overflow: hidden; }
.player { padding: 24px; }

/* 播放器是本页主角:mono kicker → 标题 → mono 读数副题,和领地页头同一命名式 */
.player-meta { display: flex; justify-content: space-between; align-items: start; flex-wrap: wrap; gap: 12px; margin-bottom: 20px; }
.player-kicker {
  font-family: var(--mono); font-size: var(--fs-2xs); font-weight: 600;
  letter-spacing: 0.22em; color: var(--accent); opacity: 0.9; margin-bottom: 6px;
}
.player-title { font-size: var(--fs-xl); font-weight: 600; letter-spacing: -0.01em; line-height: 1.25; }
.player-sub {
  font-family: var(--mono); font-size: var(--fs-xs); color: var(--text-3);
  margin-top: 4px; letter-spacing: 0.03em;
}
.player-chips { display: flex; gap: 6px; align-items: center; }
/* 播放中 live chip:呼吸小点,与时钟读数同一语言 */
.chip.live { color: var(--accent); border-color: var(--line-accent); background: var(--accent-soft); }
.live-dot {
  width: 6px; height: 6px; border-radius: 50%; background: var(--accent);
  box-shadow: 0 0 6px color-mix(in srgb, var(--accent) 70%, transparent);
  animation: liveBlink 1.6s ease-in-out infinite;
}
@keyframes liveBlink { 0%, 100% { opacity: 0.4 } 50% { opacity: 1 } }

.player-controls {
  display: flex; gap: 14px; align-items: center; flex-wrap: wrap;
  padding: 14px 18px; border-radius: 12px;
  /* 控制台氛围:4% accent 内衬 + 顶部一道受光发丝线,像仪器的上沿 */
  background:
    radial-gradient(320px 130px at 12% 0%, color-mix(in srgb, var(--accent) 4%, transparent), transparent 70%),
    var(--surface-sunken);
  border: 1px solid var(--line);
  box-shadow: inset 0 1px 0 color-mix(in srgb, var(--text) 4%, transparent);
  margin-bottom: 18px;
}
/* 控制台:主按钮放大成主角,语速成为可读的仪表(RATE 读数盒 + 快捷档 pill) */
.play-btn {
  padding: 14px 26px; font-size: var(--fs-md); border-radius: 10px;
  display: inline-flex; align-items: center; gap: 8px;
  box-shadow: var(--shadow-sm);
  transition: transform 0.2s var(--ease), box-shadow 0.2s var(--ease);
}
.play-btn:hover { transform: translateY(-2px); box-shadow: var(--shadow-md); }
.play-btn svg { width: 15px; height: 15px; flex-shrink: 0; }
.rate-selector { display: flex; align-items: center; gap: 10px; flex: 1; min-width: 220px; }
.rate-label {
  font-family: var(--mono); font-size: var(--fs-2xs); font-weight: 600;
  letter-spacing: 0.16em; color: var(--text-3); white-space: nowrap;
}
.rate-slider {
  flex: 1; height: 4px; -webkit-appearance: none; appearance: none;
  border-radius: 999px; outline: none; cursor: pointer;
}
/* 播放中锁速:灰掉即可,不出新形状 */
.rate-slider:disabled { opacity: 0.45; cursor: not-allowed; }
.rate-slider::-webkit-slider-thumb {
  -webkit-appearance: none; appearance: none;
  width: 16px; height: 16px; border-radius: 50%;
  background: var(--accent); box-shadow: 0 0 8px var(--accent-soft);
  cursor: pointer; border: 2px solid var(--surface);
  transition: transform 0.15s var(--ease);
}
.rate-slider::-webkit-slider-thumb:hover { transform: scale(1.15); }
.rate-slider::-moz-range-thumb {
  width: 16px; height: 16px; border-radius: 50%;
  background: var(--accent); cursor: pointer; border: 2px solid var(--surface);
}
.rate-slider::-moz-range-track { height: 4px; border-radius: 999px; background: var(--surface-active); }
/* 语速读数:仪表面板里的一块数码显示(轨道填充色由模板按 rate 内联渐变) */
.rate-val {
  font-family: var(--mono); font-size: var(--fs-sm); color: var(--accent); font-weight: 700;
  font-variant-numeric: tabular-nums;
  padding: 4px 10px; border-radius: 8px; min-width: 64px; text-align: center;
  background: var(--surface); border: 1px solid var(--line-strong);
}
.rate-hint { font-size: var(--fs-2xs); color: var(--text-3); white-space: nowrap; }
.speed-marks { display: flex; gap: 6px; padding-left: 14px; border-left: 1px solid var(--line); }
.speed-mark {
  padding: 5px 10px; border-radius: 999px; font-family: var(--mono); font-size: var(--fs-2xs);
  color: var(--text-3); background: var(--surface); border: 1px solid var(--line);
  cursor: pointer; transition: all 0.18s var(--ease);
}
.speed-mark:hover { color: var(--text); border-color: var(--line-accent); transform: translateY(-1px); }
.speed-mark.active { background: var(--accent-soft); color: var(--accent); border-color: var(--line-accent); }

/* 逐句列表:入场借用信号轨道的 sigRise 级联(backwards 只占延迟期,不锁终态);
   当前句/循环句改用左缘刻线说话,和信号行同一语言 */
.sentence-rail { display: flex; flex-direction: column; gap: 8px; }
.sentence-rail > * { animation: sigRise 0.5s var(--ease) backwards; animation-delay: calc(var(--i, 0) * 45ms); }
.sentence-card {
  position: relative;
  display: flex; align-items: center; gap: 10px; padding: 12px 16px;
  border-radius: 12px; background: var(--surface-sunken);
  border: 1px solid var(--line); transition: all 0.25s var(--ease);
}
/* 普通态 hover:亮边 + 轻升(active/loop 已有自己的高亮,不叠加) */
.sentence-card:not(.active):not(.loop):not(.done):hover {
  border-color: var(--line-accent); transform: translateY(-1px);
}
/* 已播过的句:不再整卡降透明度,改左缘 success 刻线 + 极淡绿底——完成语义交给色彩系统 */
.sentence-card.done { background: color-mix(in srgb, var(--success) 4%, var(--surface-sunken)); }
.sentence-card.done::before { background: var(--success); transform: scaleY(1); }
.sentence-card::before {
  content: ''; position: absolute; left: 0; top: 10px; bottom: 10px; width: 2px;
  border-radius: 0 2px 2px 0; background: var(--accent);
  transform: scaleY(0); transform-origin: center;
  transition: transform 0.3s var(--ease), background 0.3s var(--ease);
}
.sentence-card.active {
  background: var(--accent-soft); border-color: var(--accent);
  box-shadow: 0 0 0 1px var(--accent-soft), 0 0 24px var(--accent-soft);
  transform: translateX(2px);
}
.sentence-card.active::before { transform: scaleY(1); }
.sentence-card.loop {
  border-color: var(--warn);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--warn) 30%, transparent), 0 0 18px color-mix(in srgb, var(--warn) 16%, transparent);
}
.sentence-card.loop::before { background: var(--warn); transform: scaleY(1); }
.sentence-play, .sentence-loop {
  border-radius: 10px;
  background: var(--surface); border: 1px solid var(--line);
  color: var(--text); cursor: pointer; font-size: var(--fs-base);
  display: flex; align-items: center; justify-content: center;
  transition: all 0.2s var(--ease);
}
.sentence-play { width: 36px; height: 36px; flex-shrink: 0; user-select: none; touch-action: none; }
.sentence-play:hover { background: var(--accent-soft); border-color: var(--line-accent); color: var(--accent); transform: translateY(-1px); }
.sentence-play svg { width: 15px; height: 15px; }
.sentence-loop { width: 30px; height: 36px; flex-shrink: 0; color: var(--text-3); font-size: var(--fs-sm); }
.sentence-loop svg { width: 13px; height: 13px; }
.sentence-loop:hover { color: var(--text); border-color: var(--line-accent); }
.sentence-loop.on {
  background: color-mix(in srgb, var(--warn) 15%, transparent); border-color: var(--warn); color: var(--warn);
  animation: loopBlink 1.2s ease-in-out infinite;
}
@keyframes loopBlink {
  0%, 100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--warn) 35%, transparent); }
  50% { box-shadow: 0 0 8px 2px color-mix(in srgb, var(--warn) 35%, transparent); }
}
/* 实底 accent 上的白字统一走 --on-accent(暖夜粉彩底自动换深字) */
.sentence-card.active .sentence-play { background: var(--accent); border-color: var(--accent); color: var(--on-accent); animation: playRing 1.6s ease-in-out infinite; }
.sentence-card.active .sentence-play:hover { background: var(--accent); color: var(--on-accent); transform: none; }
@keyframes playRing {
  0%, 100% { box-shadow: 0 0 0 0 var(--accent-soft); }
  50% { box-shadow: 0 0 0 6px transparent; }
}
.sentence-num {
  font-family: var(--mono); font-size: var(--fs-sm); font-weight: 700;
  color: var(--accent); min-width: 24px; font-variant-numeric: tabular-nums;
}
.sentence-body { flex: 1; min-width: 0; }
.sentence-en { font-size: var(--fs-md); line-height: 1.75; }
.sentence-zh { font-size: var(--fs-sm); color: var(--text-3); margin-top: 4px; line-height: 1.7; }
.zh-toggle {
  margin-top: 4px; background: none; border: 0; padding: 0; cursor: pointer;
  font-size: var(--fs-2xs); color: var(--text-4); letter-spacing: 0.04em;
  text-decoration: underline dotted; text-underline-offset: 3px;
  transition: color 0.2s var(--ease);
}
.zh-toggle:hover, .zh-toggle.on { color: var(--accent); }
.quiz-replay { gap: 5px; flex-shrink: 0; }
.quiz-replay svg { width: 12px; height: 12px; }

/* 底部共享波形条:播放/循环中 = ON AIR 亮起,画布边缘随之通电 */
.wave-strip { margin-top: 20px; }
.wave-head { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; margin-bottom: 8px; }
.wh-kicker {
  font-family: var(--mono); font-size: var(--fs-2xs); font-weight: 600;
  letter-spacing: 0.2em; color: var(--accent);
}
.wh-text { font-size: var(--fs-xs); color: var(--text-3); }
.wh-live {
  margin-left: auto; display: inline-flex; align-items: center; gap: 6px;
  font-family: var(--mono); font-size: var(--fs-2xs); font-weight: 600; letter-spacing: 0.16em;
  color: var(--success); opacity: 0; transition: opacity 0.35s var(--ease);
}
.wh-live i {
  width: 6px; height: 6px; border-radius: 50%; background: var(--success);
  box-shadow: 0 0 6px color-mix(in srgb, var(--success) 70%, transparent);
  animation: liveBlink 1.4s ease-in-out infinite;
}
.wave-strip.live .wh-live { opacity: 1; }
.wave-canvas {
  width: 100%; height: 64px; display: block;
  border-radius: 12px; background: var(--surface-sunken);
  border: 1px solid var(--line); cursor: pointer;
  transition: border-color 0.35s var(--ease), box-shadow 0.35s var(--ease);
}
.wave-strip.live .wave-canvas {
  border-color: var(--line-accent);
  box-shadow: 0 0 0 1px var(--accent-soft), 0 0 28px color-mix(in srgb, var(--accent) 9%, transparent);
}

/* 听后验收:mono 进度读数 + 键帽(题号/A-B-C-D 选项),答对答错在键帽上反白 */
/* 每题独立浅卡(surface + hairline + r-lg),不再是 1px 裸堆叠;
   hover 亮边轻升,答完左缘点亮金刻线——验收完成=点亮 */
.quiz-row {
  position: relative;
  padding: 16px 18px; margin-top: 12px;
  background: var(--surface); border: 1px solid var(--line); border-radius: var(--r-lg);
  transition: border-color 0.25s var(--ease), transform 0.25s var(--ease), box-shadow 0.25s var(--ease);
}
.quiz-row:hover { border-color: var(--line-accent); transform: translateY(-2px); box-shadow: var(--shadow-sm); }
.quiz-row.answered::before {
  content: ''; position: absolute; left: 0; top: 12px; bottom: 12px; width: 2px;
  border-radius: 0 2px 2px 0;
  background: linear-gradient(180deg, var(--gold), color-mix(in srgb, var(--gold) 25%, transparent));
}
.quiz-head { align-items: center; }
.quiz-kicker {
  font-family: var(--mono); font-size: var(--fs-2xs); font-weight: 600;
  letter-spacing: 0.22em; color: var(--text-3); margin-bottom: 6px;
}
.quiz-progress {
  display: inline-flex; align-items: baseline; gap: 8px; padding: 6px 12px;
  border-radius: 8px; background: var(--surface-sunken); border: 1px solid var(--line);
  color: var(--text-3);
}
.quiz-progress .qp-label { font-family: var(--mono); font-size: var(--fs-2xs); letter-spacing: 0.14em; }
.quiz-progress .qp-num {
  font-family: var(--mono); font-size: var(--fs-md); font-weight: 700;
  color: var(--text); font-variant-numeric: tabular-nums;
}
.quiz-progress .qp-num i { font-style: normal; font-size: var(--fs-2xs); color: var(--text-4); }
.quiz-progress.done {
  color: var(--success); border-color: color-mix(in srgb, var(--success) 30%, transparent);
  background: color-mix(in srgb, var(--success) 8%, transparent);
}
.quiz-progress.done .qp-num { color: var(--success); }
.quiz-title { font-size: var(--fs-base); margin-bottom: 12px; font-weight: 500; }
/* 题号键帽:放大号 mono,与 A/B/C/D 选项键帽同一语言 */
.qt-num {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 26px; height: 26px; padding: 0 6px; margin-right: 10px;
  border-radius: 8px; background: var(--surface-sunken); border: 1px solid var(--line);
  font-family: var(--mono); font-size: var(--fs-sm); font-weight: 700;
  color: var(--accent); font-variant-numeric: tabular-nums;
}
.quiz-options { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.quiz-opt {
  display: flex; align-items: center; gap: 12px; padding: 12px 16px;
  border-radius: 10px; cursor: pointer; text-align: left;
  background: var(--surface-sunken); border: 1px solid var(--line);
  color: var(--text); font-family: inherit; font-size: var(--fs-sm);
  transition: all 0.2s var(--ease);
}
.quiz-opt:hover:not(:disabled) { border-color: var(--line-accent); background: var(--surface-hover); transform: translateY(-2px); }
.qk {
  flex-shrink: 0; width: 26px; height: 26px; border-radius: 8px;
  display: inline-flex; align-items: center; justify-content: center;
  font-family: var(--mono); font-size: var(--fs-xs); font-weight: 700; color: var(--accent);
  background: var(--surface); border: 1px solid var(--line);
  transition: all 0.2s var(--ease);
}
.qo-text { flex: 1; min-width: 0; line-height: 1.55; }
.quiz-opt.correct {
  background: color-mix(in srgb, var(--success) 12%, transparent);
  border-color: var(--success); color: var(--success);
}
.quiz-opt.correct .qk { background: var(--success); border-color: var(--success); color: var(--on-success); }
.quiz-opt.wrong {
  background: color-mix(in srgb, var(--danger) 10%, transparent);
  border-color: var(--danger); color: var(--danger);
}
.quiz-opt.wrong .qk { background: var(--danger); border-color: var(--danger); color: var(--on-danger); }
/* 答题反馈:左缘色线 + 沉底,对/错一眼分档,不再是一行裸字 */
.quiz-feedback {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  margin-top: 10px; padding: 10px 14px;
  border-radius: 0 10px 10px 0; border-left: 2px solid var(--line-strong);
  background: var(--surface-sunken); font-size: var(--fs-sm); line-height: 1.65;
}
.quiz-feedback.ok { border-left-color: var(--success); color: var(--success); }
.quiz-feedback.no { border-left-color: var(--danger); color: var(--danger); }
.fb-line { flex: 1; min-width: 220px; }
.quiz-card { margin-top: 16px; }

@media (max-width: 768px) {
  .sentence-card { flex-wrap: wrap; }
  .sentence-zh { min-width: 0; width: 100%; }
  .quiz-options { grid-template-columns: 1fr; }
  .rate-hint { display: none; }
  .wh-live { margin-left: 0; }
}</style>
