<script setup>
import { ref, computed, onMounted, onUnmounted, onActivated, onDeactivated, watch } from 'vue'
import { classifyWordState } from '../utils/wordState'
import { NModal } from 'naive-ui'
import { useUniverse, SESSION_MODES } from '../stores/universe'
import { api } from '../api'
import EmptyState from '../components/EmptyState.vue'
import DailyHeatmap from '../components/DailyHeatmap.vue'
import DailyQuests from '../components/DailyQuests.vue'
import SkySketch from '../components/SkySketch.vue'
import StarTrail from '../components/StarTrail.vue'
import TodayRoute from '../components/TodayRoute.vue'
import HeroOrrery from '../components/HeroOrrery.vue'

const MODULE_NAMES = { vocab: '词汇', grammar: '语法', listening: '听力', speaking: '口语', phonetics: '发音', reading: '阅读', writing: '写作' }
// 模块小图标(内联 SVG path,stroke 用 currentColor 跟随文字色)
const MODULE_ICON_PATHS = {
  vocab: 'M12 8a4 4 0 1 0 0 8 4 4 0 1 0 0-8M3 13c3-3.5 6-5.2 9-5.2s6 1.7 9 5.2',
  grammar: 'M9 4H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h2M15 4h2a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-2',
  listening: 'M4 13v-1a8 8 0 0 1 16 0v1M4 13a2 2 0 0 1 2 2v2a2 2 0 0 1-4 0v-2a2 2 0 0 1 2-2M20 13a2 2 0 0 1 2 2v2a2 2 0 0 1-4 0v-2a2 2 0 0 1 2-2',
  speaking: 'M12 3a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3M6 11a6 6 0 0 0 12 0M12 17v4M9 21h6',
  phonetics: 'M4 10v4M8 7v10M12 4v16M16 7v10M20 10v4',
  reading: 'M12 6.5C10 4.6 7 4.6 4 5.6v12.8c3-1 6-1 8 1 2-2 5-2 8-1V5.6c-3-1-6-1-8 .9M12 6.5v13',
  writing: 'M4 19h12M4 19a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-2H4v2m14-10V5a2 2 0 0 0-2-2h-3l-2 2-2-2H8a2 2 0 0 0-2 2v3l4 4 4-4',
}
const MODULE_VIEWS = { vocab: 'galaxy', grammar: 'grammar', listening: 'listening', speaking: 'speaking', phonetics: 'phonetics', reading: 'reading', writing: 'writing' }
const MODULE_COLORS = { vocab: 'var(--accent)', grammar: 'var(--info)', listening: 'var(--info)', speaking: 'var(--accent-2)', phonetics: 'var(--warn)', reading: 'var(--success)', writing: 'var(--accent-3)' }

const store = useUniverse()
// 新号判定:还没学过任何词时,隐藏全零图表区(星系分布/模块正确率/增长曲线/强度分布/练习量/最弱词根),
// 让今日任务、推荐入口、书单上移到首屏——新用户不该先吃一墙零数据的劝退
const hasLearned = computed(() => (store.stats?.learned ?? 0) > 0)

// ---- 新手首课推荐:不强制 —— 想学再点;学过 5 词或点过"先自己逛逛"就不再打扰 ----
const firstLessonDone = computed(() => (store.stats?.learned ?? 0) >= 5)
const firstLessonDismissed = ref(localStorage.getItem('wv_firstlesson_dismissed') === '1')
function dismissFirstLesson() {
  firstLessonDismissed.value = true
  try { localStorage.setItem('wv_firstlesson_dismissed', '1') } catch {}
}
const showFirstLesson = computed(() =>
  store.user && store.stats && !firstLessonDone.value && !firstLessonDismissed.value)

// ---- 学习模式(§11/§12):三条航线一键启程,减少选择;推荐档按时段/进度/星期定 ----
// 学习方式的门槛不在功能多,在"第一步做什么"——hero 一键就是答案
const recommendedMode = computed(() => {
  const h = new Date().getHours()
  if (h >= 22 || h < 6) return 'cruise' // 深夜只给最小剂量,别硬撑
  const learned = store.stats?.learned ?? 0
  if (learned >= 60 && [0, 6].includes(new Date().getDay())) return 'expedition' // 周末有余裕走深度
  return 'route'
})
const modeList = computed(() => Object.entries(SESSION_MODES).map(([key, m]) => ({ key, ...m })))
// hero 主按钮:航线进行中=回航线;否则=按推荐档一键启程
const heroCTA = computed(() => store.session
  ? { label: '回到航线 →', go: () => store.sessionGo(store.session.step) }
  : { label: '开始今天的学习 →', go: () => store.startSession(recommendedMode.value) })
// 三条航线的仪器小标(天文仪器语言:彗星短弧 / 三站轨道 / 深空瞄准)
const MODE_GLYPHS = {
  cruise: 'M9 33a14 14 0 0 1 26-11M23 32l9-13M32 19m-1.5 0a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0',
  route: 'M8 25a14 14 0 0 1 28 0M6 31h32M12 31m-1.7 0a1.7 1.7 0 1 0 3.4 0a1.7 1.7 0 1 0-3.4 0M22 31m-1.7 0a1.7 1.7 0 1 0 3.4 0a1.7 1.7 0 1 0-3.4 0M32 31m-1.7 0a1.7 1.7 0 1 0 3.4 0a1.7 1.7 0 1 0-3.4 0',
  expedition: 'M22 14a8 8 0 0 1 8 8a8 8 0 0 1-8 8a8 8 0 0 1-8-8a8 8 0 0 1 8-8M22 8v4M22 32v4M8 22h4M32 22h4M22 22m-1 0a1 1 0 1 0 2 0a1 1 0 1 0-2 0',
}
// 提示卡仪器小标(天文仪器语言,替代 emoji):刻度环钟面 / 增长折线+节点 / 断环回升 / 四芒星 / 断环暗星 / 轨道环+内星
const INSIGHT_GLYPHS = {
  due: 'M12 12m-8 0a8 8 0 1 0 16 0a8 8 0 1 0-16 0M12 12V7.4M12 12l3.4 2',
  streak: 'M4.5 17.5l4.4-5.2 3.4 2.5 4.2-5.3M4.5 17.5m-1.3 0a1.3 1.3 0 1 0 2.6 0a1.3 1.3 0 1 0-2.6 0M16.5 9.5m-1.3 0a1.3 1.3 0 1 0 2.6 0a1.3 1.3 0 1 0-2.6 0',
  'streak-back': 'M15.8 5.4A8 8 0 1 0 19.6 14M13 11.6l4.6-5.8M17.6 5.8V10M17.6 5.8H13.6',
  milestone: 'M12 3.6l2 6.4 6.4 2-6.4 2-2 6.4-2-6.4L3.6 12l6.4-2z',
  'review-now': 'M15.6 5.3A8 8 0 1 0 19.7 12.2M12 12m-1.6 0a1.6 1.6 0 1 0 3.2 0a1.6 1.6 0 1 0-3.2 0',
  'new-user': 'M12 12m-2.2 0a2.2 2.2 0 1 0 4.4 0a2.2 2.2 0 1 0-4.4 0M12 12m-8.5 0a8.5 8.5 0 1 0 17 0a8.5 8.5 0 1 0-17 0M20.5 7.2l1.5-1.5M3.5 7.2L2 5.7',
}
// Phase 3:全年活跃度热力图(默认 365 天,失败静默保留空网格)
const yearActivity = ref([])
async function loadYearActivity() {
  if (!store.user) return
  try {
    const r = await api.activity(store.user.id, 365)
    yearActivity.value = r.daily || []
  } catch { /* 后端不可用:保持空网格 */ }
}
// KeepAlive:每次回观星台刷新数据(挂载一次+每次激活都触发)
onActivated(() => {
  store.refreshStats()
  loadActivity()
  loadRecommend()
  loadYearActivity()
  store.loadPlan() // 今日航线(失败降级,不阻塞页面)
})

// 问候:universe 的个性化问候(带用户名) + 按真实数据拼的口语摘要
const GOAL_PHRASES = { exam: '为考试准备的这阵子', study: '为留学做准备的这阵子', work: '为了工作用英语的这阵子', interest: '凭兴趣学的这阵子' }
const goalPhrase = computed(() => (store.goalLabel ? GOAL_PHRASES[store.profile.goal] ?? null : null))

// 从 stats 里取真实数字拼一句摘要(不硬编码)
function summarizeStats(s) {
  const act = s.daily_activity || []
  const today = act.length ? act[act.length - 1] : null
  const yesterday = act.length >= 2 ? act[act.length - 2] : null
  const todayCount = today ? today.reviews + today.new_words : 0
  const ystCount = yesterday ? yesterday.reviews + yesterday.new_words : 0
  const parts = []
  if (ystCount > 0) parts.push(`昨天做了 ${ystCount} 道题`)
  else if (todayCount > 0) parts.push(`今天已经做了 ${todayCount} 道题`)
  const weak = (s.weakest_roots || [])[0]
  if (weak && weak.accuracy < 0.55) parts.push(`${weak.root.toUpperCase()}- 家族还差一点`)
  else if ((s.mastered ?? 0) > 0) parts.push(`${s.mastered} 个词已经稳稳记住了`)
  if (!parts.length) {
    if ((s.streak_days ?? 0) >= 2) parts.push(`已经连着学 ${s.streak_days} 天`)
    else if ((s.learned ?? 0) > 0) parts.push(`点亮了 ${s.learned} 个词，接着来`)
    else return '先随便做几道题，这里就会慢慢有你的学习画像'
  }
  return parts.join('，') + '。'
}
const subtitleText = computed(() => {
  const s = store.stats
  const body = s ? summarizeStats(s) : '先随便做几道题，这里就会慢慢有你的学习画像'
  return goalPhrase.value ? `${goalPhrase.value}，${body}` : body
})

// 数字滚动动画
function useCountUp(target, dur = 800) {
  const val = ref(0)
  let raf = 0, start = 0, from = 0, to = 0
  const tween = (ts) => {
    if (!start) start = ts
    const p = Math.min((ts - start) / dur, 1)
    const eased = 1 - Math.pow(1 - p, 3)
    val.value = Math.round(from + (to - from) * eased)
    if (p < 1) raf = requestAnimationFrame(tween)
  }
  const update = (newTo) => {
    cancelAnimationFrame(raf)
    from = val.value; to = newTo; start = 0
    raf = requestAnimationFrame(tween)
  }
  onUnmounted(() => cancelAnimationFrame(raf))
  return { val, update }
}

