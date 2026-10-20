<script setup>
import { ref, computed, watch, onMounted, onUnmounted, onActivated, onDeactivated, nextTick, h } from 'vue'
import AppGlyph from '../components/AppGlyph.vue'
import { useUniverse } from '../stores/universe'
import MouthSVG from '../components/MouthSVG.vue'
import { speak, stopSpeaking, listenOnce, recognizerSupported, scoreSpeech } from '../speech'
import { MANNER_LABEL, resolvePhoneme, VOWELS, DIPHTHONGS, PLACES, CONSONANTS } from '../phoneticsData'
import { api } from '../api'
import { message } from '../ui'

const store = useUniverse()
const mode = ref('anatomy')
// 词库 IPA 查表:跟读打分音素级比对优先用词库音标
const ipaMap = computed(() => new Map(store.words.map((x) => [x.word, x.ipa])))
const ipaOf = (w) => ipaMap.value.get(w)

// 内联 SVG 图标(操作类按钮统一用这里,不引库)
const svgIcon = (paths) => () => h('svg', { viewBox: '0 0 24 24', class: 'ic', 'aria-hidden': 'true' }, paths.map((p) => h('path', p)))
const IcSpeaker = svgIcon([
  { d: 'M4 9v6h4l5 4V5L8 9H4z', fill: 'currentColor' },
  { d: 'M16.5 8.6a5 5 0 0 1 0 6.8M19.2 6a9 9 0 0 1 0 12', fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round' },
])
const IcMic = svgIcon([
  { d: 'M12 3a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3z', fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linejoin': 'round' },
  { d: 'M6.5 11a5.5 5.5 0 0 0 11 0M12 16.5V21M9 21h6', fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round' },
])
const IcReplay = svgIcon([{ d: 'M13 4.5V1L7 6l6 5V7a6 6 0 1 1-6 6H5a8 8 0 1 0 8-8.5z', fill: 'currentColor' }])
const IcDown = svgIcon([{ d: 'M6 9.5l6 6 6-6', fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }])

const MODES = [
  ['anatomy', '音标解剖'],
  ['pairs', '听辨测试'],
  ['rules', '拼读规则'],
  ['mastery', '掌握度'],
]
// 四模式的仪器小标:声波仪(解剖)/回波仪(听辨)/齿轮环(拼读)/观星线(掌握度)
const PH_GLYPHS = { anatomy: 'phonetics', pairs: 'listening', rules: 'grammar', mastery: 'dashboard' }

// === 音标解剖 + 跟读 ===
const selId = ref(null)
const isVowelSym = (s) => {
  const bare = s.replace(/\//g, '')
  return bare in VOWELS || bare in DIPHTHONGS
}
const groups = computed(() => [
  { label: '单元音', count: 12, list: store.phonemes.filter((p) => p.type === 'vowel' && isVowelSym(p.symbol)) },
  { label: '双元音', count: 8, list: store.phonemes.filter((p) => p.type === 'vowel' && !isVowelSym(p.symbol)) },
  { label: '清辅音', count: 10, list: store.phonemes.filter((p) => p.type === 'consonant' && resolvePhoneme(p.symbol) && !resolvePhoneme(p.symbol).voiced) },
  { label: '浊辅音', count: 18, list: store.phonemes.filter((p) => p.type === 'consonant' && resolvePhoneme(p.symbol) && resolvePhoneme(p.symbol).voiced) },
])
const sel = computed(() => store.phonemes.find((p) => p.id === selId.value))
const rp = computed(() => (sel.value ? resolvePhoneme(sel.value.symbol) : null))

// 三要素解析:舌位/唇形/气流
const elementOf = (p) => {
  if (!p) return null
  if (p.kind === 'vowel' || p.kind === 'diph') {
    const place = p.h >= 0.7 ? '舌位高(近硬腭)' : p.h >= 0.45 ? '舌位中' : '舌位低(张嘴)'
    const lip = p.r ? '圆唇' : (p.h > 0.8 ? '展唇(微笑)' : '自然唇')
    return { tongue: place, lip, air: '声带振动(浊音)', voiced: true }
  }
  const place = PLACES[p.place]?.label || '口腔'
  const isClosed = ['stop', 'nasal', 'affr'].includes(p.manner)
  const isFric = p.manner === 'fric'
  return {
    tongue: `${place}${isClosed ? '·完全阻塞' : isFric ? '·气流摩擦' : ''}`,
    lip: p.rounded ? '圆唇' : '自然唇',
    air: p.nasal ? '气流走鼻腔(鼻音)' : (p.voiced ? '声带振动' : '声带不振动'),
    voiced: !!p.voiced,
  }
}
const elements = computed(() => elementOf(rp.value))

function pick(p) {
  selId.value = p.id
  const w = p.example_words?.[0]
  if (w) speak(w.en, { rate: 0.85 })
}
function pickSimilar(s) {
  const t = store.phonemes.find((p) => p.symbol.replace(/\//g, '') === s)
  if (t) selId.value = t.id
}

// === 悬停卡片:发音描述 + 最近得分趋势 + 词例 + 进入解剖 ===
// 跟读得分按音标记在 localStorage(离线也能看趋势)
// 历史存储键:保留旧名以兼容已存分数,不随品牌改名(改了会丢用户练习记录)
const DRILL_SCORE_KEY = 'wordverse_drill_scores'
function loadDrillScores() {
  try { return JSON.parse(localStorage.getItem(DRILL_SCORE_KEY) || '{}') } catch { return {} }
}
const drillBook = ref(loadDrillScores())
function recordDrillScore(sym, score) {
  if (!sym) return
  const key = sym.replace(/\//g, '')
  const all = { ...drillBook.value, [key]: [...(drillBook.value[key] || []), score].slice(-20) }
  drillBook.value = all
  try { localStorage.setItem(DRILL_SCORE_KEY, JSON.stringify(all)) } catch { /* 隐私模式 */ }
}

const hoverPh = ref(null)
const hoverPos = ref({ x: 0, y: 0 })
let hoverHideTimer = null

function showPhTooltip(p, e) {
  clearTimeout(hoverHideTimer)
  hoverPh.value = p
  if (e) hoverPos.value = { x: e.clientX, y: e.clientY }
}
function movePhTooltip(e) {
  hoverPos.value = { x: e.clientX, y: e.clientY }
}
// 延迟隐藏,给鼠标留出移进卡片点"进入解剖"的时间
function hidePhTooltip() {
  clearTimeout(hoverHideTimer)
  hoverHideTimer = setTimeout(() => { hoverPh.value = null }, 180)
}
function keepPhTooltip() { clearTimeout(hoverHideTimer) }
// 点按也出卡:触屏没有 hover,点一下音标 = 选中 + 发音描述/最近得分/词例(桌面点击与 hover 同卡,无感)
function pickWithTooltip(p, e) {
  pick(p)
  showPhTooltip(p, e)
}
function enterAnatomy(p) {
  clearTimeout(hoverHideTimer)
  hoverPh.value = null
  mode.value = 'anatomy'
  pick(p)
}

const hoverScores = computed(() =>
  hoverPh.value ? (drillBook.value[hoverPh.value.symbol.replace(/\//g, '')] || []).slice(-5) : []
)
// 双元音取滑动起点的舌位来展示三要素
const hoverElem = computed(() => {
  if (!hoverPh.value) return null
  const p = resolvePhoneme(hoverPh.value.symbol)
  if (p?.kind === 'diph') return elementOf({ kind: 'vowel', ...p.from })
  return elementOf(p)
})
const sparkAvg = computed(() =>
  hoverScores.value.length
    ? Math.round((hoverScores.value.reduce((a, b) => a + b, 0) / hoverScores.value.length) * 100)
    : 0
)
// 迷你 sparkline 坐标(纯内联 SVG,得分 0-1 映射到 0-100% 高度)
const sparkPts = computed(() => {
  const ss = hoverScores.value
  if (!ss.length) return []
  const W = 132, H = 34, pad = 5
  const step = ss.length > 1 ? (W - pad * 2) / (ss.length - 1) : 0
  return ss.map((s, i) => ({
    x: ss.length === 1 ? W / 2 : pad + i * step,
    y: H - pad - s * (H - pad * 2),
  }))
})
const sparkPoints = computed(() => sparkPts.value.map((p) => `${p.x},${p.y}`).join(' '))
const tooltipBelow = computed(() => hoverPos.value.y < 340)
const tooltipStyle = computed(() => {
  const w = 300
  const x = Math.min(Math.max(hoverPos.value.x, w / 2 + 10), window.innerWidth - w / 2 - 10)
  return { left: `${x}px`, top: `${hoverPos.value.y}px` }
})

// === 跟读(真实麦克风波形 + 降级伪动画) ===
const drill = ref(null)
const drilling = ref(false)
const drillWave = ref([]) // 降级用伪动画数据
const waveCanvas = ref(null)
const micOk = ref(false)
const micDenied = ref(false)
let waveTimer = null
let audioCtx = null
let analyser = null
let micStream = null
let waveRaf = 0
let drillRec = null // 进行中的 SpeechRecognition 实例(离开视图时 abort,释放麦克风)
const supported = recognizerSupported()
let alive = true

// 跟读反馈语:按分数段说话,不用空泛的夸
function drillComment(s) {
  if (s >= 0.9) return '口型和节奏都稳了'
  if (s >= 0.8) return '口型基本到位,保持这个感觉'
  if (s >= 0.6) return '接近了,对照口型再来一遍'
  return '先慢速跟一遍,留意高亮的词'
}

function startFakeWave() {
  clearInterval(waveTimer)
  waveTimer = setInterval(() => {
    if (!drilling.value) return
    drillWave.value = Array.from({ length: 24 }, (_, i) => {
      const t = (performance.now() / 1000) + i * 0.18
      return 0.3 + 0.7 * Math.abs(Math.sin(t * 4 + i * 0.6))
    })
  }, 80)
}

// Web Audio AnalyserNode 实时波形(Canvas 自绘,不引库)
async function setupMic() {
  if (!navigator.mediaDevices?.getUserMedia) { micDenied.value = true; return }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    if (!drilling.value) { stream.getTracks().forEach((t) => t.stop()); return } // 识别已结束,别留麦克风口
    micStream = stream
    audioCtx = new (window.AudioContext || window.webkitAudioContext)()
    const src = audioCtx.createMediaStreamSource(micStream)
    analyser = audioCtx.createAnalyser()
    analyser.fftSize = 2048
    src.connect(analyser)
    clearInterval(waveTimer) // 伪动画退场
    micOk.value = true
    await nextTick()
    drawRealWave()
  } catch {
    micDenied.value = true // 权限被拒:降级继续跑伪动画
  }
}

function drawRealWave() {
  // ref 在 v-for 内会是数组,做一次归一化
  const raw = waveCanvas.value
  const cvs = Array.isArray(raw) ? raw[0] : raw
  if (!cvs || !analyser) return
  const ctx2d = cvs.getContext('2d')
  const data = new Uint8Array(analyser.fftSize)
  const BARS = 48
  const draw = () => {
    if (!drilling.value || !analyser) return
    analyser.getByteTimeDomainData(data)
    ctx2d.clearRect(0, 0, cvs.width, cvs.height)
    ctx2d.fillStyle = getComputedStyle(cvs).color || '#22d3ee'
    const bw = cvs.width / BARS
    const bucket = Math.floor(data.length / BARS)
    for (let i = 0; i < BARS; i++) {
      let peak = 0
      for (let j = 0; j < bucket; j++) {
        const v = Math.abs(data[i * bucket + j] - 128) / 128
        if (v > peak) peak = v
      }
      const h = Math.max(2, peak * (cvs.height - 4))
      ctx2d.fillRect(i * bw + 1, (cvs.height - h) / 2, bw - 2, h)
    }
    waveRaf = requestAnimationFrame(draw)
  }
  draw()
}

function stopMic() {
  cancelAnimationFrame(waveRaf)
  waveRaf = 0
  try { micStream?.getTracks().forEach((t) => t.stop()) } catch { /* ignore */ }
  micStream = null
  analyser = null
  try { audioCtx?.close() } catch { /* ignore */ }
  audioCtx = null
}

function startDrill(w) {
  drill.value = null
  drilling.value = true
  drillWave.value = []
  micOk.value = false
  micDenied.value = false
  startFakeWave() // 麦克风数据未就绪前先跑伪动画,成功后切真实波形
  setupMic()
  drillRec = listenOnce({
    onResult: (transcript) => {
      if (!alive) return
      const s = scoreSpeech(w.en, transcript, { ipaOf })
      drill.value = { ...s, transcript }
      recordDrillScore(sel.value?.symbol, s.score)
      apiSubmitPhonetics('drill', sel.value?.symbol ?? '', s.score >= 0.8)
    },
    onEnd: () => { if (alive) { drilling.value = false; clearInterval(waveTimer); stopMic(); drillWave.value = [] } },
    onError: (e) => {
      if (!alive) return
      drilling.value = false
      clearInterval(waveTimer); stopMic(); drillWave.value = []
      message.error(e === 'not-allowed' ? '没拿到麦克风权限,这轮跟读取消了' : `识别出错: ${e}`)
    },
  })
}

// 跟读会话整体释放:abort 识别器 + 停波形/麦克风 + 清状态(unmount 与 deactivate 共用)
function releaseDrill() {
  try { drillRec?.abort?.() } catch { /* 已结束 */ }
  drillRec = null
  drilling.value = false
  clearInterval(waveTimer)
  stopMic()
  drillWave.value = []
  stopSpeaking()
}

onUnmounted(() => {
  alive = false
  releaseDrill()
  stopPairTimer()
  clearTimeout(hoverHideTimer)
})

// KeepAlive 缓存视图:onUnmounted 永不触发,切走时手动做同等清理——
// 否则听辨倒计时在后台继续走秒、超时被记为错题;跟读中切走麦克风一直被占用
onDeactivated(() => {
  alive = false
  releaseDrill()
  stopPairTimer()
  clearTimeout(hoverHideTimer)
})
// 回到本视图:恢复回调放行;听辨进行中的题重启倒计时(从满格重新数,不给"回来已超时")
onActivated(() => {
  alive = true
  if (pairsMode.value === 'playing' && currentPair.value && pairPicked.value === null) startPairTimer()
})

// 发音技巧
const phonTips = computed(() => store.tips.filter((t) => t.category === '发音技巧'))
const tipOfDay = computed(() => phonTips.value.length ? phonTips.value[(selId.value ?? 0) % phonTips.value.length] : null)

// === 48 音标 IPA 专业排列(舌位梯形 + 辅音矩阵,可切回分类表) ===
const chartView = ref('chart') // chart | table
const MANNER_ROWS = [['stop', '塞音'], ['fric', '擦音'], ['affr', '塞擦音'], ['nasal', '鼻音'], ['approx', '近音'], ['lat', '边音']]
const PLACE_COLS = [['bi', '双唇'], ['labio', '唇齿'], ['dent', '齿'], ['alv', '齿龈'], ['palal', '腭'], ['vel', '软腭'], ['glot', '喉']]
const PLACE_COL = { bi: 'bi', labio: 'labio', dent: 'dent', alv: 'alv', palal: 'palal', pal: 'palal', vel: 'vel', glot: 'glot' }

const vowelList = computed(() => store.phonemes.filter((p) => p.type === 'vowel' && isVowelSym(p.symbol)))
const diphList = computed(() => store.phonemes.filter((p) => p.type === 'vowel' && !isVowelSym(p.symbol)))
const consList = computed(() => store.phonemes.filter((p) => p.type === 'consonant'))
const consGrid = computed(() => MANNER_ROWS.map(([manner, mlabel]) => ({
  manner, mlabel,
  cols: PLACE_COLS.map(([col, clabel]) => ({
    col, clabel,
    list: consList.value.filter((p) => {
      const c = CONSONANTS[p.symbol.replace(/\//g, '')]
      return c && c.manner === manner && PLACE_COL[c.place] === col
    }),
  })),
})))

// 舌位梯形坐标:x 左(前)→右(后),y 上(高·闭)→下(低·开)
function vowelPos(sym) {
  const v = VOWELS[sym.replace(/\//g, '')]
  if (!v) return null
  return { x: 46 + (1 - v.f) * 268, y: 26 + (1 - v.h) * 176 }
}
const vowelDots = computed(() =>
  vowelList.value.map((p) => ({ p, pos: vowelPos(p.symbol) })).filter((d) => d.pos)
)

// === 听辨测试(难度分级 + 每题 5 秒倒计时,超时算错) ===
const PAIR_LEVELS = [
  { key: 1, dot: 'lv1', label: '辅音对比 · 易' },
  { key: 2, dot: 'lv2', label: '元音相似 · 中' },
  { key: 3, dot: 'lv3', label: '跨语种易混 · 难' },
]
const pairLevel = ref(1)
const levelRestored = ref(false) // 是否从偏好里恢复了上次的难度
const pairsMode = ref('idle')
const currentPair = ref(null)
const heard = ref(null)
const pairPicked = ref(null)
const pairScore = ref({ right: 0, total: 0, streak: 0, best: 0 })
const pairHistory = ref([])
const pairStreak = ref(0)
const pairBestStreak = ref(0)

const pairsOfLevel = computed(() => {
  const list = store.pairs.filter((p) => p.level === pairLevel.value)
  return list.length ? list : store.pairs
})
const levelLabel = computed(() => PAIR_LEVELS.find((l) => l.key === pairLevel.value)?.label || '')

function setPairLevel(k) {
  if (pairLevel.value === k) return
  pairLevel.value = k
  levelRestored.value = false
  store.setPref('listenLevel', k) // 记住难度,下次进来直接恢复
  if (pairsMode.value === 'playing') nextPair() // 换难度:立即换题(计分保留)
}

const PAIR_TIME = 5000
const pairLeft = ref(PAIR_TIME)
let pairTimerInt = null
const RING_C = 2 * Math.PI * 15
const pairLeftRatio = computed(() => pairLeft.value / PAIR_TIME)

function startPairTimer() {
  clearInterval(pairTimerInt)
  pairLeft.value = PAIR_TIME
  pairTimerInt = setInterval(() => {
    pairLeft.value = Math.max(0, pairLeft.value - 100)
    if (pairLeft.value <= 0) { clearInterval(pairTimerInt); timeoutPair() }
  }, 100)
}
function stopPairTimer() { clearInterval(pairTimerInt); pairTimerInt = null }

function startPairs() {
  pairScore.value = { right: 0, total: 0, streak: 0, best: 0 }
  pairStreak.value = 0
  pairHistory.value = []
  pairsMode.value = 'playing'
  nextPair()
}

function nextPair() {
  const list = pairsOfLevel.value
  if (!list.length) return
  const unseen = list.filter((p) => !pairHistory.value.includes(p.id))
  const pool = unseen.length ? unseen : list
  currentPair.value = pool[Math.floor(Math.random() * pool.length)]
  pairPicked.value = null
  heard.value = Math.random() < 0.5 ? 'a' : 'b'
  stopPairTimer()
  pairLeft.value = PAIR_TIME
  setTimeout(() => {
    if (pairsMode.value === 'playing' && currentPair.value) {
      speak(currentPair.value[heard.value].word, { rate: 0.85 })
      startPairTimer() // 从读音播出开始计时
    }
  }, 400)
}

function pickPair(side) {
  if (pairPicked.value !== null) return
  stopPairTimer()
  pairPicked.value = side
  const correct = side === heard.value
  pairScore.value.total++
  if (correct) {
    pairScore.value.right++
    pairStreak.value++
    pairBestStreak.value = Math.max(pairBestStreak.value, pairStreak.value)
  } else {
    pairStreak.value = 0
  }
  pairScore.value.streak = pairStreak.value
  pairHistory.value.push(currentPair.value.id)
  apiSubmitPhonetics('pair', currentPair.value.id, correct)
}

// 答对反馈语:带连击数据说话,不空夸
function pairOkText() {
  const s = pairStreak.value
  if (s >= 5) return `连对 ${s} 题,这组你分得很清`
  if (s >= 2) return `答对,已连对 ${s} 题`
  return '答对了'
}

// 超时未答:本题算错并揭晓答案
function timeoutPair() {
  if (pairsMode.value !== 'playing' || pairPicked.value !== null || !currentPair.value) return
  pairPicked.value = 'timeout'
  pairScore.value.total++
  pairStreak.value = 0
  pairScore.value.streak = 0
  pairHistory.value.push(currentPair.value.id)
  apiSubmitPhonetics('pair', currentPair.value.id, false)
}

function finishPairs() {
  pairsMode.value = 'done'
  stopPairTimer()
  store.refreshPhonetics()
}

const pairAccuracy = computed(() => pairScore.value.total ? Math.round((pairScore.value.right / pairScore.value.total) * 100) : 0)
// 本轮总结:按答对数和正确率给不同的收尾话
function pairSummaryText() {
  const { right, total } = pairScore.value
  if (!total) return '这轮还没有答完的题,随时再来'
  if (right === total) return `${total} 组全对,这对音可以放心收下了`
  if (right >= total / 2) return `答对 ${right} 组,正确率 ${pairAccuracy.value}%。错过的音对回「音标解剖」看口型对比`
  return `答对 ${right} 组,正确率 ${pairAccuracy.value}%。可以先降一档难度,把基础的对立分清再往上加`
}

function replayPair() {
  if (currentPair.value) speak(currentPair.value[heard.value].word, { rate: 0.85 })
}

// === 拼读规则(每条 3 关:英→选读音 / 听音→选单词 / 找规律) ===
const ruleAnswers = ref({}) // `${r.id}-${qi}` -> 选中的选项
const ruleResults = ref({}) // `${r.id}-${qi}` -> 是否答对
const ruleLvl = ref('all') // 全部 / L1 / L2 / L3

const rulesFiltered = computed(() => {
  let list = store.rules
  if (ruleLvl.value !== 'all') list = list.filter((r) => r.level === Number(ruleLvl.value[1]))
  return list
})

function ruleKey(r, qi) { return `${r.id}-${qi}` }
// 灯串点击 → 该规则卡:先解除难度过滤(卡片可能被滤掉),下一帧再滚过去
function jumpToRule(id) {
  ruleLvl.value = 'all'
  nextTick(() => {
    document.getElementById(`rule-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  })
}
function ruleDone(r) {
  return (r.quizzes || []).every((_, qi) => ruleAnswers.value[ruleKey(r, qi)] !== undefined)
}
function ruleAllRight(r) {
  return (r.quizzes || []).every((_, qi) => ruleResults.value[ruleKey(r, qi)])
}

function pickRule(r, qi, oi) {
  const key = ruleKey(r, qi)
  if (ruleAnswers.value[key] !== undefined) return
  const correct = oi === r.quizzes[qi].answer
  ruleAnswers.value = { ...ruleAnswers.value, [key]: oi }
  ruleResults.value = { ...ruleResults.value, [key]: correct }
  apiSubmitPhonetics('rule', r.id, correct)
}

function ruleOptCls(r, qi, oi) {
  const key = ruleKey(r, qi)
  if (ruleAnswers.value[key] === undefined) return ''
  if (oi === r.quizzes[qi].answer) return 'correct'
  if (oi === ruleAnswers.value[key]) return 'wrong'
  return ''
}

// 每条规则的发音部位/规律示意(手绘 SVG,不引库)
const PLACE_X = { bi: 20, labio: 64, dent: 108, alv: 152, palal: 196, vel: 240, glot: 284 }
const vx = (f) => 14 + (1 - f) * 244
const vy = (h) => 14 + (1 - h) * 50
function seqX(n, i) { return 150 + (i - (n - 1) / 2) * 62 }
const RULE_DIAGRAM = {
  1: { type: 'vowel', pts: [{ f: 0.8, h: 0.55, l: 'e' }, { f: 1, h: 1, l: 'eɪ' }], link: true, cap: '词尾 e:短元音滑向"字母名"(高化)' },
  2: { type: 'place', pts: [{ p: 'palal', l: 'ʃ' }], cap: '-tion:舌面抬向齿龈后部,摩擦成 /ʃən/' },
  3: { type: 'place', pts: [{ p: 'palal', l: 'tʃ' }], cap: '-ture:齿龈后部先阻塞后摩擦 /tʃər/' },
  4: { type: 'place', pts: [{ p: 'labio', l: 'f' }], cap: 'ph:上齿咬下唇,唇齿摩擦 /f/' },
  5: { type: 'place', pts: [{ p: 'palal', l: 'tʃ' }, { p: 'vel', l: 'k' }], cap: 'ch:默认齿龈后 /tʃ/,希腊源抬到软腭 /k/' },
  6: { type: 'seq', items: ['s', 't', 'r'], cap: '连缀辅音一气呵成,中间绝不塞元音' },
  7: { type: 'mute', word: 'knife', mute: [0], cap: 'k 是哑音:拼写保留,发音消失' },
  8: { type: 'stress', tokens: ['pho', 'TO', 'gra', 'phy'], hi: 1, cap: '-y 学科后缀:重音后移到 TO' },
  9: { type: 'seq', items: ['t', 'd', 'ɪd'], cap: '-ed 三读:清后 /t/ · 浊后 /d/ · t/d 后 /ɪd/' },
  10: { type: 'seq', items: ['s', 'z', 'ɪz'], cap: '-s 三读:清后 /s/ · 浊后 /z/ · 咝音后 /ɪz/' },
  11: { type: 'vowel', pts: [{ f: 0.15, h: 0.95, l: 'uː' }, { f: 0.2, h: 0.75, l: 'ʊ' }], link: true, cap: 'oo 两读:紧长 /uː/ 与松短 /ʊ/' },
  12: { type: 'vowel', pts: [{ f: 0.5, h: 0.45, l: 'ɜːr' }], cap: '美音卷舌:舌位居中 + 舌尖上卷' },
  13: { type: 'place', pts: [{ p: 'vel', l: 'k' }, { p: 'alv', l: 's' }], cap: 'c 双面:软腭硬音 /k/ · 齿龈软音 /s/' },
  14: { type: 'place', pts: [{ p: 'vel', l: 'g' }, { p: 'palal', l: 'dʒ' }], cap: 'g 双面:软腭硬音 /g/ · 齿龈后软音 /dʒ/' },
}
function rd(r) { return RULE_DIAGRAM[r.id] || null }

// === 掌握度 ===
// 个人练习流水异步拉取:未就绪时掌握度页显示 skeleton
const statesLoading = ref(true)
// KeepAlive:回发音舱刷新掌握度数据(偏好恢复只需一次,留在挂载)
onActivated(async () => {
  if (store.user) {
    try { await store.refreshPhonetics() } catch { /* 离线 */ }
  }
  statesLoading.value = false
})

const masteryData = computed(() => {
  const stats = { pair: { right: 0, total: 0 }, rule: { right: 0, total: 0 }, drill: { right: 0, total: 0 } }
  for (const r of store.phoneticStates) {
    if (!stats[r.kind]) continue
    stats[r.kind].total++
    if (r.correct) stats[r.kind].right++
  }
  return stats
})

// 每个音标最近跟读状态
const drillByPhoneme = computed(() => {
  const by = {}
  for (const r of store.phoneticStates) {
    if (r.kind !== 'drill') continue
    if (!by[r.ref_id]) by[r.ref_id] = []
    by[r.ref_id].push(r.correct)
  }
  return by
})
function heatClass(sym) {
  const arr = drillByPhoneme.value[sym.replace(/\//g, '')]
  if (!arr) return 'cold'
  const recent = arr.slice(0, 5)
  const rate = recent.filter(Boolean).length / recent.length
  if (rate >= 0.8) return 'hot'
  if (rate >= 0.5) return 'warm'
  return 'cold'
}
function heatTip(sym) {
  const arr = drillByPhoneme.value[sym.replace(/\//g, '')]
  if (!arr) return '还没练过'
  const rate = arr.slice(0, 5).filter(Boolean).length / Math.min(5, arr.length)
  return `近 5 次跟读:${Math.round(rate * 100)}%`
}

async function apiSubmitPhonetics(kind, refId, correct) {
  if (!store.user) return
  try { await api.submitPhonetics(store.user.id, kind, refId, correct) } catch { /* 离线 */ }
}

watch(mode, () => { drill.value = null; hoverPh.value = null; stopPairTimer() })
</script>

<template>
  <div class="view-scroll">
    <div class="view-inner fade-in">
      <div class="terr-head">
        <div class="terr-kicker">TERRITORY · PHONETICS</div>
        <!-- 领地名逐字解焦入场(BlurText);scoped 里已把 terr-title 的 terrRise 置 none,让逐字动画独占 -->
        <BlurText text="发音舱" as="h2" class="terr-title" />
        <div class="terr-latin">PHONETICS POD</div>
        <div class="terr-rule" aria-hidden="true" />
        <p class="terr-sub">
          48 个国际音标，配 IPA 舌位图、舌位/唇形/气流三要素、最小对立体听辨和拼读规则。
          听不懂 native 的原因一半在单个音，一半在连读弱读——这里先解决前一半。
        </p>
      </div>

      <!-- 分段控件 -->
      <div class="mode-tabs">
        <button
          v-for="[key, label] in MODES" :key="key"
          class="mode-tab" :class="{ active: mode === key }"
          @click="mode = key"
        ><AppGlyph :name="PH_GLYPHS[key] || 'phonetics'" :size="14" /><span>{{ label }}</span></button>
      </div>

      <!-- 音标/规则数据加载中:skeleton 占位 -->
      <template v-if="store.fetching">
        <div class="sk-ph-anatomy">
          <div class="skeleton sk-ph-mouth" />
          <div style="flex: 1; min-width: 0">
            <div class="skeleton sk-line" :style="{ width: '30%', height: '42px' }" />
            <div v-for="i in 3" :key="i" class="skeleton sk-line" :style="{ width: `${92 - i * 6}%`, height: '48px', marginTop: '12px' }" />
          </div>
        </div>
        <div class="card" style="margin-top: 48px">
          <div class="skeleton sk-line" :style="{ width: '26%', height: '18px', marginBottom: '16px' }" />
          <div class="sk-ph-grid">
            <div v-for="i in 18" :key="i" class="skeleton sk-ph-cell" />
          </div>
        </div>
      </template>

      <!-- ============ 音标解剖 ============ -->
      <div v-else-if="mode === 'anatomy'" class="cascade">
        <div v-if="tipOfDay" class="card ph-tip-banner">
          <div class="ph-tip-kicker">TIP OF THE DAY · 今日一策</div>
          <div class="ph-tip-row">
            <span><b>{{ tipOfDay.title }}</b> — {{ tipOfDay.example }}</span>
            <button class="btn small ghost" @click="store.setView('tips')">全部发音技巧 →</button>
          </div>
        </div>

        <!-- 主舞台卡:全页主角的卡壳(card 语言 + 点阵空气),口型仪是卡里的一台仪器 -->
        <div class="mouth-stage card dots-host">
          <span class="dots-decor dots-fade" aria-hidden="true" style="--dots-o:.16" />
          <div class="mouth-svg-box">
            <MouthSVG v-if="rp" :symbol="sel.symbol" />
            <div v-else class="mouth-empty dots-host">
              <span class="dots-decor dots-fade" aria-hidden="true" style="--dots-o:.3" />
              <IcDown class="me-arrow" />
              <div class="me-kicker">AWAITING PHONEME</div>
              <div class="me-title">从下面挑一个音标</div>
              <div class="mouth-empty-sub">选好后这里会展示口腔剖面和发音动作</div>
            </div>
            <div class="mouth-caption">
              {{ rp?.place ? `发音部位:${rp.place}` : rp?.kind === 'vowel' ? '元音 · 舌位高低前后决定音色' : rp?.kind === 'diph' ? '双元音 · 舌位连续滑动' : '选择音标开始' }}
            </div>
          </div>

          <div v-if="sel" class="mouth-info">
            <div class="mouth-info-head">
              <div>
                <div class="mouth-symbol" :class="{ diph: rp?.kind === 'diph' }">{{ sel.symbol }}</div>
                <div class="text-3" style="font-size: var(--fs-sm); margin-top: 4px">{{ sel.name }} · {{ sel.tip }}</div>
              </div>
              <button class="wp-speak" @click="speak(sel.symbol.replace(/\//g, ''), { rate: 0.7 })" title="听音标"><IcSpeaker /></button>
            </div>

            <div v-if="rp && rp.manner" style="display: flex; gap: 6px; flex-wrap: wrap; margin: 10px 0">
              <span class="chip amber">{{ MANNER_LABEL[rp.manner] }}</span>
              <span class="chip" :class="rp.voiced ? 'green' : ''">{{ rp.voiced ? '浊辅音 · 声带振动' : '清辅音 · 声带不振动' }}</span>
            </div>

            <!-- 三要素 -->
            <div v-if="elements" class="three-elem">
              <div class="three-elem-title">发音三要素</div>
              <div class="three-elem-grid">
                <div class="elem-cell">
                  <div class="elem-label">舌位</div>
                  <div class="elem-text">{{ elements.tongue }}</div>
                </div>
                <div class="elem-cell">
                  <div class="elem-label">唇形</div>
                  <div class="elem-text">{{ elements.lip }}</div>
                </div>
                <div class="elem-cell">
                  <div class="elem-label">气流/声带</div>
                  <div class="elem-text">{{ elements.air }}</div>
                </div>
              </div>
            </div>

            <!-- 示例词 + 跟读 -->
            <div class="wp-label" style="margin-top: 18px">示例词 · 点麦克风跟读打分</div>
            <div v-for="(w, i) in sel.example_words || []" :key="i" class="wp-example">
              <div style="flex: 1; min-width: 0">
                <div style="display: flex; align-items: center; gap: 8px">
                  <span style="font-weight: 500">{{ w.en }}</span>
                  <span class="ipa" style="font-size: var(--fs-xs)">{{ w.ipa }}</span>
                </div>
                <div class="text-3" style="font-size: var(--fs-xs); margin-top: 2px">{{ w.zh }}</div>
                <div v-if="drill && i === 0" class="drill-feedback" :class="{ ok: drill.score >= 0.8, 'ritual-lit': drill.score >= 0.8 }">
                  <!-- 得分环:与口语竞技场同一 conic 语言 -->
                  <div class="score-ring" :style="{ background: `conic-gradient(${drill.score >= 0.8 ? 'var(--success)' : drill.score >= 0.5 ? 'var(--warn)' : 'var(--danger)'} ${drill.score * 360}deg, var(--surface-active) 0deg)` }">
                    <div class="score-ring-inner"><b>{{ Math.round(drill.score * 100) }}</b><span>分</span></div>
                  </div>
                  <span>{{ drillComment(drill.score) }}</span>
                  <!-- 音素级比对:错词单独高亮 + 慢速重听该词 -->
                  <div v-if="drill.score < 0.8" class="drill-words">
                    <span v-for="(dw, di) in drill.words" :key="di" class="drill-word" :class="dw.matched ? 'hit' : 'miss'">
                      {{ dw.word }}
                      <button v-if="!dw.matched" class="word-replay" title="慢速重听该词" @click="speak(dw.word, { rate: 0.6 })"><IcReplay /></button>
                    </span>
                  </div>
                </div>
                <!-- 录音波形:麦克风授权后为真实波形,被拒降级伪动画 -->
                <div v-if="drilling && i === 0" class="wave-wrap">
                  <canvas v-if="micOk" ref="waveCanvas" class="wave-canvas" width="640" height="56"></canvas>
                  <div v-else class="wave-bar">
                    <div v-for="(v, k) in drillWave" :key="k" :style="{ height: `${v * 100}%` }" />
                  </div>
                  <div v-if="micDenied" class="mic-hint">没拿到麦克风权限,现在显示的是示意波形,跟读打分不受影响</div>
                </div>
              </div>
              <div style="display: flex; gap: 4px; align-items: center">
                <button class="wp-speak" @click="speak(w.en)" title="听示范"><IcSpeaker /></button>
                <button
                  v-if="i === 0" class="wp-speak drill-btn"
                  :disabled="!supported || drilling"
                  :title="supported ? '跟读这个示例词' : '当前浏览器不支持语音识别'"
                  @click="startDrill(w)"
                ><IcMic :class="{ rec: drilling }" /></button>
              </div>
            </div>
            <div v-if="!supported" class="ph-unsupported">注意:跟读打分需要 Chrome 或 Edge 的语音识别</div>

            <!-- 易混 -->
            <div v-if="sel.similar?.length > 0" style="margin-top: 14px">
              <div class="wp-label">容易和它混的音标</div>
              <div style="display: flex; gap: 6px; flex-wrap: wrap">
                <button
                  v-for="s in sel.similar" :key="s" class="chip red ph-similar"
                  @click="pickSimilar(s)"
                >{{ s }}</button>
              </div>
            </div>
          </div>
        </div>

        <!-- 48 音标大表:IPA 专业排列 / 分类表 切换(主节,与口型舞台之间留足呼吸) -->
        <div class="card ph-chart-card">
          <div class="card-head">
            <div class="h-section">48 音标 IPA 总表</div>
            <div class="chart-toggle">
              <button :class="{ active: chartView === 'chart' }" @click="chartView = 'chart'">IPA 舌位图</button>
              <button :class="{ active: chartView === 'table' }" @click="chartView = 'table'">分类表</button>
            </div>
          </div>

          <!-- IPA 图:元音舌位梯形 + 辅音矩阵 -->
          <template v-if="chartView === 'chart'">
            <div class="ph-group-label">单元音 · 舌位梯形图(横轴:前 → 后,纵轴:高·闭 → 低·开)</div>
            <svg class="ipa-svg" viewBox="0 0 360 240">
              <!-- 舌位梯形 -->
              <polygon class="trap" points="46,26 314,26 330,206 46,112" />
              <text x="40" y="18" font-size="10" fill="var(--text-3)">前</text>
              <text x="322" y="18" font-size="10" fill="var(--text-3)">后</text>
              <text x="170" y="16" font-size="10" fill="var(--text-3)">高 · 闭</text>
              <text x="170" y="224" font-size="10" fill="var(--text-3)">低 · 开</text>
              <g
                v-for="d in vowelDots" :key="d.p.id"
                class="ipa-dot" :class="[heatClass(d.p.symbol), { active: selId === d.p.id }]"
                @click="pickWithTooltip(d.p, $event)"
                @mouseenter="showPhTooltip(d.p, $event)" @mousemove="movePhTooltip($event)" @mouseleave="hidePhTooltip"
              >
                <circle :cx="d.pos.x" :cy="d.pos.y" r="14" />
                <text :x="d.pos.x" :y="d.pos.y + 4">{{ d.p.symbol.replace(/\//g, '') }}</text>
              </g>
            </svg>

            <div class="ph-group-label ph-sec">双元音 · 舌位连续滑动(点击进入跟读)</div>
            <div class="ph-grid ph-grid-large">
              <button
                v-for="p in diphList" :key="p.id"
                class="ph-cell" :class="[p.type, heatClass(p.symbol), { active: selId === p.id }]"
                @click="pickWithTooltip(p, $event)"
                @mouseenter="showPhTooltip(p, $event)" @mousemove="movePhTooltip($event)" @mouseleave="hidePhTooltip"
              >{{ p.symbol }}</button>
            </div>

            <div class="ph-group-label ph-sec">辅音矩阵 · 行 = 发音方式,列 = 发音部位(左清右浊)</div>
            <div class="cons-matrix">
              <div class="cm-cell cm-head">方式 ╲ 部位</div>
              <div v-for="[col, clabel] in PLACE_COLS" :key="col" class="cm-cell cm-head">{{ clabel }}</div>
              <template v-for="row in consGrid" :key="row.manner">
                <div class="cm-cell cm-rowlabel">{{ row.mlabel }}</div>
                <div
                  v-for="cell in row.cols" :key="cell.col"
                  class="cm-cell" :class="{ empty: !cell.list.length }"
                >
                  <button
                    v-for="p in cell.list" :key="p.id"
                    class="ph-cell ph-mcell" :class="[p.type, heatClass(p.symbol), { active: selId === p.id }]"
                    @click="pickWithTooltip(p, $event)"
                    @mouseenter="showPhTooltip(p, $event)" @mousemove="movePhTooltip($event)" @mouseleave="hidePhTooltip"
                  >{{ p.symbol }}</button>
                </div>
              </template>
            </div>
          </template>

          <!-- 分类表(原视图) -->
          <template v-else>
            <div class="text-3" style="font-size: var(--fs-xs); margin-bottom: 4px">悬停或点按任意音标，看它的发音描述、最近得分和词例</div>
            <div v-for="g in groups" :key="g.label" style="margin-bottom: 14px">
              <div class="ph-group-label" style="display: flex; justify-content: space-between">
                <span>{{ g.label }}</span>
                <span class="text-3" style="font-size: var(--fs-2xs)">{{ g.list.length }} / {{ g.count }}</span>
              </div>
              <div class="ph-grid ph-grid-large">
                <button
                  v-for="p in g.list" :key="p.id"
                  class="ph-cell" :class="[p.type, heatClass(p.symbol), { active: selId === p.id }]"
                  @click="pickWithTooltip(p, $event)"
                  @mouseenter="showPhTooltip(p, $event)" @mousemove="movePhTooltip($event)" @mouseleave="hidePhTooltip"
                >{{ p.symbol }}</button>
              </div>
            </div>
          </template>

          <!-- 图例收成卡底 footer:mono 小字 + 上方发丝线,样式见 .ph-chart-legend -->
          <div class="text-3 ph-chart-legend">
            图例:
            <span class="ph-cell hot ph-legend-chip">/x/</span> 跟读稳定 80%+
            ·
            <span class="ph-cell warm ph-legend-chip">/x/</span> 一般
            ·
            <span class="ph-cell cold ph-legend-chip">/x/</span> 未练 / 待加强
          </div>
        </div>
      </div>

      <!-- ============ 听辨测试(分级 + 计时) ============ -->
      <div v-else-if="mode === 'pairs'" class="cascade">
        <div class="card pairs-intro">
          <div class="pi-flex">
            <div>
              <div class="h-section">最小对立体听辨 · Ship or Sheep?</div>
              <p class="card-sub">系统读一组易混音对里的一个词,你判断听到的是哪个。每题 5 秒,超时按答错算。答错时先告诉你「你听成了哪个」,再揭晓正确答案,方便对比两个音差在哪。</p>
            </div>
            <div class="pi-actions">
              <button v-if="pairsMode !== 'playing'" class="btn primary lg" @click="startPairs">开始听辨</button>
              <button v-else class="btn danger lg" @click="finishPairs">结束本轮</button>
            </div>
          </div>
          <div class="pair-levels">
            <button
              v-for="lv in PAIR_LEVELS" :key="lv.key"
              class="rule-filter" :class="{ active: pairLevel === lv.key }"
              @click="setPairLevel(lv.key)"
            ><i class="lv-dot" :class="lv.dot"></i>{{ lv.label }}({{ pairsOfLevel.length }} 组)</button>
            <span v-if="levelRestored && pairsMode !== 'playing'" class="text-3" style="font-size: var(--fs-xs); align-self: center">上次练的就是这一档,帮你选好了</span>
          </div>
          <div v-if="pairsMode === 'playing'" class="pairs-stats">
            <div class="stat-pill"><span class="text-3">连击</span><b class="fire">{{ pairStreak }}</b></div>
            <div class="stat-pill"><span class="text-3">最高连击</span><b>{{ pairBestStreak }}</b></div>
            <div class="stat-pill"><span class="text-3">正确</span><b class="text-success">{{ pairScore.right }} / {{ pairScore.total }}</b></div>
            <div class="stat-pill"><span class="text-3">正确率</span><b>{{ pairAccuracy }}%</b></div>
          </div>
        </div>

        <!-- 待命空态:信号站还没开机,一排静默声纹 + 点阵打底(信号轨道的语言) -->
        <div v-if="pairsMode === 'idle'" class="card pairs-idle dots-host">
          <span class="dots-decor dots-fade" aria-hidden="true" style="--dots-o:.35" />
          <div class="pi-wave" aria-hidden="true">
            <i v-for="(h, i) in [22, 46, 74, 34, 58, 28, 64]" :key="i" :style="{ height: h + '%' }" />
          </div>
          <div class="pi-standby">SIGNAL STANDBY · 信号待接收</div>
          <p class="pi-note">开始后,系统会读出每组对立词里的一个——ship 还是 sheep,5 秒内点出你听到的那个。超时按答错算,但会揭晓答案让你对比。</p>
        </div>

        <div v-if="pairsMode === 'playing' && currentPair" class="pairs-stage card">
          <div class="pairs-head">
            <span class="chip cyan">第 {{ pairScore.total + 1 }} 题 · {{ levelLabel }}</span>
            <!-- 5 秒倒计时环 -->
            <div v-if="pairPicked === null" class="pair-timer" :class="{ low: pairLeft <= 2000 }">
              <svg width="40" height="40" viewBox="0 0 40 40">
                <circle cx="20" cy="20" r="15" fill="none" stroke="var(--line)" stroke-width="4" />
                <circle
                  cx="20" cy="20" r="15" fill="none" stroke-width="4" stroke-linecap="round"
                  :stroke="pairLeft <= 2000 ? 'var(--danger)' : 'var(--accent)'"
                  :stroke-dasharray="RING_C" :stroke-dashoffset="RING_C * (1 - pairLeftRatio)"
                  transform="rotate(-90 20 20)"
                />
              </svg>
              <b>{{ (pairLeft / 1000).toFixed(1) }}s</b>
            </div>
          </div>
          <div class="pairs-question">刚读的是哪一个?点你听到的那个</div>

          <div class="pair-options">
            <button class="pair-opt" :class="{
              correct: pairPicked !== null && heard === 'a',
              wrong: pairPicked === 'a' && heard !== 'a',
              dim: pairPicked !== null && pairPicked !== 'a' && heard !== 'a',
            }" :disabled="pairPicked !== null" @click="pickPair('a')">
              <div class="pair-word">{{ currentPair.a.word }}</div>
              <div class="pair-ipa ipa">{{ currentPair.a.ipa }}</div>
              <div v-if="pairPicked !== null" class="pair-meaning">{{ currentPair.a.zh }}</div>
            </button>
            <button class="pair-opt" :class="{
              correct: pairPicked !== null && heard === 'b',
              wrong: pairPicked === 'b' && heard !== 'b',
              dim: pairPicked !== null && pairPicked !== 'b' && heard !== 'b',
            }" :disabled="pairPicked !== null" @click="pickPair('b')">
              <div class="pair-word">{{ currentPair.b.word }}</div>
              <div class="pair-ipa ipa">{{ currentPair.b.ipa }}</div>
              <div v-if="pairPicked !== null" class="pair-meaning">{{ currentPair.b.zh }}</div>
            </button>
          </div>

          <div v-if="pairPicked !== null" class="pair-feedback fade-in" :class="pairPicked === heard ? 'ok' : 'no'">
            <div v-if="pairPicked === 'timeout'">
              <div style="font-size: var(--fs-md); font-weight: 600; color: var(--danger)">这一题超时了,按答错算</div>
              <div class="text-3" style="font-size: var(--fs-sm); margin: 4px 0 6px">实际读的是 <b style="color: var(--success)">{{ currentPair[heard].word }}</b> · {{ currentPair.hint }}</div>
              <div class="pair-replay" @click="replayPair"><IcReplay />再听一遍,对比差别</div>
            </div>
            <div v-else-if="pairPicked === heard">
              <div style="font-size: var(--fs-md); font-weight: 600; color: var(--success)">答对了,是 {{ currentPair[heard].word }}</div>
              <div class="text-3" style="font-size: var(--fs-sm); margin-top: 4px">{{ pairOkText() }} · {{ currentPair.hint }}</div>
            </div>
            <div v-else>
              <div style="font-size: var(--fs-md); font-weight: 600; color: var(--danger)">你听成了 {{ currentPair[pairPicked].word }}</div>
              <div class="text-3" style="font-size: var(--fs-sm); margin: 4px 0 6px">实际读的是 <b style="color: var(--success)">{{ currentPair[heard].word }}</b> · {{ currentPair.hint }}</div>
              <div class="pair-replay" @click="replayPair"><IcReplay />再听一遍,对比差别</div>
            </div>
          </div>

          <div class="rv-actions" style="margin-top: 18px">
            <button class="btn small ghost" @click="replayPair"><IcReplay />重听</button>
            <button v-if="pairPicked !== null" class="btn primary" @click="nextPair">下一组 →</button>
          </div>
        </div>

        <div v-if="pairsMode === 'done'" class="card pairs-summary">
          <div class="ps-kicker">ROUND COMPLETE · 本轮结束</div>
          <div class="section-title">本轮听辨 {{ pairScore.total }} 组,答对 {{ pairScore.right }}</div>
          <p class="section-sub">{{ pairSummaryText() }}</p>
          <div class="rv-actions" style="margin-top: 18px">
            <button class="btn primary" @click="startPairs">再来一轮</button>
            <button class="btn" @click="mode = 'anatomy'">去看口型解剖</button>
          </div>
        </div>
      </div>

      <!-- ============ 拼读规则(每条 3 关) ============ -->
      <div v-else-if="mode === 'rules'">
        <!-- 头部三件套(引子/难度/灯串索引)级联入场 -->
        <div class="cascade">
        <div class="section-sub rules-lede">
          看到生词能读、听到音能拼——拼读规则(phonics)是自学生词的钥匙。每条规则配三关验收:英→选读音、听音→选单词、找规律,三关全对才点亮。
        </div>
        <div class="rules-filters">
          <button v-for="lvl in ['all', 'L1', 'L2', 'L3']" :key="lvl" class="rule-filter" :class="{ active: ruleLvl === lvl }" @click="ruleLvl = lvl">
            {{ lvl === 'all' ? '全部' : lvl }}
          </button>
        </div>
        <!-- 14 点灯串轨道:一条轨道上挂着全部规则,三关全对=金,有错题=琥珀,没碰过=暗尘;点了飞到那条卡 -->
        <div class="rule-lights" role="tablist" aria-label="拼读规则灯串">
          <button
            v-for="r in store.rules" :key="r.id"
            class="rule-light" :class="ruleAllRight(r) ? 'lit' : ruleDone(r) ? 'err' : 'dust'"
            :title="`规则 ${r.id} · ${r.title}`"
            @click="jumpToRule(r.id)"
          ><i /><span>{{ r.id }}</span></button>
        </div>
        </div>
        <!-- 规则卡:整板依次浮入(45ms/张,纯视觉索引) -->
        <div class="grid cols-2 stagger">
          <div
            v-for="(r, i) in rulesFiltered" :key="r.id" :id="`rule-${r.id}`"
            class="card rule-card" :class="{ solved: ruleAllRight(r) }"
            :style="{ '--i': i }"
          >
            <div class="rule-head">
              <span class="chip cyan">规则 {{ r.id }}</span>
              <span v-if="ruleDone(r) && ruleAllRight(r)" class="chip green">已点亮</span>
              <span v-else-if="ruleDone(r)" class="chip amber">有错题 · 再看看</span>
            </div>
            <div class="rule-title">{{ r.title }}</div>
            <p class="rule-text">{{ r.rule }}</p>

            <!-- 发音部位 / 规律示意(手绘 SVG) -->
            <svg v-if="rd(r)" class="rule-svg" viewBox="0 0 300 88">
              <!-- 元音类:舌位梯形定位 -->
              <template v-if="rd(r).type === 'vowel'">
                <polygon points="14,14 250,14 262,64 14,34" fill="none" stroke="var(--line-strong)" stroke-width="1.2" />
                <text x="8" y="12" font-size="8" fill="var(--text-3)">前·高</text>
                <text x="252" y="72" font-size="8" fill="var(--text-3)">后·低</text>
                <template v-for="(pt, i) in rd(r).pts" :key="i">
                  <line
                    v-if="rd(r).link && i > 0"
                    :x1="vx(rd(r).pts[i - 1].f)" :y1="vy(rd(r).pts[i - 1].h)"
                    :x2="vx(pt.f)" :y2="vy(pt.h)"
                    stroke="var(--accent)" stroke-width="1.4" stroke-dasharray="3 3"
                  />
                  <circle :cx="vx(pt.f)" :cy="vy(pt.h)" r="12" fill="var(--surface)" stroke="var(--accent)" stroke-width="1.4" />
                  <text :x="vx(pt.f)" :y="vy(pt.h) + 3.5" font-size="9" fill="var(--text)" text-anchor="middle" font-family="var(--mono)">{{ pt.l }}</text>
                </template>
              </template>
              <!-- 辅音类:发音部位轴(唇 → 喉) -->
              <template v-else-if="rd(r).type === 'place'">
                <line x1="14" y1="56" x2="290" y2="56" stroke="var(--line-strong)" stroke-width="1.2" />
                <template v-for="([col, clabel], ci) in PLACE_COLS" :key="col">
                  <line :x1="20 + ci * 44" :y1="52" :x2="20 + ci * 44" :y2="60" stroke="var(--line-strong)" />
                  <text :x="20 + ci * 44" y="70" font-size="7.5" fill="var(--text-3)" text-anchor="middle">{{ clabel }}</text>
                </template>
                <template v-for="(pt, i) in rd(r).pts" :key="'d' + i">
                  <circle :cx="PLACE_X[pt.p]" cy="34" r="12" fill="var(--surface)" stroke="var(--accent)" stroke-width="1.4" />
                  <text :x="PLACE_X[pt.p]" y="37.5" font-size="9" fill="var(--text)" text-anchor="middle" font-family="var(--mono)">{{ pt.l }}</text>
                </template>
              </template>
              <!-- 序列类:辅音连缀 / 词尾三读 -->
              <template v-else-if="rd(r).type === 'seq'">
                <template v-for="(it, i) in rd(r).items" :key="i">
                  <circle :cx="seqX(rd(r).items.length, i)" cy="34" r="15" fill="var(--surface)" stroke="var(--accent)" stroke-width="1.4" />
                  <text :x="seqX(rd(r).items.length, i)" y="37.5" font-size="10" fill="var(--text)" text-anchor="middle" font-family="var(--mono)">{{ it }}</text>
                </template>
                <template v-for="(it, i) in rd(r).items.slice(0, -1)" :key="'a' + i">
                  <line :x1="seqX(rd(r).items.length, i) + 18" y1="34" :x2="seqX(rd(r).items.length, i + 1) - 16" y2="34" stroke="var(--accent)" stroke-width="1.4" />
                  <polygon
                    :points="`${seqX(rd(r).items.length, i + 1) - 16},34 ${seqX(rd(r).items.length, i + 1) - 24},30.5 ${seqX(rd(r).items.length, i + 1) - 24},37.5`"
                    fill="var(--accent)"
                  />
                </template>
              </template>
              <!-- 哑音字母 -->
              <template v-else-if="rd(r).type === 'mute'">
                <template v-for="(ch, i) in rd(r).word.split('')" :key="i">
                  <text
                    :x="150 + (i - (rd(r).word.length - 1) / 2) * 22" y="42"
                    font-size="16" font-family="var(--mono)" text-anchor="middle"
                    :fill="rd(r).mute.includes(i) ? 'var(--text-4)' : 'var(--text)'"
                  >{{ ch }}</text>
                  <line
                    v-if="rd(r).mute.includes(i)"
                    :x1="150 + (i - (rd(r).word.length - 1) / 2) * 22 - 7" :x2="150 + (i - (rd(r).word.length - 1) / 2) * 22 + 7"
                    y1="37" y2="37" stroke="var(--danger)" stroke-width="1.5"
                  />
                </template>
              </template>
              <!-- 重音移位 -->
              <template v-else-if="rd(r).type === 'stress'">
                <template v-for="(tk, i) in rd(r).tokens" :key="i">
                  <rect
                    :x="28 + i * 62" y="20" width="56" height="26" rx="7"
                    :fill="i === rd(r).hi ? 'var(--accent-soft)' : 'var(--surface-sunken)'"
                    :stroke="i === rd(r).hi ? 'var(--accent)' : 'var(--line-strong)'"
                  />
                  <text
                    :x="28 + i * 62 + 28" y="37" font-size="11" text-anchor="middle" font-family="var(--mono)"
                    :fill="i === rd(r).hi ? 'var(--accent)' : 'var(--text-3)'"
                  >{{ tk }}</text>
                </template>
              </template>
              <text x="150" y="86" font-size="9.5" fill="var(--text-3)" text-anchor="middle">{{ rd(r).cap }}</text>
            </svg>

            <div class="rule-examples">
              <button
                v-for="(ex, i) in r.examples.slice(0, 3)" :key="i"
                class="rule-example" @click="speak(ex.replace(/\/.*\//, ''))"
              >{{ ex }}</button>
            </div>
            <div v-for="(q, qi) in r.quizzes" :key="qi" class="rule-quiz">
              <div class="wp-label" style="margin: 10px 0 6px">第 {{ qi + 1 }} 关 · {{ q.type }}</div>
              <div class="rule-question">
                {{ q.question.replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]\s*/gu, '') }}
                <button v-if="q.listen" class="wp-speak" style="margin-left: 6px; vertical-align: middle" title="听单词" @click="speak(q.listen, { rate: 0.85 })"><IcSpeaker /></button>
              </div>
              <div class="rule-options">
                <button
                  v-for="(o, oi) in q.options" :key="oi"
                  class="rule-opt" :class="ruleOptCls(r, qi, oi)"
                  :disabled="ruleAnswers[`${r.id}-${qi}`] !== undefined" @click="pickRule(r, qi, oi)"
                >{{ o }}</button>
              </div>
              <div v-if="ruleAnswers[`${r.id}-${qi}`] !== undefined" class="rule-feedback fade-in">
                <span v-if="ruleResults[`${r.id}-${qi}`]" class="ok">答对 · {{ q.explain }}</span>
                <span v-else class="no">答错 · {{ q.explain }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- ============ 掌握度 ============ -->
      <div v-else class="cascade">
        <div class="grid cols-3 stagger mastery-tiles">
          <!-- 练习流水加载中:骨架占位 -->
          <template v-if="statesLoading">
            <div v-for="i in 3" :key="i" class="card stat-tile mastery-tile">
              <div class="skeleton" :style="{ width: '58%', height: '44px' }" />
              <div class="skeleton" :style="{ width: '82%', height: '12px', marginTop: '10px' }" />
            </div>
          </template>
          <template v-else>
            <!-- 三磁贴各领一色氛围:听辨=accent / 拼读=accent-2 / 跟读=success(kicker 同步提色) -->
            <div class="card stat-tile mastery-tile mt-pair">
              <div class="mt-kicker">PAIR · 听辨</div>
              <div class="num">
                <CountNum :v="masteryData.pair.total ? Math.round(masteryData.pair.right / masteryData.pair.total * 100) : '—'" mono />
                <span v-if="masteryData.pair.total" class="mt-unit">%</span>
              </div>
              <div class="lbl">听辨测试({{ masteryData.pair.right }}/{{ masteryData.pair.total }})</div>
              <div class="mt-bar"><i :style="{ width: (masteryData.pair.total ? Math.round(masteryData.pair.right / masteryData.pair.total * 100) : 0) + '%' }" /></div>
            </div>
            <div class="card stat-tile mastery-tile mt-rules">
              <div class="mt-kicker">RULES · 拼读</div>
              <div class="num">
                <CountNum :v="masteryData.rule.total ? Math.round(masteryData.rule.right / masteryData.rule.total * 100) : '—'" mono />
                <span v-if="masteryData.rule.total" class="mt-unit">%</span>
              </div>
              <div class="lbl">拼读规则({{ masteryData.rule.right }}/{{ masteryData.rule.total }})</div>
              <div class="mt-bar alt"><i :style="{ width: (masteryData.rule.total ? Math.round(masteryData.rule.right / masteryData.rule.total * 100) : 0) + '%' }" /></div>
            </div>
            <div class="card stat-tile mastery-tile mt-drill">
              <div class="mt-kicker">DRILL · 跟读</div>
              <div class="num">
                <CountNum :v="masteryData.drill.right" mono /><span class="mt-slash">/{{ masteryData.drill.total }}</span>
              </div>
              <div class="lbl">跟读达标(80 分+)</div>
              <div class="mt-bar ok"><i :style="{ width: (masteryData.drill.total ? Math.round(masteryData.drill.right / masteryData.drill.total * 100) : 0) + '%' }" /></div>
            </div>
          </template>
        </div>

        <div class="card">
          <div class="card-head"><div class="h-section">48 音标跟读热力图</div></div>
          <p class="card-sub">
            去「音标解剖」跟读,练过的音标会在这里亮起来。颜色看的是你最近 5 次跟读:绿=稳定,黄=一般,灰=还没练。
          </p>
          <!-- 四组音标依次浮入(45ms/组),组内格子随组同帧出现 -->
          <div class="stagger">
            <div v-for="(g, gi) in groups" :key="g.label" class="ph-heat-group" :style="{ '--i': gi }">
              <div class="ph-group-label">{{ g.label }}</div>
              <div class="ph-grid ph-grid-large">
                <span
                  v-for="p in g.list" :key="p.id"
                  class="ph-cell" :class="[p.type, heatClass(p.symbol)]"
                  :title="`${p.symbol} · ${heatTip(p.symbol)} · 点击去跟读`"
                  role="button" tabindex="0" style="cursor: pointer"
                  @click="enterAnatomy(p)" @keydown.enter="enterAnatomy(p)"
                >{{ p.symbol }}</span>
              </div>
            </div>
          </div>
          <div class="rv-actions" style="margin-top: 18px; justify-content: flex-start">
            <button class="btn" @click="store.refreshPhonetics()"><IcReplay />刷新数据</button>
            <button class="btn primary ph-go-drill" @click="mode = 'anatomy'">去跟读 →</button>
          </div>
        </div>
      </div>

      <!-- 音标悬停卡片:发音描述 + 得分趋势 sparkline + 词例 + 进入解剖 -->
      <div
        v-if="hoverPh" class="ph-tooltip" :class="{ below: tooltipBelow }" :style="tooltipStyle"
        @mouseenter="keepPhTooltip" @mouseleave="hidePhTooltip"
      >
        <div class="pt-head">
          <span class="pt-symbol">{{ hoverPh.symbol }}</span>
          <span class="pt-name">{{ hoverPh.name }}</span>
        </div>
        <div v-if="hoverElem" class="pt-elem">舌位 {{ hoverElem.tongue }} · 唇形 {{ hoverElem.lip }} · 气流 {{ hoverElem.air }}</div>
        <div class="pt-tip">{{ hoverPh.tip }}</div>
        <div class="pt-sec">最近跟读得分</div>
        <svg v-if="hoverScores.length" class="pt-spark" width="132" height="34" viewBox="0 0 132 34">
          <polyline :points="sparkPoints" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
          <circle
            v-for="(pt, i) in sparkPts" :key="i" :cx="pt.x" :cy="pt.y" r="2.5"
            :fill="hoverScores[i] >= 0.8 ? 'var(--success)' : 'var(--warn)'"
          />
        </svg>
        <div v-else class="pt-none">还没跟读过这个音,去音标解剖开练</div>
        <div v-if="hoverScores.length" class="pt-avg">最近 {{ hoverScores.length }} 次平均 <b>{{ sparkAvg }}</b> 分</div>
        <div class="pt-sec">词例</div>
        <div class="pt-words">
          <span v-for="w in hoverPh.example_words?.slice(0, 3)" :key="w.en" class="pt-word">
            <b>{{ w.en }}</b> <span class="ipa">{{ w.ipa }}</span> {{ w.zh }}
          </span>
        </div>
        <button class="pt-go" @click="enterAnatomy(hoverPh)">进入解剖 →</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 领地名交给 BlurText 逐字解焦,关掉全局 terrRise 避免双重动画 */
.terr-title { animation: none; }

/* 加载骨架 */
.sk-ph-anatomy { display: flex; gap: 32px; align-items: flex-start; flex-wrap: wrap; }
.sk-ph-mouth { width: 330px; max-width: 100%; height: 270px; border-radius: 18px; flex-shrink: 0; }
.sk-ph-grid { display: flex; flex-wrap: wrap; gap: 10px; }
.sk-ph-cell { width: 60px; height: 44px; border-radius: 10px; }
.sk-line { height: 12px; }

/* 内联 SVG 图标 */
.ic { display: inline-block; vertical-align: -0.14em; }
.wp-speak .ic { width: 15px; height: 15px; }
.word-replay .ic { width: 11px; height: 11px; }
.pair-replay .ic { width: 12px; height: 12px; margin-right: 4px; }
.btn .ic { width: 13px; height: 13px; margin-right: 5px; }
.mouth-empty .ic { width: 34px; height: 34px; opacity: 0.45; }
.ic.rec { color: var(--danger); }

.mode-tabs {
  display: inline-flex; gap: 4px; padding: 4px;
  /* 极淡 radial 氛围:切换器也是一块小仪表,内衬一点点信号色(不整体提亮) */
  background:
    radial-gradient(220px 80px at 12% 0%, color-mix(in srgb, var(--accent) 4%, transparent), transparent 70%),
    var(--surface);
  border: 1px solid var(--line);
  border-radius: 14px; margin-bottom: 32px;
  box-shadow: inset 0 1px 0 color-mix(in srgb, var(--text) 4%, transparent), var(--shadow-sm);
}
.mode-tab {
  border: 0; background: transparent; color: var(--text-2); cursor: pointer;
  padding: 9px 18px; border-radius: var(--r-md);
  font-size: var(--fs-sm); font-weight: 500; font-family: inherit;
  display: inline-flex; align-items: center; gap: 7px;
  transition: color 0.2s var(--ease), background 0.2s var(--ease);
}
.mode-tab:hover { color: var(--text); }
.mode-tab.active {
  color: var(--accent);
  background: var(--accent-soft);
  /* 底部一道金发丝线:切中的 tab 是已点亮的「关卡」,与灯串之金同一语义 */
  box-shadow: inset 0 0 0 1px var(--line-accent), inset 0 -2px 0 0 var(--gold);
}

/* 今日一策条(不与 Dashboard 的 hero 版 .tip-banner 冲突,独立类名)
   左缘 accent 刻线 + mono kicker,与信号轨道同一"领地公告"语言 */
.ph-tip-banner {
  padding: 16px 20px 14px; margin-bottom: 20px; font-size: var(--fs-sm);
  color: var(--text-2); border-color: var(--line); background: var(--surface);
}
.ph-tip-banner::after {
  content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 2px;
  background: linear-gradient(180deg, var(--accent), transparent 90%);
}
.ph-tip-kicker {
  font-family: var(--mono); font-size: var(--fs-2xs); font-weight: 600;
  letter-spacing: 0.26em; color: var(--text-3); text-transform: uppercase;
  margin-bottom: 8px;
}
.ph-tip-banner b { color: var(--warn); }
.ph-tip-row { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
.ph-unsupported { color: var(--warn); font-size: var(--fs-xs); margin-top: 6px; }
.ph-similar { cursor: pointer; }

/* 口腔(stage/info/caption 基础样式在全局 styles.css,这里只补本视图特有布局) */
/* 主舞台卡:全页主角的卡壳——card 语言(hairline/r-xl)全局给到,这里只叠 5% accent 内衬氛围;
   点阵由模板里的 dots-decor 铺底,与回声谷播放器卡同一空气感 */
.mouth-stage.card {
  background:
    radial-gradient(420px 240px at 16% 0%, color-mix(in srgb, var(--accent) 5%, transparent), transparent 68%),
    var(--surface);
}
/* 台口一道鎏金发丝线:口型台与听辨台的「幕沿」,与学习舱三幕舞台同一语言
   (卡的全局 ::before 是鼠标聚光,幕沿线走空闲的 ::after) */
.mouth-stage::after,
.pairs-stage::after {
  content: ''; position: absolute; left: 20px; right: 20px; top: 0; height: 1px;
  background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--gold) 45%, transparent), transparent);
}
.mouth-svg-box { flex-shrink: 0; }
.mouth-empty {
  position: relative; width: 330px; height: 270px;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px;
  color: var(--text-3);
}
/* 待选空态:箭头轻轻悬浮,是"这里有东西"的邀请,不是装饰 */
.me-arrow { animation: var(--animation-float); }
.me-kicker {
  font-family: var(--mono); font-size: var(--fs-2xs); font-weight: 600;
  letter-spacing: 0.3em; color: var(--text-3); text-transform: uppercase;
  margin-top: 12px;
}
.me-title { font-size: var(--fs-md); color: var(--text-2); margin-top: 2px }
.mouth-empty-sub { font-size: var(--fs-xs); opacity: 0.6; }
.mouth-caption { max-width: 330px; }
.mouth-info-head { display: flex; justify-content: space-between; align-items: flex-start; }
.mouth-symbol {
  /* 本页的「名字时刻」:音标本体升到 72px,衬线 + 金的展示级处理(它是此刻的主角) */
  font-family: var(--serif); font-size: 72px; font-weight: 600; line-height: 1;
  color: var(--gold);
  /* 音标是这一舱的星名:与三幕大词、阅读词卡同一款暖金光晕 */
  text-shadow: 0 0 36px color-mix(in srgb, var(--gold) 22%, transparent);
}
.mouth-symbol.diph { font-size: 60px; }

.wp-speak {
  background: var(--surface); border: 1px solid var(--line);
  color: var(--text); width: 32px; height: 32px; border-radius: 8px;
  cursor: pointer; font-size: var(--fs-base);
  display: inline-flex; align-items: center; justify-content: center;
  transition: all 0.2s var(--ease);
}
.wp-speak:hover { background: var(--accent-soft); border-color: var(--line-accent); }
.wp-speak.drill-btn { background: var(--accent-soft); border-color: var(--line-accent); color: var(--accent); }

/* 三要素 */
.three-elem {
  margin-top: 16px; padding: 14px; border-radius: 12px;
  background: linear-gradient(135deg, var(--accent-soft), transparent);
  border: 1px solid var(--line-accent);
}
.three-elem-title {
  font-size: var(--fs-2xs); color: var(--accent); letter-spacing: 0.08em;
  text-transform: uppercase; font-weight: 600; margin-bottom: 10px;
}
.three-elem-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.elem-cell {
  padding: 10px; border-radius: 10px;
  background: color-mix(in srgb, var(--surface) 60%, transparent);
  border: 1px solid var(--line);
  text-align: center;
}
.elem-label { font-size: var(--fs-2xs); color: var(--text-3); letter-spacing: 0.05em; text-transform: uppercase; font-weight: 600; }
.elem-text { font-size: var(--fs-2xs); color: var(--text); margin-top: 4px; line-height: 1.4; }

/* 例句 */
.wp-example {
  display: flex; align-items: center; gap: 12px; padding: 10px 12px;
  border-radius: 10px; background: var(--surface-sunken); border: 1px solid var(--line);
  margin-bottom: 6px; transition: all 0.2s var(--ease);
}
.wp-example:hover { background: var(--surface); border-color: var(--line-strong); }

/* 跟读反馈:升格成有底色的反馈行——微底色 + 左缘刻线(达标=success / 未达标=warn),
   与回声谷听后验收的 quiz-feedback 同一语言 */
.drill-feedback {
  margin-top: 8px; padding: 8px 12px;
  border-left: 2px solid var(--warn); border-radius: 0 10px 10px 0;
  background: color-mix(in srgb, var(--warn) 6%, transparent);
  font-size: var(--fs-xs); display: flex; align-items: center; gap: 10px;
}
.drill-feedback.ok {
  color: var(--success); border-left-color: var(--success);
  background: color-mix(in srgb, var(--success) 6%, transparent);
}
.drill-feedback:not(.ok) { color: var(--warn); }
/* 得分环(与口语竞技场同语言) */
.score-ring {
  width: 44px; height: 44px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
  transition: background 0.6s var(--ease);
  animation: dotPop 0.4s var(--ease-snap) both;
}
.score-ring-inner {
  width: 34px; height: 34px; border-radius: 50%; background: var(--surface);
  display: flex; align-items: baseline; justify-content: center; gap: 2px;
}
.score-ring-inner b { font-family: var(--mono); font-size: var(--fs-base); font-variant-numeric: tabular-nums; }
.score-ring-inner span { font-size: var(--fs-2xs); color: var(--text-3); }

/* 14 点灯串轨道 */
.rule-lights {
  display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
  padding: 12px 14px; margin-bottom: 16px;
  background: var(--surface-sunken); border: 1px solid var(--line); border-radius: 999px;
}
.rule-light {
  display: inline-flex; flex-direction: column; align-items: center; gap: 3px;
  background: none; border: 0; padding: 2px 4px; cursor: pointer;
  font-family: var(--mono); font-size: var(--fs-2xs); color: var(--text-3);
  transition: color 0.2s var(--ease);
}
.rule-light i {
  width: 10px; height: 10px; border-radius: 50%;
  background: var(--text-3); opacity: 0.3;
  transition: all 0.3s var(--ease);
}
.rule-light:hover { color: var(--text); }
.rule-light:hover i { opacity: 0.75; transform: scale(1.25); }
/* 三态:三关全对=金(点亮),有错题=琥珀呼吸,没碰过=暗尘 */
.rule-light.lit i { background: var(--gold); opacity: 1; box-shadow: 0 0 7px color-mix(in srgb, var(--gold) 45%, transparent); }
[data-theme='light'] .rule-light.lit i { box-shadow: none; }
.rule-light.err i { background: var(--warn); opacity: 0.9; animation: lightBlink 1.8s ease-in-out infinite; }
@keyframes lightBlink { 0%, 100% { opacity: 0.45 } 50% { opacity: 0.95 } }
.rule-light.lit { color: var(--gold); }
.rule-light.err { color: var(--warn); }
/* 音素级比对:错词高亮 + 重听按钮 */
.drill-words { display: flex; gap: 4px; flex-wrap: wrap; margin-top: 6px; }
.drill-word { padding: 2px 6px; border-radius: 6px; font-size: var(--fs-xs); }
.drill-word.hit { background: color-mix(in srgb, var(--success) 22%, transparent); color: var(--success); }
.drill-word.miss { background: color-mix(in srgb, var(--danger) 20%, transparent); color: var(--danger); text-decoration: line-through; }
.word-replay {
  margin-left: 3px; padding: 0 4px; border-radius: 5px; cursor: pointer;
  background: var(--surface); border: 1px solid var(--line-strong);
  font-size: var(--fs-2xs); line-height: 1.4; vertical-align: middle;
  text-decoration: none; transition: all 0.15s;
}
.word-replay:hover { background: var(--accent-soft); border-color: var(--line-accent); }

/* 录音波形:真实(Canvas) / 降级(伪动画) */
.wave-wrap { margin-top: 8px; }
.wave-canvas {
  display: block; width: 100%; height: 32px;
  color: var(--accent);
  background: var(--surface-sunken); border: 1px solid var(--line); border-radius: 6px;
}
.wave-bar {
  display: flex; align-items: center; gap: 2px;
  margin-top: 8px; height: 28px;
}
.wave-bar > div {
  flex: 1; min-width: 2px; max-width: 4px;
  background: var(--accent);
  border-radius: 2px;
  box-shadow: 0 0 4px color-mix(in srgb, var(--accent) 50%, transparent);
  transition: height 0.1s;
}
.mic-hint { color: var(--warn); font-size: var(--fs-2xs); margin-top: 5px; }

/* 48 音标大表
   基础 .ph-cell(尺寸/hover 反馈/元音辅音分层)在全局 styles.css,
   本视图只补掌握度状态与选中态——hover 因此与全站完全一致 */
.ph-grid-large { gap: 10px; margin-bottom: 6px; }
.ph-cell.active {
  border-color: var(--accent); color: var(--text);
  background: var(--accent-soft);
  box-shadow: 0 0 0 1px var(--accent), 0 0 18px var(--accent-soft);
  transform: scale(1.08);
}
.ph-cell.hot { border-color: color-mix(in srgb, var(--success) 45%, transparent); color: var(--success); box-shadow: 0 0 8px color-mix(in srgb, var(--success) 20%, transparent); }
.ph-cell.warm { border-color: color-mix(in srgb, var(--warn) 45%, transparent); color: var(--warn); }
.ph-cell.cold { color: var(--text-3); }
/* 图例里的示例格:只展示,不响应指针 */
.ph-legend-chip { pointer-events: none; }
/* 主节:与上方口型舞台之间留 48px 呼吸 */
.ph-chart-card { margin-top: 48px; }
/* 图例收成卡底 footer:上方发丝线分区 + mono 小字,示例格缩成 chip 尺寸(不再占大格子) */
.ph-chart-legend {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  margin-top: 18px; padding-top: 12px; border-top: 1px solid var(--line);
  font-family: var(--mono); font-size: var(--fs-2xs); letter-spacing: 0.04em;
}
.ph-chart-legend .ph-legend-chip { min-width: 0; padding: 2px 8px; font-size: var(--fs-2xs); border-radius: var(--r-xs); }
/* 分组标题:accent 小刻线开头,分段清晰 */
.ph-group-label {
  margin: 16px 0 8px; color: var(--text-3); font-size: var(--fs-xs);
  letter-spacing: 0.08em; text-transform: uppercase; font-weight: 600;
}
.ph-group-label::before {
  content: ''; display: inline-block; width: 14px; height: 1px;
  background: var(--accent); opacity: 0.55; margin-right: 9px; vertical-align: 3px;
}
.ph-sec { margin-top: 30px; }

/* 视图切换 */
.chart-toggle {
  display: inline-flex; gap: 4px; padding: 3px;
  background: var(--surface-sunken); border: 1px solid var(--line); border-radius: 10px;
}
.chart-toggle button {
  border: 0; background: transparent; color: var(--text-3); cursor: pointer;
  padding: 5px 12px; border-radius: 8px; font-size: var(--fs-xs); font-family: inherit;
  transition: all 0.2s var(--ease);
}
.chart-toggle button:hover { color: var(--text); }
.chart-toggle button.active { color: var(--accent); background: var(--accent-soft); box-shadow: inset 0 0 0 1px var(--line-accent); }

/* IPA 舌位梯形图 */
.ipa-svg { width: 100%; max-width: 520px; display: block; margin: 0 auto; }
.trap { fill: color-mix(in srgb, var(--accent) 4%, transparent); stroke: var(--line-strong); stroke-width: 1.5; }
.ipa-dot { cursor: pointer; }
.ipa-dot circle {
  fill: var(--surface); stroke: var(--text-3); stroke-width: 1.2;
  transition: all 0.2s var(--ease);
}
.ipa-dot:hover circle { stroke: var(--accent); fill: var(--accent-soft); }
.ipa-dot text { font-family: var(--mono); font-size: var(--fs-2xs); fill: var(--text); text-anchor: middle; pointer-events: none; }
.ipa-dot.hot circle { stroke: var(--success); fill: color-mix(in srgb, var(--success) 9%, var(--surface)); }
.ipa-dot.warm circle { stroke: var(--warn); fill: color-mix(in srgb, var(--warn) 8%, var(--surface)); }
.ipa-dot.active circle { stroke: var(--accent); stroke-width: 2; fill: var(--accent-soft); }

/* 辅音矩阵 */
.cons-matrix { display: grid; grid-template-columns: 72px repeat(7, 1fr); gap: 4px; align-items: stretch; }
.cm-cell {
  display: flex; gap: 4px; justify-content: center; align-items: center;
  min-height: 46px; border-radius: 8px; padding: 3px;
  background: var(--surface-sunken); border: 1px solid var(--line);
}
.cm-cell.empty { opacity: 0.35; background: transparent; border-style: dashed; }
.cm-head { font-size: var(--fs-2xs); color: var(--text-3); min-height: 26px; letter-spacing: 0.03em; }
/* 表头刻线:复用 ph-group-label 的 accent 小刻线,矩阵表头也有「分段标题」的记号 */
.cm-head::before {
  content: ''; display: inline-block; width: 12px; height: 1px;
  background: var(--accent); opacity: 0.55;
}
.cm-rowlabel { font-size: var(--fs-xs); color: var(--text-2); }
.ph-mcell { min-width: 0; padding: 7px 9px; font-size: var(--fs-base); }
/* 可点格子:全局 .ph-cell hover 已给 -2px 升起 + accent 亮边,补一点投影让升起有层次 */
.ph-mcell:not(.active):hover { box-shadow: var(--shadow-sm); }

/* 悬停卡片 */
.ph-tooltip {
  position: fixed; z-index: 60; width: 300px;
  background: var(--surface-hover); border: 1px solid var(--line-strong); border-radius: 14px;
  padding: 14px 16px; box-shadow: var(--shadow-lg);
  transform: translate(-50%, calc(-100% - 14px));
  pointer-events: auto;
  animation: fadeIn 0.25s var(--ease);
}
.ph-tooltip.below { transform: translate(-50%, 18px); }
.pt-head { display: flex; align-items: baseline; gap: 10px; }
.pt-symbol { font-family: var(--mono); font-size: var(--fs-2xl); font-weight: 700; color: var(--accent); }
.pt-name { font-size: var(--fs-xs); color: var(--text-2); }
.pt-elem { font-size: var(--fs-2xs); color: var(--text-3); margin-top: 6px; line-height: 1.5; }
.pt-tip { font-size: var(--fs-2xs); color: var(--text-2); line-height: 1.6; margin-top: 6px; }
.pt-sec {
  font-size: var(--fs-2xs); color: var(--accent); letter-spacing: 0.08em;
  text-transform: uppercase; font-weight: 600; margin: 10px 0 4px;
}
.pt-spark { display: block; }
.pt-none { font-size: var(--fs-2xs); color: var(--text-3); }
.pt-avg { font-size: var(--fs-2xs); color: var(--text-3); margin-top: 2px; }
.pt-avg b { color: var(--text); }
.pt-words { display: flex; flex-direction: column; gap: 3px; }
.pt-word { font-size: var(--fs-xs); color: var(--text-2); }
.pt-word b { color: var(--text); font-weight: 600; }
.pt-word .ipa { font-size: var(--fs-2xs); }
.pt-go {
  margin-top: 12px; width: 100%; padding: 8px; border-radius: 9px; cursor: pointer;
  background: var(--accent-soft); border: 1px solid var(--line-accent); color: var(--accent);
  font-size: var(--fs-sm); font-weight: 600; font-family: inherit;
  transition: all 0.2s var(--ease);
}
.pt-go:hover { background: var(--accent); color: var(--on-accent); }

/* 听辨 */
.pairs-intro { margin-bottom: 16px; }
.pair-levels { display: flex; gap: 6px; margin-top: 14px; flex-wrap: wrap; align-items: center; }
.lv-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 7px; vertical-align: 0; }
.lv-dot.lv1 { background: var(--success); }
.lv-dot.lv2 { background: var(--warn); }
.lv-dot.lv3 { background: var(--danger); }
/* 统计读数条:与难度行用发丝线分区,连击/正确两个活跃读数带同色微光(数字 mono tabular) */
.pairs-stats { display: flex; gap: 10px; margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--line); flex-wrap: wrap; }
.stat-pill {
  padding: 6px 14px; border-radius: 999px;
  background: var(--surface-sunken); border: 1px solid var(--line);
  font-size: var(--fs-xs); display: inline-flex; align-items: center; gap: 6px;
}
.stat-pill b { color: var(--text); font-weight: 700; font-family: var(--mono); font-variant-numeric: tabular-nums; }
.stat-pill b.fire { color: var(--warn); text-shadow: 0 0 10px color-mix(in srgb, var(--warn) 45%, transparent); }
.stat-pill b.text-success { color: var(--success); text-shadow: 0 0 10px color-mix(in srgb, var(--success) 40%, transparent); }
[data-theme='light'] .stat-pill b.fire,
[data-theme='light'] .stat-pill b.text-success { text-shadow: none; }

/* 待命空态:静默声纹(确定性七柱,不做数据流动画)+ 点阵,信号站还没开机 */
.pairs-idle { padding: 36px 24px 32px; text-align: center; }
.pi-wave { display: flex; justify-content: center; align-items: center; gap: 5px; height: 42px; margin-bottom: 16px; }
.pi-wave i { width: 4px; border-radius: 2px; background: var(--accent); opacity: 0.38; }
.pi-standby {
  font-family: var(--mono); font-size: var(--fs-2xs); font-weight: 600;
  letter-spacing: 0.28em; color: var(--text-3); text-transform: uppercase;
  margin-bottom: 10px;
}
.pi-note { font-size: var(--fs-sm); line-height: 1.8; color: var(--text-3); max-width: 460px; margin: 0 auto; }

.pairs-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; gap: 12px; }
.pair-timer {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 3px 12px 3px 4px; border-radius: 999px;
  background: var(--surface-sunken); border: 1px solid var(--line);
}
.pair-timer b { font-size: var(--fs-base); font-family: var(--mono); color: var(--accent); }
.pair-timer.low b { color: var(--danger); }
/* 最后 2 秒:danger 播光呼吸,紧迫感是持续状态,所以要循环(不是一次性播光) */
.pair-timer.low { animation: timerPulse 1.1s var(--ease-in-out-2) infinite; }
@keyframes timerPulse {
  0%, 100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--danger) 22%, transparent); }
  55% { box-shadow: 0 0 0 8px color-mix(in srgb, var(--danger) 5%, transparent); }
}
/* 问题句是本节的「名字时刻」:衬线 + 加大一档,出题的句子值得被念出来 */
.pairs-question { text-align: center; font-family: var(--serif); color: var(--text); font-size: var(--fs-lg); margin-bottom: 18px; }
.pair-options { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; max-width: 600px; margin: 0 auto; }
.pair-opt {
  padding: 28px 22px; border-radius: 16px; cursor: pointer;
  text-align: center; font-family: inherit;
  background: var(--surface); border: 1px solid var(--line-strong);
  color: var(--text); transition: all 0.25s var(--ease);
  position: relative; overflow: hidden;
}
.pair-opt:hover:not(:disabled) {
  border-color: var(--line-accent);
  background: var(--surface-hover);
  transform: translateY(-3px);
  box-shadow: var(--shadow-md);
}
.pair-opt.correct {
  background: color-mix(in srgb, var(--success) 12%, transparent);
  border-color: var(--success);
  color: var(--success);
  animation: popCorrect 0.5s var(--ease-snap);
}
.pair-opt.wrong {
  background: color-mix(in srgb, var(--danger) 10%, transparent);
  border-color: var(--danger);
  color: var(--danger);
  animation: headShake 0.45s ease-in-out;
}
.pair-opt.dim { opacity: 0.45; }
/* 候选词是听辨时刻的名字:衬线接管(与问题句同一声部),字号升一档;
   对错配色由 .pair-opt 状态继承,不在此处占色 */
.pair-word { font-family: var(--serif); font-size: 34px; font-weight: 600; }
.pair-ipa { font-size: var(--fs-md); margin-top: 6px; }
.pair-meaning { font-size: var(--fs-xs); margin-top: 8px; color: var(--text-3); }
.pair-feedback { text-align: center; margin-top: 22px; line-height: 1.6; }
.pair-replay {
  display: inline-flex; align-items: center; margin-top: 8px; padding: 4px 12px;
  border-radius: 999px; background: var(--accent-soft);
  color: var(--accent); font-size: var(--fs-xs); cursor: pointer;
}
.pairs-summary { text-align: center; }
.pairs-summary .ps-kicker {
  font-family: var(--mono); font-size: var(--fs-2xs); font-weight: 600;
  letter-spacing: 0.28em; color: var(--accent); text-transform: uppercase;
  margin-bottom: 12px;
}
/* 出发与再来一轮是「点亮」的起手:鎏金渐变(与学习舱的出发/趁热同款);
   幕内推进(下一组 →)保持青色分工,不在此列 */
.pairs-intro .pi-actions .btn.primary,
.pairs-summary .btn.primary,
.btn.primary.ph-go-drill {
  background: linear-gradient(135deg, var(--gold), var(--gold-dim));
  border-color: transparent; color: var(--on-accent); font-weight: 600;
}
.pairs-intro .pi-actions .btn.primary:hover,
.pairs-summary .btn.primary:hover,
.btn.primary.ph-go-drill:hover {
  transform: translateY(-2px);
  box-shadow: 0 10px 28px color-mix(in srgb, var(--gold) 32%, transparent);
}
/* 晴空下 gold-dim 与 gold 同值,渐变退化成纯色:第二停靠点用 color-mix 压暗一档 */
[data-theme='light'] .pairs-intro .pi-actions .btn.primary,
[data-theme='light'] .pairs-summary .btn.primary,
[data-theme='light'] .btn.primary.ph-go-drill {
  background: linear-gradient(135deg, var(--gold), color-mix(in srgb, var(--gold) 80%, #7c3a0a));
}

/* 拼读规则 */
.rules-lede { margin-bottom: 16px; }
.rules-filters { display: flex; gap: 6px; margin-bottom: 16px; }
.rule-filter {
  padding: 6px 14px; border-radius: 999px; border: 1px solid var(--line);
  background: var(--surface); color: var(--text-2); cursor: pointer;
  font-family: inherit; font-size: var(--fs-sm); transition: all 0.2s;
  display: inline-flex; align-items: center;
}
.rule-filter:hover { color: var(--text); border-color: var(--line-strong); }
.rule-filter.active { background: var(--accent-soft); border-color: var(--line-accent); color: var(--accent); }

/* 规则卡 hover 升起:与全站 hoverable 卡同一手感(box-shadow 不在全局 card transition 里,补上) */
.rule-card { transition: transform 0.28s var(--ease), border-color 0.28s var(--ease), background 0.28s var(--ease), box-shadow 0.28s var(--ease); }
.rule-card:hover { transform: translateY(-3px); box-shadow: var(--shadow-md); }
/* 已点亮:金从灯串落到卡上——金调边 + 金色左缘刻线,「点亮=金」全页一致 */
.rule-card.solved { border-color: color-mix(in srgb, var(--gold) 30%, transparent); }
.rule-card.solved::after {
  content: ''; position: absolute; left: 0; top: 14px; bottom: 14px; width: 2px;
  border-radius: 0 2px 2px 0;
  background: linear-gradient(180deg, var(--gold), color-mix(in srgb, var(--gold) 20%, transparent));
  box-shadow: 0 0 10px color-mix(in srgb, var(--gold) 30%, transparent);
}
[data-theme='light'] .rule-card.solved::after { box-shadow: none; }
.rule-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
/* 规则名是「词」:衬线接管,与领地名同一语汇 */
.rule-title { font-family: var(--serif); font-size: var(--fs-lg); font-weight: 600; margin-bottom: 8px; line-height: 1.4; }
.rule-text { font-size: var(--fs-sm); color: var(--text-2); line-height: 1.7; }
.rule-svg {
  display: block; width: 100%; margin-top: 10px;
  background: var(--surface-sunken); border: 1px solid var(--line); border-radius: 10px;
}
.rule-examples { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 10px; }
.rule-example {
  font-family: var(--mono); font-size: var(--fs-xs); color: var(--accent); cursor: pointer;
  padding: 4px 10px; background: var(--accent-soft); border: 1px solid var(--line-accent);
  border-radius: 7px; transition: all 0.2s;
}
.rule-example:hover { background: var(--accent); color: var(--on-accent); }
.rule-quiz { margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--line); }
.rule-quiz + .rule-quiz { margin-top: 8px; }
.rule-question { font-size: var(--fs-sm); margin-bottom: 10px; }
.rule-options { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.rule-opt {
  padding: 10px 14px; border-radius: 10px; cursor: pointer; text-align: left;
  background: var(--surface); border: 1px solid var(--line);
  color: var(--text); font-family: inherit; font-size: var(--fs-sm);
  transition: all 0.2s var(--ease);
}
.rule-opt:hover:not(:disabled) { border-color: var(--line-accent); background: var(--surface-hover); }
.rule-opt.correct { background: color-mix(in srgb, var(--success) 15%, transparent); border-color: var(--success); color: var(--success); }
.rule-opt.wrong { background: color-mix(in srgb, var(--danger) 12%, transparent); border-color: var(--danger); color: var(--danger); }
.rule-feedback { margin-top: 10px; font-size: var(--fs-sm); }
.rule-feedback .ok { color: var(--success); }
.rule-feedback .no { color: var(--danger); }

/* 掌握度磁贴(大数字样式由全局 .stat-tile 提供)
   mono kicker 领一格 + CountNum 滚动大数字 + 底部迷你进度条,三条各领一色:
   听辨=accent / 拼读=紫电 / 跟读=success */
.mastery-tiles { margin-bottom: 48px; }
.mastery-tile { display: flex; flex-direction: column; }
/* 每贴一色极淡 radial 氛围 + kicker 同步提色:三块仪表各有归属,不整体提亮 */
.mastery-tile.mt-pair {
  background: radial-gradient(220px 130px at 20% 0%, color-mix(in srgb, var(--accent) 5%, transparent), transparent 70%), var(--surface);
}
.mastery-tile.mt-pair .mt-kicker { color: var(--accent); }
.mastery-tile.mt-rules {
  background: radial-gradient(220px 130px at 20% 0%, color-mix(in srgb, var(--accent-2) 5%, transparent), transparent 70%), var(--surface);
}
.mastery-tile.mt-rules .mt-kicker { color: var(--accent-2); }
.mastery-tile.mt-drill {
  background: radial-gradient(220px 130px at 20% 0%, color-mix(in srgb, var(--success) 5%, transparent), transparent 70%), var(--surface);
}
.mastery-tile.mt-drill .mt-kicker { color: var(--success); }
.mt-kicker {
  font-family: var(--mono); font-size: var(--fs-2xs); font-weight: 600;
  letter-spacing: 0.22em; color: var(--text-3); text-transform: uppercase;
  margin-bottom: 10px;
}
.mastery-tile .num { display: flex; align-items: baseline; gap: 2px; }
.mt-unit { font-size: var(--fs-xl); font-weight: 600; color: var(--text-3); margin-left: 3px; }
.mt-slash { font-family: var(--mono); font-size: var(--fs-xl); color: var(--text-3); }
.mastery-tile .lbl { margin-top: 6px; }
.mt-bar {
  margin-top: 14px; height: 4px; border-radius: 2px;
  background: var(--surface-sunken); border: 1px solid var(--line);
  overflow: hidden;
}
.mt-bar i { display: block; height: 100%; background: var(--accent); transition: width 0.9s var(--ease); }
.mt-bar.alt i { background: var(--accent-2); }
.mt-bar.ok i { background: var(--success); }
/* 进度终点一点微光:三条各配同色亮点,像仪表指针走到头的那颗灯 */
.mt-bar i { position: relative; }
.mt-bar i::after {
  content: ''; position: absolute; right: 0; top: 0; bottom: 0; width: 2px;
  border-radius: 2px; background: var(--accent);
  box-shadow: 0 0 8px 1px color-mix(in srgb, var(--accent) 50%, transparent);
}
.mt-bar.alt i::after { background: var(--accent-2); box-shadow: 0 0 8px 1px color-mix(in srgb, var(--accent-2) 50%, transparent); }
.mt-bar.ok i::after { background: var(--success); box-shadow: 0 0 8px 1px color-mix(in srgb, var(--success) 50%, transparent); }
[data-theme='light'] .mt-bar i::after { box-shadow: none; }
/* 热力图四组:组间距统一(原 inline margin) */
.ph-heat-group { margin-bottom: 12px; }

.pairs-intro .pi-flex { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; }
.pairs-intro .pi-actions { display: flex; gap: 8px; flex-wrap: wrap; }
</style>