const learnedNum = useCountUp(0)
const masteredPct = useCountUp(0)
const streakNum = useCountUp(0)
const dueNum = useCountUp(0)
// 点亮百分比:learnedNum.val 是嵌套 ref,直接在模板里做算术拿到的是 RefImpl 对象(对象/数字=NaN),
// 必须在脚本里 .value 解包后放进 computed
const learnedPct = computed(() => Math.round((learnedNum.val.value / Math.max(1, store.words.length)) * 100))
watch(() => store.stats, (s) => {
  if (!s) return
  learnedNum.update(s.learned ?? 0)
  masteredPct.update(Math.round(((s.mastered ?? 0) / Math.max(1, s.learned ?? 1)) * 100))
  streakNum.update(s.streak_days ?? 0)
  dueNum.update(s.due_today ?? 0)
}, { immediate: true, deep: true })

// ---- 活动元素:实时时钟 / 英雄区鼠标视差 / 滚动逐屏显现 ----
// 实时时钟:让页面"活着"(每秒走字,而不是渲染完就死掉)
const now = ref(new Date())
let clockTimer = null
const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
const clockText = computed(() => {
  const d = now.value
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}月${d.getDate()}日 ${WEEKDAYS[d.getDay()]} · ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
})

// 英雄区轨道图随鼠标轻视差(±14px,不抢内容)
const heroEl = ref(null)
function onHeroMove(e) {
  const el = heroEl.value
  if (!el) return
  const r = el.getBoundingClientRect()
  el.style.setProperty('--par-x', `${((e.clientX - r.left) / r.width - 0.5) * 14}px`)
  el.style.setProperty('--par-y', `${((e.clientY - r.top) / r.height - 0.5) * 10}px`)
}
function onHeroLeave() {
  heroEl.value?.style.setProperty('--par-x', '0px')
  heroEl.value?.style.setProperty('--par-y', '0px')
}

// 滚动显现:卡片进视口时上浮淡入,把"整页文档"变成逐屏展开(无 IO 环境直接显示)
const vReveal = {
  mounted(el) {
    if (!('IntersectionObserver' in window)) return
    el.classList.add('reveal-init')
    const io = new IntersectionObserver((entries) => {
      if (entries.some((en) => en.isIntersecting)) {
        el.classList.add('revealed')
        io.disconnect()
      }
    }, { rootMargin: '0px 0px -40px 0px' })
    io.observe(el)
  },
}

// 时钟只在观星台可见时走(KeepAlive 首挂同样触发 onActivated):
// 切走后 1s interval 仍每秒更新 now → 后台重渲染整页,纯白烧
onActivated(() => { if (!clockTimer) clockTimer = setInterval(() => { now.value = new Date() }, 1000) })
onDeactivated(() => { clearInterval(clockTimer); clockTimer = null })
onUnmounted(() => clearInterval(clockTimer))

// 星系状态分布(五态分类走统一 util wordState.js)
const dist = computed(() => {
  const d = { new: 0, critical: 0, due: 0, learning: 0, mastered: 0 }
  const stateList = Object.values(store.states)
  for (const s of stateList) d[classifyWordState(s)]++
  // 未学数按"词库总数 - 有学习记录的词"算(无 state 的词也算未学)
  d.new = Math.max(0, (store.words.length || 0) - stateList.filter((s) => !s.is_new).length)
  return d
})
const total = computed(() => store.words.length || 1)
const distRows = computed(() => [
  { label: '掌握稳固', n: dist.value.mastered, cls: 'green' },
  { label: '学习中', n: dist.value.learning, cls: 'cool' },
  { label: '待复习', n: dist.value.due, cls: 'amber' },
  { label: '记忆告急', n: dist.value.critical, cls: 'red' },
  { label: '未探索', n: dist.value.new, cls: '' },
])

// 模块正确率
const accRows = computed(() =>
  Object.entries(store.stats?.accuracy_by_module || {})
    .map(([k, v]) => ({ key: k, name: MODULE_NAMES[k] || k, value: v }))
    .sort((a, b) => b.value - a.value),
)

// 活跃度折线图:7/14/30 天 tab 切换(rangeActivity 独立拉取,store.stats 仍是默认画像)
const activity = computed(() => store.stats?.daily_activity || [])
const chartDays = ref(14)
const rangeActivity = ref([])
async function loadActivity() {
  rangeActivity.value = store.stats?.daily_activity || [] // 请求期间先用现有数据兜底
  if (!store.user) return
  try {
    const s = await api.stats(store.user.id, chartDays.value)
    rangeActivity.value = s.daily_activity || []
  } catch { /* 后端不可用:降级保留 store.stats 的默认数据 */ }
}
watch(chartDays, () => loadActivity())
// store.stats 到货而独立请求失败过(空)时补位
watch(() => store.stats, (s) => {
  if (!rangeActivity.value.length && s?.daily_activity?.length) rangeActivity.value = s.daily_activity
})

const chartGeom = computed(() => {
  const data = rangeActivity.value
  if (!data.length) return null
  const W = 800, H = 200, padL = 36, padR = 12, padT = 16, padB = 28
  const innerW = W - padL - padR
  const innerH = H - padT - padB
  const vals = data.map((d) => d.reviews + d.new_words)
  const maxV = Math.max(...vals, 1)
  const xs = data.map((_, i) => padL + (i / Math.max(1, data.length - 1)) * innerW)
  const yOf = (v) => padT + (1 - v / maxV) * innerH
  const ys = vals.map(yOf)
  // 折线 path
  const linePath = xs.map((x, i) => (i === 0 ? `M ${x} ${ys[i]}` : `L ${x} ${ys[i]}`)).join(' ')
  // 面积 path
  const areaPath = `${linePath} L ${xs[xs.length - 1]} ${padT + innerH} L ${xs[0]} ${padT + innerH} Z`
  // 柱状 path
  const barW = Math.max(2, innerW / data.length - 4)
  const bars = data.map((d, i) => {
    const h = ((d.reviews + d.new_words) / maxV) * innerH
    return { x: xs[i] - barW / 2, y: padT + innerH - h, w: barW, h, v: d.reviews + d.new_words, date: d.date }
  })
  const gridYs = [0, 0.25, 0.5, 0.75, 1].map((p) => padT + (1 - p) * innerH)
  // 最小二乘趋势线(整段只画首尾两点)
  const n = vals.length
  const meanX = (n - 1) / 2
  const meanY = vals.reduce((a, v) => a + v, 0) / n
  let num = 0, den = 0
  vals.forEach((v, i) => { num += (i - meanX) * (v - meanY); den += (i - meanX) * (i - meanX) })
  const slope = den ? num / den : 0
  const trendPath = `M ${xs[0]} ${yOf(meanY - slope * meanX)} L ${xs[n - 1]} ${yOf(meanY + slope * (n - 1 - meanX))}`
  // 移动平均参考虚线(窗口随区间缩放:>=14 天用 7 日均线,7 天用 3 日;首部不足一个窗口不画)
  const maWin = n >= 14 ? 7 : 3
  const maPts = []
  for (let i = maWin - 1; i < n; i++) {
    let s = 0
    for (let j = i - maWin + 1; j <= i; j++) s += vals[j]
    maPts.push([xs[i], yOf(s / maWin)])
  }
  const maPath = maPts.length >= 2 ? maPts.map(([x, y], i) => (i === 0 ? `M ${x} ${y}` : `L ${x} ${y}`)).join(' ') : ''
  return { W, H, padL, padR, padT, padB, linePath, areaPath, xs, ys, bars, gridYs, maxV, trendPath, maPath, maWin }
})

// hover 图表柱
const hoverIdx = ref(-1)
const hoverPoint = computed(() => hoverIdx.value >= 0 ? rangeActivity.value[hoverIdx.value] : null)

// ===== 词汇量增长曲线几何(复用 chartDays 切换窗口) =====
const vocabGrowthGeom = computed(() => {
  const data = store.stats?.vocab_growth
  if (!data?.length) return null
  if (!data.some((d) => d.total > 0)) return null // 全为 0 时不画
  const W = 800, H = 200, padL = 44, padR = 16, padT = 14, padB = 26
  const innerW = W - padL - padR
  const innerH = H - padT - padB
  const vals = data.map((d) => d.total)
  const maxV = Math.max(...vals, 1)
  const minV = Math.min(...vals)
  const xs = data.map((_, i) => padL + (i / Math.max(1, data.length - 1)) * innerW)
  const yOf = (v) => padT + (1 - (v - minV) / Math.max(1, maxV - minV)) * innerH
  const ys = vals.map(yOf)
  const linePath = xs.map((x, i) => (i === 0 ? `M ${x} ${ys[i]}` : `L ${x} ${ys[i]}`)).join(' ')
  const areaPath = `${linePath} L ${xs[xs.length - 1]} ${padT + innerH} L ${xs[0]} ${padT + innerH} Z`
  const dots = xs.map((x, i) => ({ x, y: ys[i] }))
  // 网格 + 日期刻度
  const gridYs = [0, 0.5, 1].map((p) => padT + (1 - p) * innerH)
  const gridLabels = [0, 0.5, 1].map((p) => Math.round(maxV - p * (maxV - minV)))
  const n = data.length
  const labelStride = Math.max(1, Math.floor(n / 6))
  const dateLabels = data
    .map((d, i) => ({ x: xs[i], label: i % labelStride === 0 || i === n - 1 ? d.date.slice(5) : '' }))
    .filter((d) => d.label)
  return { W, H, padL, padR, padT, padB, linePath, areaPath, xs, ys, dots, gridYs, gridLabels, dateLabels,
    firstVal: data[0].total, lastVal: data[n - 1].total, delta: data[n - 1].total - data[0].total }
})

// ===== 记忆强度分布(后端 5 桶) → 前端配色映射 =====
const STRENGTH_META = {
  mastered: { label: '掌握', cls: 'g', barCls: 'green', key: 'mastered' },
  good:     { label: '良好', cls: 'g', barCls: 'cool', key: 'good' },
  learning: { label: '学习中', cls: 'b', barCls: 'cool', key: 'learning' },
  weak:     { label: '偏弱', cls: 'a', barCls: 'warm', key: 'weak' },
  critical: { label: '记忆告急', cls: 'r', barCls: 'red', key: 'critical' },
}
const strengthBars = computed(() => {
  const dist = store.stats?.strength_dist || {}
  const total = store.stats?.total_words || 1
  return ['mastered', 'good', 'learning', 'weak', 'critical'].map((k) => {
    const n = dist[k] || 0
    return { ...STRENGTH_META[k], n, pct: Math.round((n / total) * 100) }
  })
})

// 活跃度图旁的一句自然点评:对比最近两天的真实答题量,没数据就不硬凑
const activityNote = computed(() => {
  const a = rangeActivity.value
  if (a.length < 2) return ''
  const cur = a[a.length - 1], prev = a[a.length - 2]
  const c = cur.reviews + cur.new_words
  const p = prev.reviews + prev.new_words
  if (c === 0 && p === 0) return ''
  if (c > p) return `比昨天多答了 ${c - p} 题`
  if (c < p) return p - c <= 3 ? '比昨天少了些，今天补上？' : `比昨天少了 ${p - c} 题，今天补上？`
  return '和昨天的量差不多，稳住这个节奏'
})

// 最弱词根(顶部 3 张卡)
const weakRoots = computed(() => (store.stats?.weakest_roots || []).slice(0, 3))

// 错题家族分布柱状图:后端最多回 8 个(按正确率升序 = 薄弱度降序)
const weakRootBars = computed(() => (store.stats?.weakest_roots || []).slice(0, 8))
const weakBarGeom = computed(() => {
  const rows = weakRootBars.value
  if (!rows.length) return null
  const W = 460, rowH = 34, padT = 8, padB = 10, labelW = 92, valW = 46, gap = 10
  const H = padT + padB + rows.length * rowH
  const barMaxW = W - labelW - valW - gap * 2
  const maxWeak = Math.max(...rows.map((r) => 1 - r.accuracy), 0.001)
  const bars = rows.map((r, i) => ({
    root: r.root, meaning: r.meaning, word_count: r.word_count, accuracy: r.accuracy,
    y: padT + i * rowH + 5,
    h: rowH - 12,
    w: Math.max(8, ((1 - r.accuracy) / maxWeak) * barMaxW),
    x: labelW + gap,
    accPct: Math.round(r.accuracy * 100),
    danger: r.accuracy < 0.4,
  }))
  return { W, H, labelW, valW, gap, bars }
})

// 今日策略 tip:优先后端智能推荐(最弱模块画像),失败降级到固定循环
const recTip = ref(null)
const recReason = ref('')
const recExtras = ref({ due_week: 0, critical_count: 0, weakest_roots: [] })
async function loadRecommend() {
  if (!store.user) return
  try {
    const r = await api.recommend(store.user.id)
    if (r?.tip) {
      recTip.value = r.tip; recReason.value = r.reason || ''
      recExtras.value = { due_week: r.due_week || 0, critical_count: r.critical_count || 0, weakest_roots: r.weakest_roots || [] }
    }
  } catch { /* 无后端 / 接口不可用:走下方固定循环逻辑 */ }
}
const fallbackTip = computed(() => {
  if (!store.tips.length) return null
  const t = store.tips.filter((x) => x.category === '学习方法')
  return t[Math.floor((new Date().getDate()) % t.length)]
})
const todayTip = computed(() => recTip.value || fallbackTip.value)
const todayTipReason = computed(() => (recTip.value ? recReason.value : ''))

// ===== 周报:从现有 stats 拼装本周小结 + Canvas 自绘 PNG =====
const reportOpen = ref(false)
const weekSummary = computed(() => {
  const s = store.stats
  const week = (s?.daily_activity || []).slice(-7)
  const weakTop3 = (s?.weakest_roots || []).slice(0, 3)
  return {
    streak: s?.streak_days ?? 0,
    mastered: s?.mastered ?? 0,
    learned: s?.learned ?? 0,
    newWords: week.reduce((a, d) => a + d.new_words, 0),
    reviews: week.reduce((a, d) => a + d.reviews, 0),
    activeDays: week.filter((d) => d.reviews + d.new_words > 0).length,
    weakTop3,
    dateRange: week.length ? `${week[0].date} ~ ${week[week.length - 1].date}` : '',
  }
})

function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

function downloadWeeklyReport() {
  const W = 900, H = 1250
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  const s = weekSummary.value
  const FONT = '"Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif'

  // 宣纸底 + 顶部海军蓝品牌光晕(固定品牌样式,不随当前主题漂移,分享图确定性)
  const bg = ctx.createLinearGradient(0, 0, 0, H)
  bg.addColorStop(0, '#F7F5F0')
  bg.addColorStop(1, '#FFFFFF')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, W, H)
  const halo = ctx.createRadialGradient(W / 2, 40, 20, W / 2, 40, 540)
  halo.addColorStop(0, 'rgba(61,90,133,0.12)')
  halo.addColorStop(1, 'rgba(61,90,133,0)')
  ctx.fillStyle = halo
  ctx.fillRect(0, 0, W, 420)

  // 品牌渐变标题:海军蓝 → 深香槟金(与站内 --grad-text 同语言)
  const tg = ctx.createLinearGradient(120, 0, W - 120, 0)
  tg.addColorStop(0, '#3D5A85')
  tg.addColorStop(1, '#8F6B2A')
  ctx.textAlign = 'center'
  ctx.fillStyle = tg
  ctx.font = `700 46px ${FONT}`
  ctx.fillText('词峰 WORDPEAK · 这一周你练得怎么样', W / 2, 112)
  ctx.fillStyle = '#56657C'
  ctx.font = `15px ${FONT}`
  ctx.fillText(`${store.user?.username || '探索者'} · ${s.dateRange}`, W / 2, 148)

  // 2×2 数字块
  const tiles = [
    { label: '连着学了', v: String(s.streak), unit: ' 天' },
    { label: '掌握的词', v: String(s.mastered), unit: ` / ${s.learned}` },
    { label: '这周新学', v: String(s.newWords), unit: ' 词' },
    { label: '这周出勤', v: String(s.activeDays), unit: ' / 7' },
  ]
  const gx = 64, gy = 196, gw = W - 128, th = 148, gap = 24
  const tileW = gw / 2 - gap / 2
  tiles.forEach((t, i) => {
    const x = gx + (i % 2) * (tileW + gap)
    const y = gy + Math.floor(i / 2) * (th + gap)
    // 白卡浮在淡天蓝底上,配蓝灰细描边
    ctx.fillStyle = '#FFFFFF'
    roundRectPath(ctx, x, y, tileW, th, 18)
    ctx.fill()
    ctx.strokeStyle = 'rgba(15,23,42,0.08)'
    ctx.lineWidth = 1
    ctx.stroke()
    ctx.fillStyle = '#64748B'
    ctx.font = `16px ${FONT}`
    ctx.fillText(t.label, x + tileW / 2, y + 44)
    ctx.fillStyle = '#0F172A'
    ctx.font = `700 52px ${FONT}`
    ctx.fillText(t.v + t.unit, x + tileW / 2, y + 112)
  })

  // 薄弱家族 top3(柱长 = 薄弱度)
  const wy = gy + 2 * (th + gap) + 64
  ctx.textAlign = 'left'
  ctx.fillStyle = '#0F172A'
  ctx.font = `700 26px ${FONT}`
  ctx.fillText('这周最该补的词根家族', gx, wy)
  ctx.font = `15px ${FONT}`
  ctx.fillStyle = '#64748B'
  ctx.fillText(`这周共复习了 ${s.reviews} 次 · 按正确率排的`, gx, wy + 30)
  if (s.weakTop3.length) {
    s.weakTop3.forEach((r, i) => {
      const ry = wy + 78 + i * 78
      ctx.fillStyle = '#0F172A'
      ctx.font = `700 22px ${FONT}`
      ctx.fillText(`${r.root.toUpperCase()}-  ${r.meaning}`, gx, ry)
      ctx.fillStyle = '#475569'
      ctx.font = `15px ${FONT}`
      ctx.fillText(`${r.word_count} 词`, gx, ry + 26)
      ctx.textAlign = 'right'
      ctx.fillStyle = r.accuracy < 0.4 ? '#DC2626' : '#B45309'
      ctx.font = `700 22px ${FONT}`
      ctx.fillText(`${Math.round(r.accuracy * 100)}%`, W - gx, ry)
      ctx.textAlign = 'left'
      const bw = W - 2 * gx, by = ry + 12
      ctx.fillStyle = 'rgba(15,23,42,0.08)'
      roundRectPath(ctx, gx, by, bw, 10, 5)
      ctx.fill()
      const grad = ctx.createLinearGradient(gx, 0, gx + bw, 0)
      grad.addColorStop(0, '#B45309')
      grad.addColorStop(1, '#DC2626')
      ctx.fillStyle = grad
      roundRectPath(ctx, gx, by, Math.max(10, (1 - r.accuracy) * bw), 10, 5)
      ctx.fill()
    })
  } else {
    ctx.fillStyle = '#475569'
    ctx.font = `16px ${FONT}`
    ctx.fillText('这周还没碰过词根题，去词汇圣殿点几颗星吧', gx, wy + 78)
  }

  // 页脚
  ctx.textAlign = 'center'
  ctx.fillStyle = '#64748B'
  ctx.font = `14px ${FONT}`
  ctx.fillText('每类选一本主力 · 每天雷打不动一小时 · 贪多必弃', W / 2, H - 96)
  ctx.fillText(`生成于 ${new Date().toLocaleString('zh-CN')} · 词峰 WORDPEAK`, W / 2, H - 68)

  // data URL 直接下载(不引外部库)
  const a = document.createElement('a')
  a.href = canvas.toDataURL('image/png')
  a.download = `wordpeak-周报-${new Date().toLocaleDateString('sv')}.png`
  a.click()
}

// 推荐模块入口(按最弱/活跃度)
const recommended = computed(() => {
  const out = []
  const acc = store.stats?.accuracy_by_module || {}
  // 优先最弱模块
  const sorted = Object.entries(acc).sort((a, b) => a[1] - b[1])
  for (const [k, v] of sorted) {
    if (!MODULE_VIEWS[k]) continue // 未知模块 key(导入旧数据/后端新增)不进推荐卡,避免 undefined 名称和跳空白
    out.push({ key: k, name: MODULE_NAMES[k] + '模块', value: v })
    if (out.length >= 3) break
  }
  // 不足补上没去过的
  for (const k of ['phonetics', 'reading', 'speaking']) {
    if (out.length >= 3) break
    if (!out.find((x) => x.key === k)) out.push({ key: k, name: MODULE_NAMES[k] + '模块', value: acc[k] ?? 0 })
  }
  return out.slice(0, 3)
})

// 书架推荐
const bookRail = computed(() => (store.books || []).slice(0, 8))

// ---- 智能提示卡:基于 stats 状态推上下文相关的快捷入口(全部空数组会跳过) ----
// (掌握里程碑已迁入星轨 StarTrail 常驻展示,这里不再重复弹里程碑卡)
const insights = computed(() => {
  const s = store.stats
  if (!s) return []
  const out = []
  // 1) 今天到期词 → 立刻复习快捷
  if ((s.due_today ?? 0) > 0) {
    out.push({
      key: 'due',
      tone: 'warm',
      title: `今天有 ${s.due_today} 个词到期复习`,
      body: '到点的词越早复盘,遗忘曲线越平缓。点这一下直接开始。',
      cta: { label: '开始复习', view: 'galaxy', action: 'review' },
    })
  }
  // 2) 连胜 ≥ 7 → 庆祝卡
  const streak = s.streak_days ?? 0
  if (streak >= 7) {
    out.push({
      key: 'streak',
      tone: 'success',
      title: `连续学习 ${streak} 天,手感稳了`,
      body: '保持节律比冲量更重要 — 哪怕每天 10 题,这条曲线就不会断。',
      cta: null,
    })
  } else if (streak === 0 && (s.learned ?? 0) > 0) {
    out.push({
      key: 'streak-back',
      tone: 'accent',
      title: '昨天的连胜断了,今天接上',
      body: '重新点一颗星球开 5 分钟,连胜就复活了。',
      cta: { label: '随便选一颗', view: 'galaxy' },
    })
  }
  // 3) 掌握里程碑已由「星轨」常驻展示(见 sky-trail-duo),此处不再重复
  // 4) 词库大量快忘了 → 复习提醒(后端画像增强的"重检"信号)
  if (recExtras.value.critical_count >= 5) {
    out.push({
      key: 'review-now',
      tone: 'warn',
      title: `有 ${recExtras.value.critical_count} 个词快忘了,还有 ${recExtras.value.due_week} 个一周内到期`,
      body: '现在做 10 分钟复习比学新词的性价比高得多 — 这批词本来你已经认识,只是不复习会逐渐忘掉。',
      cta: { label: '立刻去复习', view: 'galaxy', action: 'review' },
    })
  }
  // 5) 观星台为空(新账号)→ 引导开练
  if ((s.learned ?? 0) === 0) {
    out.push({
      key: 'new-user',
      tone: 'accent',
      title: '你的星系还是空的',
      body: '点开词汇圣殿,随便选一颗星球开始 — 第一颗亮起来之后,这里就有你的画像了。',
      cta: { label: '进入词汇圣殿', view: 'galaxy' },
    })
  }
  return out.slice(0, 3) // 最多 3 张,避免挤占
})
function clickInsight(ins) {
  if (ins.cta?.view) {
    if (ins.cta.action === 'review') store.openReview()
    else if (ins.cta.view === 'galaxy') store.setView('galaxy')
    else store.setView(ins.cta.view)
  }
}
</script>

<template>
  <div class="view-scroll">
    <div class="view-inner">

      <!-- ===== 顶部问候:星图读数英雄区(衬线标题+刻线,轨道图视差,入场级联) ===== -->
      <div ref="heroEl" class="dash-greeting" @pointermove="onHeroMove" @pointerleave="onHeroLeave">
        <!-- 天窗星尘:点阵渐隐层垫在最底,「从塔顶望出去」的取景纹理(内容列自带 z-index 不会被压) -->
        <span class="dots-decor dots-fade" aria-hidden="true" style="--dots-o: 0.38" />
        <!-- 实时天体仪(Three.js):行星 + 尘埃环 + 卫星;旧静态 SVG 的星图语言保留在引擎里 -->
        <HeroOrrery class="dash-hero-art" />
        <div class="dash-hello-col">
          <div class="hi">{{ store.greeting }}</div>
          <!-- 逐字 blur 入场接管标题(heroRise 在 scoped 里置 none,避免双重动画) -->
          <BlurText as="h1" text="你的学习宇宙档案" />
          <div class="dash-rule" aria-hidden="true" />
          <p>{{ subtitleText }}</p>
        </div>
        <div class="dash-greet-actions">
          <div class="dash-clock text-mono"><i class="dash-clock-dot" aria-hidden="true" />{{ clockText }}</div>
          <button class="btn primary" @click="heroCTA.go">{{ heroCTA.label }}</button>
          <button class="btn" @click="store.setView('galaxy')">进入词汇圣殿</button>
          <button class="btn ghost" @click="reportOpen = true">这一周你练得怎么样</button>
          <div class="dash-streak">
            <span class="dot" />
            <b>{{ streakNum.val }}</b>
            <span class="text-3" style="font-size: var(--fs-sm)">天连续</span>
          </div>
        </div>
      </div>

      <!-- ===== 今日航线(档案驱动的当日计划,星轨三节点) ===== -->
      <TodayRoute v-reveal />

      <!-- ===== 学习模式:三条航线一键启程(§11/§12 减少选择,HUD 一站一站带) ===== -->
      <div class="modes-card card" v-reveal>
        <div class="modes-head">
          <div class="modes-title-col">
            <div class="modes-kick">LEARNING ROUTES</div>
            <div class="modes-title">今天想学多久</div>
          </div>
          <div class="modes-hint">启程后航线 HUD 会一站一站带你走</div>
        </div>
        <div class="modes-list">
          <div
            v-for="m in modeList" :key="m.key"
            class="mode-row" :class="{ rec: m.key === recommendedMode }"
          >
            <svg class="mode-glyph" viewBox="0 0 44 44" aria-hidden="true">
              <path :d="MODE_GLYPHS[m.key]" />
            </svg>
            <div class="mode-main">
              <div class="mode-name">
                {{ m.zh }}<span class="mode-latin">{{ m.latin }} · {{ m.minutes }} MIN</span>
              </div>
              <p class="mode-desc">{{ m.desc }}</p>
              <div class="mode-stops">
                <span v-for="(s, i) in m.stops" :key="s" class="mode-stop">
                  <i>{{ i + 1 }}</i>{{ s }}
                </span>
              </div>
            </div>
            <button
              class="btn" :class="{ primary: m.key === recommendedMode }"
              @click="store.startSession(m.key)"
            >{{ m.key === recommendedMode ? '今日推荐 · 启程 →' : '启程 →' }}</button>
          </div>
        </div>
      </div>

      <!-- ===== 你的天空 × 星轨(观星台的成对证据:天上词星是词,地上 7 站是坚持) ===== -->
      <div class="sky-trail-duo" v-reveal>
        <div class="sky-card card">
          <div class="sky-head">
            <div class="sky-title-col">
              <div class="sky-kick">YOUR SKY</div>
              <div class="sky-title">你的天空</div>
            </div>
            <div class="text-mono sky-count">LIT {{ learnedNum.val }} / {{ store.words.length }} · 点一颗亮星，回圣殿看它</div>
          </div>
          <SkySketch />
        </div>
        <div class="trail-card card">
          <StarTrail />
        </div>
      </div>

      <!-- ===== 新手首课推荐(自愿,不强制):3D 房间学 hydro 家族 5 词 ===== -->
      <div v-if="showFirstLesson" class="first-lesson card">
        <div class="fl-tag">新手推荐 · 5 分钟</div>
        <div class="fl-body">
          <div class="fl-title">首课:点亮 hydro 词根家族的 5 颗星球</div>
          <p class="fl-desc">
            3D 小房间里点 5 个发光球 —— hydrate / hydrogen / hydraulic…… 顺便告诉我们你学英语的目标,主页的推荐会照着它来。随时可以关,不强制。
          </p>
          <div class="fl-actions">
            <button class="btn primary" @click="store.openOnboarding()">开始首课 →</button>
            <button class="btn ghost" @click="dismissFirstLesson">先自己逛逛</button>
          </div>
        </div>
      </div>

      <!-- ===== 智能提示卡(stats 上下文快捷入口) ===== -->
      <div v-if="store.stats && insights.length" class="insight-row stagger">
        <div v-for="ins in insights" :key="ins.key" class="insight-card" :class="`tone-${ins.tone}`">
          <span class="insight-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24"><path :d="INSIGHT_GLYPHS[ins.key] || INSIGHT_GLYPHS.due" /></svg>
          </span>
          <div class="insight-body">
            <div class="insight-title">{{ ins.title }}</div>
            <div class="insight-text">{{ ins.body }}</div>
          </div>
          <button v-if="ins.cta" class="btn small primary" @click="clickInsight(ins)">{{ ins.cta.label }} →</button>
        </div>
      </div>

      <!-- ===== 数据加载中:三大数字 tile / 双栏卡片骨架 ===== -->
      <div v-if="!store.stats" class="sk-zone">
        <div class="mega-tiles">
          <div v-for="i in 3" :key="i" class="mega-tile">
            <div class="skeleton sk-line" :style="{ width: '34%' }" />
            <div class="skeleton sk-num" />
            <div class="skeleton sk-line" :style="{ width: '72%' }" />
          </div>
        </div>
        <div class="dash-grid">
          <div class="card">
            <div class="skeleton sk-line" :style="{ width: '44%', height: '18px' }" />
            <div v-for="i in 5" :key="i" class="skeleton sk-line" :style="{ width: `${92 - i * 6}%`, marginTop: '18px' }" />
          </div>
          <div class="card">
            <div class="skeleton sk-line" :style="{ width: '44%', height: '18px' }" />
            <div v-for="i in 4" :key="i" class="skeleton sk-line" :style="{ width: `${88 - i * 6}%`, marginTop: '18px' }" />
            <div class="skeleton sk-line" :style="{ width: '100%', marginTop: '18px' }" />
          </div>
        </div>
        <div class="card">
          <div class="skeleton sk-line" :style="{ width: '30%', height: '18px' }" />
          <div class="skeleton sk-chart" />
        </div>
      </div>

      <!-- ===== 三大数字 tile(三色磁贴) ===== -->
      <div v-if="store.stats" class="mega-tiles stagger">
        <div class="mega-tile accent" @click="store.setView('galaxy')">
          <div class="mega-tile-badge" aria-hidden="true">
            <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="5.2" /><ellipse cx="12" cy="12" rx="10.5" ry="4" transform="rotate(-18 12 12)" /></svg>
          </div>
          <div class="mega-tile-label">你已经点亮</div>
          <div class="mega-tile-num-row">
            <CountNum :v="store.stats?.learned ?? 0" mono class="mega-tile-num" /><span class="mega-tile-unit">/ {{ store.words.length }}</span>
          </div>
          <div class="mega-tile-sub text-3">词汇圣殿的星球，已经亮了 {{ learnedPct }}%</div>
          <div class="mini-spark">
            <svg class="chart-svg" viewBox="0 0 200 30" preserveAspectRatio="none" height="30">
              <!-- 火花线取近 14 天切片,横纵都按切片自身(a)归一化,不随全量数据压扁 -->
              <polyline :points="activity.slice(-14).map((d, i, a) => `${(i / Math.max(1, a.length - 1)) * 200},${28 - (d.reviews + d.new_words) / Math.max(1, ...a.map(x => x.reviews + x.new_words)) * 26}`).join(' ')" fill="none" stroke="var(--accent)" stroke-width="1.5" vector-effect="non-scaling-stroke" />
            </svg>
          </div>
        </div>
        <div class="mega-tile success">
          <div class="mega-tile-badge" aria-hidden="true">
            <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="m8.5 12.2 2.4 2.4 4.6-4.8" /></svg>
          </div>
          <div class="mega-tile-label">真正记住的</div>
          <div class="mega-tile-num-row">
            <CountNum :v="Math.round(((store.stats?.mastered ?? 0) / Math.max(1, store.stats?.learned ?? 1)) * 100)" mono class="mega-tile-num" /><span class="mega-tile-unit">%</span>
          </div>
          <div class="mega-tile-sub text-3">学过的词里，{{ store.stats?.mastered ?? 0 }} 个已经稳稳掌握</div>
        </div>
        <div class="mega-tile warm" @click="store.openReview()">
          <div class="mega-tile-badge" aria-hidden="true">
            <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3.2 2" /></svg>
          </div>
          <div class="mega-tile-label">今天要复习的</div>
          <div class="mega-tile-num-row">
            <CountNum :v="store.stats?.due_today ?? 0" mono class="mega-tile-num" /><span class="mega-tile-unit">个</span>
          </div>
          <div class="mega-tile-sub text-3">{{ (store.stats?.due_today ?? 0) > 0 ? '都是快到遗忘边缘的，趁还记得过一遍' : '今天没有到期的复习，随便练点别的' }}</div>
        </div>
      </div>

      <!-- ===== 今日策略(智能推荐,无后端时降级固定循环) ===== -->
      <div v-if="todayTip" class="tip-banner">
        <div class="tip-banner-tag">今日一策 · {{ todayTipReason ? '根据你的数据挑的' : '来自学习方法' }}</div>
        <div class="tip-banner-title">{{ todayTip.title }}</div>
        <p class="tip-banner-content">{{ todayTip.content }}</p>
        <p v-if="todayTipReason" class="tip-banner-reason">为什么是这条：{{ todayTipReason }}</p>
        <div style="margin-top: 14px; display: flex; gap: 8px; flex-wrap: wrap">
          <button class="btn small primary" @click="store.openTipRecommend(todayTip)">照着这条去练 →</button>
          <button class="btn small" @click="store.setView('tips')">看{{ store.tips.length ? `全部 ${store.tips.length} 条技巧` : '全部技巧' }} →</button>
        </div>
      </div>

      <!-- ===== 星系状态 + 模块正确率(新号隐藏:全零没有信息量) ===== -->
      <div v-if="store.stats && hasLearned" class="dash-grid">
        <div class="card glow">
          <div class="card-head">
            <div class="h-section">星系状态分布</div>
            <span class="chip dim">{{ total }} 词</span>
          </div>
          <p class="card-sub">点哪一行，就回词汇圣殿看那一类</p>
          <div>
            <button v-for="row in distRows" :key="row.label" class="dist-row unstyled-btn" @click="store.setView('galaxy')">
              <div class="dist-label">{{ row.label }}</div>
              <div class="dist-bar"><div class="bar" :class="row.cls"><i :style="{ width: `${(row.n / total) * 100}%` }" /></div></div>
              <div class="dist-val">{{ row.n }}</div>
            </button>
          </div>
        </div>

        <div class="card glow">
          <div class="card-head">
            <div class="h-section">各模块正确率</div>
            <span class="chip dim">{{ accRows.length }} 模块</span>
          </div>
          <p class="card-sub">点一行，直接去那个模块练</p>
          <div>
            <button v-for="row in accRows" :key="row.key" class="acc-row unstyled-btn" @click="store.setView(MODULE_VIEWS[row.key] || 'dashboard')">
              <div class="acc-row-head">
                <div class="acc-name"><svg class="mod-icon" viewBox="0 0 24 24" style="margin-right: 6px"><path :d="MODULE_ICON_PATHS[row.key] || ''" /></svg>{{ row.name }}</div>
                <div class="acc-pct" :style="{ color: row.value > 0.7 ? 'var(--success)' : row.value > 0.5 ? 'var(--warn)' : 'var(--danger)' }">{{ Math.round(row.value * 100) }}%</div>
              </div>
              <div class="bar" :class="row.value > 0.7 ? 'green' : row.value > 0.5 ? 'warm' : 'red'">
                <i :style="{ width: `${row.value * 100}%` }" />
              </div>
            </button>
            <EmptyState
              v-if="!accRows.length" compact icon="静"
              title="还没有各模块的答题记录"
              desc="去随便哪个模块答几题，正确率就会出现在这里"
            >
              <button class="btn small primary" @click="store.setView('galaxy')">去词汇圣殿答题 →</button>
            </EmptyState>
          </div>
        </div>
      </div>

      <!-- ===== 词汇量增长曲线 + 记忆强度分布(画像增强;新号隐藏) ===== -->
      <div v-if="store.stats && hasLearned" class="dash-grid">
        <!-- 词汇量增长曲线:复用 chartDays 切换窗口 -->
        <div class="card glow">
          <div class="card-head">
            <div class="h-section">词汇量增长曲线</div>
            <span class="chip dim">当前 {{ store.stats.learned || 0 }} 词</span>
          </div>
          <p class="card-sub">每天总掌握词数(累积首次学习的单词),{{ chartDays }} 天趋势</p>
          <div v-if="vocabGrowthGeom" class="chart-wrap">
            <svg class="chart-svg" :viewBox="`0 0 ${vocabGrowthGeom.W} ${vocabGrowthGeom.H}`" preserveAspectRatio="none">
              <line v-for="y in vocabGrowthGeom.gridYs" :key="y" :x1="vocabGrowthGeom.padL" :x2="vocabGrowthGeom.W - vocabGrowthGeom.padR" :y1="y" :y2="y" class="chart-grid" />
              <defs>
                <linearGradient id="vg-grad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stop-color="var(--accent-2)" stop-opacity="0.5" />
                  <stop offset="100%" stop-color="var(--accent-2)" stop-opacity="0" />
                </linearGradient>
              </defs>
              <path :d="vocabGrowthGeom.areaPath" fill="url(#vg-grad)" />
              <path :d="vocabGrowthGeom.linePath" class="chart-line" />
              <circle v-for="(p, i) in vocabGrowthGeom.dots" :key="i" :cx="p.x" :cy="p.y" r="2" class="chart-dot" />
              <text v-for="(g, i) in vocabGrowthGeom.gridLabels" :key="'l'+i" :x="vocabGrowthGeom.padL - 6" :y="g + 4" class="chart-label" text-anchor="end">{{ g }}</text>
              <text v-for="(d, i) in vocabGrowthGeom.dateLabels" :key="'d'+i" :x="d.x" :y="vocabGrowthGeom.H - 8" class="chart-label" text-anchor="middle">{{ d.label }}</text>
            </svg>
            <div class="growth-meta">
              <span>起点 {{ vocabGrowthGeom.firstVal }} 词</span>
              <span class="meta-arr">→</span>
              <span>现在 {{ vocabGrowthGeom.lastVal }} 词</span>
              <span class="chip" :class="vocabGrowthGeom.delta > 0 ? 'green' : vocabGrowthGeom.delta < 0 ? 'red' : 'dim'">
                {{ vocabGrowthGeom.delta > 0 ? '+' : '' }}{{ vocabGrowthGeom.delta }} 词
              </span>
            </div>
          </div>
          <EmptyState v-else compact title="还没有学过词" desc="去词汇圣殿标一颗星球就开始累积" />
        </div>

        <!-- 记忆强度分布:5 档 + 待复习预警 -->
        <div class="card glow">
          <div class="card-head">
            <div class="h-section">记忆强度分布</div>
            <span class="chip dim">{{ store.stats?.total_words ?? store.words.length }} 词里</span>
          </div>
          <p class="card-sub">5 档桶 + 一周到期预警</p>
          <div class="strength-bars">
            <div v-for="b in strengthBars" :key="b.key" class="sb-row">
              <div class="sb-label">
                <span class="sb-dot" :class="b.cls" />
                {{ b.label }}
              </div>
              <div class="sb-bar"><div class="bar" :class="b.barCls"><i :style="{ width: `${b.pct}%` }" /></div></div>
              <div class="sb-val">{{ b.n }}</div>
            </div>
          </div>
          <div v-if="store.stats.due_week > 0" class="warn-banner" style="margin-top: 12px">
            未来一周将有 <b>{{ store.stats.due_week }}</b> 个词进入待复习队列,提前安排时间
          </div>
        </div>
      </div>

      <!-- ===== 全年活跃度热力图(新号整年空格子怼脸,并入 hasLearned 隐藏) ===== -->
      <div v-if="hasLearned" class="card heatmap-card">
        <div class="card-head">
          <div class="h-section">这一年的练习足迹</div>
          <span class="text-3" style="font-size: var(--fs-xs)">{{ yearActivity.length ? '鼠标悬停看日期 · 颜色 = 强度(复习+新学)' : '还没有足迹 · 做几道题，点亮第一格' }}</span>
        </div>
        <DailyHeatmap :days="yearActivity" />
      </div>

      <!-- ===== 每日任务 + 成就墙 ===== -->
      <DailyQuests v-if="store.user" />

      <!-- ===== 近 N 天练习量 + 最弱词根(新号隐藏) ===== -->
      <div v-if="store.stats && hasLearned" class="dash-grid-3">
        <div class="card">
          <div class="card-head">
            <div class="h-section">近 {{ chartDays }} 天的练习量</div>
            <div class="chart-tabs">
              <button
                v-for="d in [7, 14, 30]" :key="d"
                class="chart-tab" :class="{ active: chartDays === d }"
                @click="chartDays = d"
              >{{ d }} 日</button>
            </div>
          </div>
          <!-- 图例跟图走:无数据时不渲染,避免"只有图例没有图"的半空卡 -->
          <div v-if="chartGeom" class="chart-legend">
            <span class="legend-item"><i class="legend-line" />实际学习量</span>
            <span class="legend-item"><i class="legend-trend" />趋势线</span>
            <span class="legend-item"><i class="legend-ma" />{{ chartGeom.maWin }} 日均线</span>
          </div>
          <div class="chart-wrap" @mouseleave="hoverIdx = -1">
            <svg v-if="chartGeom" class="chart-svg" :viewBox="`0 0 ${chartGeom.W} ${chartGeom.H}`" preserveAspectRatio="none">
              <line v-for="y in chartGeom.gridYs" :key="y" :x1="chartGeom.padL" :x2="chartGeom.W - chartGeom.padR" :y1="y" :y2="y" class="chart-grid" />
              <path :d="chartGeom.areaPath" fill="url(#chart-grad)" opacity="0.3" />
              <defs>
                <linearGradient id="chart-grad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stop-color="var(--accent)" stop-opacity="0.4" />
                  <stop offset="100%" stop-color="var(--accent)" stop-opacity="0" />
                </linearGradient>
              </defs>
              <rect
                v-for="(b, i) in chartGeom.bars" :key="i"
                :x="b.x" :y="b.y" :width="b.w" :height="b.h"
                class="chart-bar" :class="{ active: hoverIdx === i }"
                :opacity="hoverIdx === -1 ? 0.3 : (hoverIdx === i ? 1 : 0.15)"
                @mouseenter="hoverIdx = i"
                style="cursor: pointer"
              />
              <path :d="chartGeom.linePath" class="chart-line" />
              <path :d="chartGeom.trendPath" class="chart-trend" />
              <path v-if="chartGeom.maPath" :d="chartGeom.maPath" class="chart-ma" />
              <circle v-for="(x, i) in chartGeom.xs" :key="i" :cx="x" :cy="chartGeom.ys[i]" r="2.5" class="chart-dot" :fill="hoverIdx === i ? 'var(--accent)' : 'var(--accent)'" />
            </svg>
            <div v-if="hoverPoint" class="chart-hover-tip" :style="{ left: `${(hoverIdx / Math.max(1, rangeActivity.length - 1)) * 100}%` }">
              <b>{{ hoverPoint.date }}</b>
              <div style="display: flex; gap: 12px; margin-top: 4px; font-size: var(--fs-xs)">
                <span>复习 <b style="color: var(--accent)">{{ hoverPoint.reviews }}</b></span>
                <span>新学 <b style="color: var(--success)">{{ hoverPoint.new_words }}</b></span>
              </div>
            </div>
          </div>
          <p v-if="activityNote" class="activity-note">{{ activityNote }}</p>
            <EmptyState
              v-if="!rangeActivity.length" compact icon="静"
              title="还没有练习记录"
              desc="做过题之后，这里会出现你的练习曲线"
            >
              <button class="btn small" @click="store.openReview()">现在就去复习 →</button>
            </EmptyState>
        </div>

        <div class="card">
          <div class="card-head">
            <div class="h-section">最弱的词根家族</div>
            <button class="btn small ghost" @click="store.backToFamilyIndex()">看全部词根 →</button>
          </div>
          <p class="card-sub">点卡片，看这个家族里都有哪些词</p>
          <div v-if="weakRoots.length" class="weak-grid stagger">
            <button
              v-for="r in weakRoots" :key="r.root"
              class="weak-card unstyled-btn" @click="store.openFamily(r.root)"
            >
              <div class="weak-card-root">{{ r.root.toUpperCase() }}-</div>
              <div class="weak-card-meaning">{{ r.meaning }}</div>
              <div class="weak-card-stat">
                <span class="text-3" style="font-size: var(--fs-xs)">{{ r.word_count }} 词</span>
                <span class="acc" :style="{ color: r.accuracy < 0.4 ? 'var(--danger)' : 'var(--warn)' }">{{ Math.round(r.accuracy * 100) }}%</span>
              </div>
            </button>
          </div>
          <EmptyState
            v-else compact icon="静"
            title="还没有词根数据"
            desc="做过词根题之后，这里会列出你最薄弱的家族"
          />

          <!-- 错题家族分布:横向柱状图,柱长 = 薄弱度(1-正确率),点击下钻家族 -->
          <div v-if="weakBarGeom" class="weak-bars">
            <div class="weak-bars-head">
              <span class="text-2" style="font-size: var(--fs-xs)">错得最多的家族</span>
              <span class="text-3" style="font-size: var(--fs-xs)">柱越长越薄弱，点一行进去练</span>
            </div>
            <svg class="weak-bar-svg" :viewBox="`0 0 ${weakBarGeom.W} ${weakBarGeom.H}`">
              <g
                v-for="b in weakBarGeom.bars" :key="b.root"
                class="weak-bar-row" @click="store.openFamily(b.root)"
              >
                <title>{{ b.meaning }} · {{ b.word_count }} 词 · 正确率 {{ b.accPct }}%</title>
                <text :x="weakBarGeom.labelW - 10" :y="b.y + b.h / 2 + 4" class="weak-bar-label">{{ b.root.toUpperCase() }}-</text>
                <rect :x="b.x" :y="b.y" :width="b.w" :height="b.h" rx="4" class="weak-bar" :class="{ danger: b.danger }" />
                <text :x="b.x + b.w + 10" :y="b.y + b.h / 2 + 4" class="weak-bar-val" :class="{ danger: b.danger }">{{ b.accPct }}%</text>
              </g>
            </svg>
          </div>
        </div>
      </div>

      <!-- ===== 推荐模块入口 ===== -->
      <div class="card dash-section">
        <div class="card-head">
          <div class="h-section">下一步去练</div>
          <span class="text-3" style="font-size: var(--fs-xs)">先补最弱的</span>
        </div>
        <div class="grid cols-3 stagger">
          <button
            v-for="m in recommended" :key="m.key"
            class="entry-card unstyled-btn" @click="store.setView(MODULE_VIEWS[m.key] || 'dashboard')"
          >
            <div class="entry-card-icon"><svg class="mod-icon lg" viewBox="0 0 24 24"><path :d="MODULE_ICON_PATHS[m.key] || ''" /></svg></div>
            <div class="entry-card-name">{{ m.name }}</div>
            <div class="entry-card-meta">{{ m.value ? Math.round(m.value * 100) + '% 正确率' : '还没做过' }} · 去练</div>
            <div class="entry-card-progress"><i :style="{ width: `${(m.value || 0) * 100}%` }" /></div>
          </button>
        </div>
      </div>

      <!-- ===== 书架入口 ===== -->
      <div class="card dash-section">
        <div class="card-head">
          <div class="h-section">英语书单</div>
          <button class="btn small" @click="store.setView('bookshelf')">看全部 {{ store.books.length }} 本 →</button>
        </div>
        <div class="bookshelf-rail">
          <button
            v-for="b in bookRail" :key="b.title"
            class="book-rail-card unstyled-btn" @click="store.setView('bookshelf')"
          >
            <div class="book-rail-tag">{{ b.category }}</div>
            <div class="book-rail-title">{{ b.title }}</div>
            <div class="book-rail-author">{{ b.author }}</div>
          </button>
        </div>
      </div>

      <div class="dash-foot-note">
        每类选 <b style="color: var(--accent)">一本</b> 主力，每天雷打不动一小时，贪多必弃
      </div>
    </div>

    <!-- 周报弹窗(n-modal teleport 到 body,放在根 .view-scroll 内便于单根模板) -->
    <n-modal :show="reportOpen" preset="card" :bordered="false" closable
      class="report-modal"
      :content-style="{ padding: '4px 32px 24px' }"
      @close="reportOpen = false"
    >
    <template #header>
      <div class="report-hero">
        <div class="report-hero-title">这一周你练得怎么样</div>
        <div class="report-hero-sub">{{ store.user?.username || '同学' }} · {{ weekSummary.dateRange }} · 词峰 WORDPEAK</div>
      </div>
    </template>

    <div class="report-tiles">
      <div class="report-tile">
        <div class="rt-label">连着学了</div>
        <div class="rt-num"><CountNum :v="weekSummary.streak" mono /><span>天</span></div>
      </div>
      <div class="report-tile">
        <div class="rt-label">掌握的词</div>
        <div class="rt-num"><CountNum :v="weekSummary.mastered" mono /><span>/ {{ weekSummary.learned }}</span></div>
      </div>
      <div class="report-tile">
        <div class="rt-label">这周新学</div>
        <div class="rt-num"><CountNum :v="weekSummary.newWords" mono /><span>词</span></div>
      </div>
      <div class="report-tile">
        <div class="rt-label">这周出勤</div>
        <div class="rt-num"><CountNum :v="weekSummary.activeDays" mono /><span>/ 7</span></div>
      </div>
    </div>

    <div class="report-weak">
      <div class="h-card" style="margin-bottom: 14px">这周最该补的词根家族</div>
      <button
        v-for="r in weekSummary.weakTop3" :key="r.root"
        class="report-weak-row unstyled-btn" @click="store.openFamily(r.root); reportOpen = false"
      >
        <b class="report-weak-root">{{ r.root.toUpperCase() }}-</b>
        <span class="text-2" style="font-size: var(--fs-sm)">{{ r.meaning }}</span>
        <div class="bar warm" style="flex: 1"><i :style="{ width: `${(1 - r.accuracy) * 100}%` }" /></div>
        <span class="report-weak-acc" :style="{ color: r.accuracy < 0.4 ? 'var(--danger)' : 'var(--warn)' }">{{ Math.round(r.accuracy * 100) }}%</span>
      </button>
      <p v-if="!weekSummary.weakTop3.length" class="text-3" style="font-size: var(--fs-sm); margin: 12px 0 0">
        这周还没碰过词根题，去词汇圣殿点几颗星，下周这里就有内容了
      </p>
      <p class="text-3" style="font-size: var(--fs-xs); margin: 14px 0 0">这周共复习了 {{ weekSummary.reviews }} 次，点一行直接去那个家族</p>
    </div>

    <template #action>
      <div class="report-actions">
        <button class="btn primary lg" @click="downloadWeeklyReport">下载这周的 PNG 报告</button>
        <button class="btn lg" @click="reportOpen = false">关闭</button>
      </div>
    </template>
  </n-modal>
  </div>
</template>

<style scoped>
/* 问候右侧操作行 / 卡片区距 / 页脚提示 */
.dash-greet-actions { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.dash-section { margin-bottom: 16px; }
.heatmap-card { margin-bottom: 16px; }
/* 标题已换 BlurText 逐字入场:scoped 关掉全局 heroRise 避免双重动画;
   .blur-text 全局是 display:inline,这里补回 block 才保得住 h1 的块级底距节奏 */
.dash-greeting h1.blur-text { animation: none; display: block; }

/* 英雄横幅右侧的实时天体仪(Three.js):画布尺寸交给这里,内部自转/视差由引擎负责 */
.dash-hero-art {
  position: absolute; right: 44px; top: 50%;
  /* 鼠标视差:onHeroMove 写的 --par-x/--par-y 在这里真正生效(长缓动=漂浮感跟随) */
  transform: translateY(-50%) translate(var(--par-x, 0px), var(--par-y, 0px));
  transition: transform 0.7s var(--ease);
  width: min(320px, 30%); pointer-events: none;
}
@media (max-width: 1080px) { .dash-hero-art { opacity: 0.72; } }
@media (max-width: 780px) { .dash-hero-art { display: none; } }

/* ===== 学习模式:三条航线(仪器小标 + 站点刻度,推荐档左缘 accent 刻线) ===== */
.modes-card { padding: 20px 24px 16px; }
/* 特色卡头:mono 刻字 kicker 垫在衬线大字上方 —— 与「今日航线」「你的天空」同一星图命名式 */
.modes-head {
  display: flex; align-items: flex-end; justify-content: space-between;
  gap: 14px; flex-wrap: wrap; margin-bottom: 16px;
}
.modes-title-col { display: flex; flex-direction: column; gap: 7px; }
.modes-kick {
  font-family: var(--mono, monospace); font-size: var(--fs-2xs); font-weight: 600;
  letter-spacing: 0.34em; color: var(--accent); opacity: 0.85;
}
.modes-title {
  font-family: var(--serif);
  font-size: var(--fs-xl); font-weight: 600; letter-spacing: 0.1em; color: var(--text);
}
.modes-hint { font-size: var(--fs-xs); color: var(--text-3); padding-bottom: 3px; }
.modes-list { display: flex; flex-direction: column; }
.mode-row {
  position: relative;
  display: flex; align-items: center; gap: 18px;
  padding: 16px 16px 16px 18px;
  border-radius: 12px;
  border: 1px solid transparent;
  transition: background 0.3s ease, border-color 0.3s ease;
}
.mode-row + .mode-row { border-top: 1px solid var(--line); border-radius: 0 0 12px 12px; }
.mode-row:hover { background: color-mix(in srgb, var(--accent) 4%, transparent); }
.mode-row.rec::before {
  content: ''; position: absolute; left: 0; top: 14px; bottom: 14px; width: 2px;
  background: var(--accent); border-radius: 2px;
}
.mode-glyph { width: 44px; height: 44px; flex-shrink: 0; color: var(--text-3); transition: color 0.3s ease; }
.mode-row:hover .mode-glyph, .mode-row.rec .mode-glyph { color: var(--accent); }
.mode-glyph path {
  fill: none; stroke: currentColor; stroke-width: 1.5;
  stroke-linecap: round; stroke-linejoin: round;
}
.mode-main { flex: 1; min-width: 0; }
.mode-name { font-size: var(--fs-md); font-weight: 600; color: var(--text); font-family: var(--serif, Georgia, serif); }
.mode-latin {
  font-family: var(--mono, monospace); font-size: var(--fs-2xs); font-weight: 400;
  letter-spacing: 0.18em; color: var(--text-3); margin-left: 10px;
}
.mode-desc { font-size: var(--fs-sm); color: var(--text-2); line-height: 1.7; margin: 6px 0 8px; }
.mode-stops { display: flex; flex-wrap: wrap; gap: 8px; }
.mode-stop {
  display: inline-flex; align-items: center; gap: 6px;
  font-size: var(--fs-2xs); color: var(--text-3);
  border: 1px solid var(--line); border-radius: 999px;
  padding: 3px 10px 3px 4px;
}
.mode-stop i {
  font-style: normal; font-family: var(--mono, monospace); font-size: var(--fs-2xs);
  width: 17px; height: 17px; display: inline-flex; align-items: center; justify-content: center;
  border-radius: 50%; border: 1px solid var(--line);
}
.mode-row.rec .mode-stop { color: var(--text-2); border-color: color-mix(in srgb, var(--accent) 30%, var(--line)); }
.mode-row.rec .mode-stop i { border-color: color-mix(in srgb, var(--accent) 45%, transparent); color: var(--accent); }
.mode-row .btn { flex-shrink: 0; }
@media (max-width: 720px) {
  .mode-row { flex-wrap: wrap; }
  .mode-row .btn { width: 100%; order: 3; }
  .mode-glyph { width: 36px; height: 36px; }
}

/* 页脚提示:虚线药丸,收个尾 */
.dash-foot-note {
  text-align: center; color: var(--text-3); font-size: var(--fs-xs);
  margin-top: 36px; padding: 14px 18px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--accent) 4%, transparent);
  border: 1px dashed color-mix(in srgb, var(--accent) 22%, var(--line));
}

/* 新手首课推荐卡(自愿进入,不强制):天窗渐变 + 右上虚线轨道 */
.first-lesson {
  position: relative; overflow: hidden;
  display: flex; gap: 18px; align-items: center;
  margin-bottom: 16px; padding: 20px 24px; border-radius: 16px;
  border-color: var(--line-accent);
  background:
    radial-gradient(380px 220px at 100% 0%, color-mix(in srgb, var(--accent) 13%, transparent), transparent 68%),
    radial-gradient(320px 200px at 0% 100%, color-mix(in srgb, var(--accent-2) 9%, transparent), transparent 68%),
    var(--surface);
}
.first-lesson::after {
  content: ''; position: absolute; right: -64px; top: -64px;
  width: 210px; height: 210px; border-radius: 50%;
  border: 1.5px dashed color-mix(in srgb, var(--accent) 26%, transparent);
  pointer-events: none;
}
.first-lesson::before {
  content: ''; position: absolute; right: -28px; top: -28px;
  width: 150px; height: 150px; border-radius: 50%;
  border: 1px dashed color-mix(in srgb, var(--accent-2) 20%, transparent);
  pointer-events: none;
}
.fl-tag {
  flex-shrink: 0; align-self: flex-start;
  padding: 5px 12px; border-radius: 999px; white-space: nowrap;
  background: var(--accent-soft); border: 1px solid var(--line-accent);
  color: var(--accent); font-size: var(--fs-xs); font-weight: 600; letter-spacing: 0.04em;
}
.fl-body { flex: 1; min-width: 0; position: relative; z-index: 1; }
.fl-title { font-size: var(--fs-md); font-weight: 700; color: var(--text); }
.fl-desc { color: var(--text-2); font-size: var(--fs-sm); line-height: 1.7; margin: 6px 0 12px; max-width: 640px; }
.fl-actions { display: flex; gap: 10px; flex-wrap: wrap; }
@media (max-width: 720px) { .first-lesson { flex-direction: column; align-items: stretch; gap: 10px; } }

/* 智能提示卡:emoji 坐在主题色小圆牌上 */
.insight-row { display: grid; gap: 12px; margin-bottom: 16px; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); }
.insight-card {
  display: flex; align-items: center; gap: 14px;
  padding: 14px 18px; border-radius: 14px;
  background: var(--surface); border: 1px solid var(--line);
  position: relative; overflow: hidden;
}
.insight-card.tone-warm { border-color: color-mix(in srgb, var(--warn) 35%, var(--line)); background: color-mix(in srgb, var(--warn) 5%, var(--surface)); }
.insight-card.tone-success { border-color: color-mix(in srgb, var(--success) 35%, var(--line)); background: color-mix(in srgb, var(--success) 5%, var(--surface)); }
.insight-card.tone-accent { border-color: var(--line-accent); background: color-mix(in srgb, var(--accent) 5%, var(--surface)); }
.insight-icon {
  flex-shrink: 0;
  width: 44px; height: 44px; border-radius: 13px;
  display: flex; align-items: center; justify-content: center;
  background: color-mix(in srgb, var(--accent) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--accent) 16%, transparent);
}
.insight-icon svg { width: 23px; height: 23px; color: var(--accent); }
.insight-icon path {
  fill: none; stroke: currentColor; stroke-width: 1.5;
  stroke-linecap: round; stroke-linejoin: round;
}
.tone-warm .insight-icon { background: color-mix(in srgb, var(--warn) 12%, transparent); border-color: color-mix(in srgb, var(--warn) 22%, transparent); }
.tone-warm .insight-icon svg { color: var(--warn); }
.tone-success .insight-icon { background: color-mix(in srgb, var(--success) 12%, transparent); border-color: color-mix(in srgb, var(--success) 22%, transparent); }
.tone-success .insight-icon svg { color: var(--success); }
.insight-body { flex: 1; min-width: 0; }
.insight-title { font-weight: 600; font-size: var(--fs-base); line-height: 1.4; }
.insight-text { font-size: var(--fs-xs); color: var(--text-2); margin-top: 3px; line-height: 1.6; }

/* 周报弹窗(n-modal 卡片样式,替代内联 style 对象) */
:global(.report-modal) {
  width: min(720px, 94vw) !important;
  background: var(--surface) !important;
  border: 1px solid var(--line-accent) !important;
  box-shadow: 0 24px 64px color-mix(in srgb, var(--bg) 60%, transparent) !important;
  border-radius: 20px !important;
  animation: modalRise 0.3s var(--ease) both;
}
:global(.n-modal-mask) {
  background: var(--scrim-strong) !important;
  backdrop-filter: blur(20px) saturate(1.3) !important;
}

/* 加载骨架(stats 未就绪时) */
.sk-zone { animation: fadeIn 0.3s var(--ease); }
.sk-line { height: 12px; }
.sk-num { height: 46px; width: 42%; margin: 14px 0 10px; }
/* 骨架数字与真实磁贴的 56px 大数字等高等距:数据到货时版面不跳 */
.sk-zone .sk-num { height: 56px; margin: 12px 0 6px; }
.sk-chart { height: 200px; margin-top: 16px; }

.chart-hover-tip {
  position: absolute; top: 0; transform: translateX(-50%);
  background: var(--surface-elevated, var(--surface));
  border: 1px solid var(--line-strong);
  border-radius: 10px; padding: 8px 12px;
  font-size: var(--fs-xs); color: var(--text);
  pointer-events: none; white-space: nowrap;
  box-shadow: var(--shadow-md);
  animation: riseIn 0.18s var(--ease) both;
}

/* 活跃度图:窗口 tab + 参考线图例 */
.chart-tabs { display: flex; gap: 4px; }
.chart-tab {
  padding: 4px 12px; border-radius: 8px; font-size: var(--fs-xs);
  background: var(--surface); border: 1px solid var(--line);
  color: var(--text-2); cursor: pointer;
  transition: all 0.2s var(--ease);
}
.chart-tab:hover { color: var(--text); border-color: var(--line-strong); }
.chart-tab.active {
  color: var(--accent); border-color: var(--line-accent);
  background: var(--accent-soft); font-weight: 600;
}
.chart-legend {
  display: flex; gap: 16px; flex-wrap: wrap;
  margin: 8px 0 2px; font-size: var(--fs-xs); color: var(--text-3);
}
.legend-item { display: inline-flex; align-items: center; gap: 6px; }
.legend-item i { display: inline-block; width: 18px; height: 0; }
.legend-line { border-top: 2px solid var(--accent); }
.legend-trend { border-top: 2px dashed var(--accent-2); }
.legend-ma { border-top: 2px dashed var(--warn); }
.chart-trend { fill: none; stroke: var(--accent-2); stroke-width: 1.5; stroke-dasharray: 6 5; opacity: 0.85; }
.chart-ma { fill: none; stroke: var(--warn); stroke-width: 1.5; stroke-dasharray: 3 4; opacity: 0.85; }

/* 今日一策:推荐理由按后端原文平实呈现,不加框 */
.tip-banner-reason {
  margin-top: 10px;
  font-size: var(--fs-sm); line-height: 1.6;
  color: var(--text-2);
}

/* 模块内联 SVG 小图标(替代 emoji) */
.mod-icon {
  width: 15px; height: 15px; vertical-align: -2.5px;
  stroke: currentColor; fill: none;
  stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round;
}
.mod-icon.lg { width: 26px; height: 26px; }

/* 活跃度图下方的一句数据点评 */
.activity-note {
  margin: 10px 0 0; font-size: var(--fs-xs); color: var(--text-3);
}

/* 词汇量增长曲线 · 增长总结 */
.growth-meta {
  display: flex; align-items: center; gap: 8px; margin-top: 10px;
  font-family: var(--mono); font-size: var(--fs-xs); color: var(--text-2);
}
.meta-arr { color: var(--text-3); }
.growth-meta .chip { font-family: var(--font); }

/* 记忆强度分布 */
.strength-bars { display: flex; flex-direction: column; gap: 8px; margin-top: 4px; }
.sb-row { display: flex; align-items: center; gap: 12px; }
.sb-label { display: inline-flex; align-items: center; gap: 6px; width: 80px; font-size: var(--fs-sm); color: var(--text-2); flex-shrink: 0; }
.sb-dot { width: 9px; height: 9px; border-radius: 50%; flex-shrink: 0; }
.sb-dot.g { background: var(--success); }
.sb-dot.b { background: var(--info); }
.sb-dot.a { background: var(--warn); }
.sb-dot.r { background: var(--danger); }
.sb-bar { flex: 1; }
.sb-val { width: 52px; text-align: right; font-family: var(--mono); font-size: var(--fs-sm); color: var(--text-2); font-variant-numeric: tabular-nums; }

/* 错题家族分布:横向柱状图(SVG 自绘) */
.weak-bars { margin-top: 18px; }
.weak-bars-head {
  display: flex; justify-content: space-between; align-items: baseline;
  padding-bottom: 8px; border-bottom: 1px solid var(--line);
}
.weak-bar-svg { width: 100%; height: auto; display: block; margin-top: 6px; }
.weak-bar-row { cursor: pointer; }
.weak-bar-row:hover .weak-bar { filter: brightness(1.25); }
.weak-bar-label {
  font-family: var(--mono); font-size: var(--fs-base); font-weight: 600;
  fill: var(--text-2); text-anchor: end;
}
.weak-bar-row:hover .weak-bar-label { fill: var(--text); }
.weak-bar {
  fill: var(--warn); opacity: 0.55;
  transition: all 0.2s var(--ease);
}
.weak-bar.danger { fill: var(--danger); }
.weak-bar-val {
  font-size: var(--fs-xs); font-weight: 600; font-variant-numeric: tabular-nums;
  fill: var(--warn);
}
.weak-bar-val.danger { fill: var(--danger); }

/* 周报弹窗 */
.report-hero { text-align: center; margin-bottom: 24px; }
.report-hero-title {
  font-size: var(--fs-2xl); font-weight: 700; letter-spacing: -0.02em;
  background: var(--grad-text);
  -webkit-background-clip: text; background-clip: text; color: transparent;
}
.report-hero-sub { color: var(--text-2); font-size: var(--fs-sm); margin-top: 8px; }
.report-tiles {
  display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px;
  margin-bottom: 24px;
}
.report-tile {
  padding: 18px 14px; text-align: center;
  background: var(--surface); border: 1px solid var(--line);
  border-radius: 16px;
}
.rt-label { color: var(--text-2); font-size: var(--fs-xs); }
.rt-num {
  font-size: 34px; font-weight: 700; margin-top: 8px;
  font-variant-numeric: tabular-nums;
}
.rt-num span { font-size: var(--fs-sm); font-weight: 500; color: var(--text-3); margin-left: 2px; }
.report-weak { padding: 18px 0 6px; border-top: 1px solid var(--line); }
.report-weak-row {
  display: flex; align-items: center; gap: 12px;
  padding: 10px 0; cursor: pointer;
  transition: background 0.2s var(--ease);
  border-radius: 8px;
}
.report-weak-row:hover { background: var(--surface-hover); }
.report-weak-root {
  font-family: var(--mono); font-size: var(--fs-md); color: var(--accent);
  min-width: 64px;
}
.report-weak-acc { font-size: var(--fs-md); font-weight: 600; min-width: 44px; text-align: right; }
.report-actions {
  display: flex; gap: 12px; justify-content: center;
  margin-top: 22px; padding-top: 18px; border-top: 1px solid var(--line);
}
@media (max-width: 720px) {
  .report-tiles { grid-template-columns: repeat(2, 1fr); }
}

/* 你的天空 × 星轨:成对呈现,观星台的两幅证据 */
.sky-trail-duo {
  display: grid; grid-template-columns: 5fr 4fr; gap: 16px;
  margin-top: 16px; align-items: stretch;
}
.sky-card { padding: 20px 22px 10px; }
.trail-card { padding: 20px 22px 16px; display: flex; flex-direction: column; }
@media (max-width: 1080px) {
  .sky-trail-duo { grid-template-columns: 1fr; }
}
/* 天空卡头:星图命名式(kicker → 衬线大字),右侧 mono 读数压底对齐 */
.sky-head {
  display: flex; align-items: flex-end; justify-content: space-between;
  gap: 12px; flex-wrap: wrap; margin-bottom: 12px;
}
.sky-title-col { display: flex; flex-direction: column; gap: 7px; }
.sky-kick {
  font-family: var(--mono, monospace); font-size: var(--fs-2xs); font-weight: 600;
  letter-spacing: 0.34em; color: var(--accent); opacity: 0.85;
}
.sky-title {
  font-family: var(--serif);
  font-size: var(--fs-xl); font-weight: 600; letter-spacing: 0.1em; color: var(--text);
}
.sky-count { font-size: var(--fs-2xs); letter-spacing: 0.14em; color: var(--text-3); padding-bottom: 3px; }
/* 星轨卡头从父级对齐同一衬线语言(StarTrail 仅观星台使用,样式收口在父级,不动它的文件) */
.trail-card :deep(.st-title) {
  font-family: var(--serif);
  font-size: var(--fs-xl); letter-spacing: 0.1em;
}

/* 交互按压反馈:磁贴/提示卡可点的都要"接得住"指尖 */
.mega-tile.accent, .mega-tile.warm { cursor: pointer; }
.mega-tile:active { transform: translateY(-1px) scale(0.99); box-shadow: none; }
.insight-card { transition: transform 0.25s var(--ease), border-color 0.25s var(--ease), box-shadow 0.25s var(--ease); }
.insight-card:hover { transform: translateY(-2px); box-shadow: var(--shadow-sm); }
.insight-card:active { transform: translateY(0) scale(0.995); }

/* 大数字行:块级呼吸(12/6px)留在行容器,渐变裁切落在数字自己的盒子上(CountNum 根挂 .mega-tile-num,
   inline-block 保证 background-clip:text 稳定生效;margin 归零避免与行容器叠加) */
.mega-tile-num-row { margin: 12px 0 6px; line-height: 1; }
.mega-tile-num-row .mega-tile-num { display: inline-block; margin: 0; }
</style>
