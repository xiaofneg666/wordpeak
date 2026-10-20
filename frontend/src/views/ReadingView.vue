<script setup>
import { ref, computed, watch, onMounted, onUnmounted, onActivated, onDeactivated } from 'vue'
import HowToTrain from '../components/HowToTrain.vue'
import SettleCard from '../components/SettleCard.vue'
import { useUniverse } from '../stores/universe'
import { api } from '../api'
import { speak, stopSpeaking } from '../speech'
import { message } from '../ui'
import EmptyState from '../components/EmptyState.vue'
import CopyButton from '../components/CopyButton.vue'
import LookupMenu from '../components/LookupMenu.vue'
import CollectPopover from '../components/CollectPopover.vue'
import { formatWordText, wordPermalink } from '../utils/wordText.js'

const store = useUniverse()
const readings = computed(() => store.passages.filter((p) => p.type === 'reading'))
const pid = ref(null)
const p = computed(() => readings.value.find((x) => x.id === pid.value))
const answered = ref({})       // qi -> picked
const results = ref({})        // qi -> correct
const submitted = ref(null)
const showZh = ref({})         // si -> bool
const popWord = ref(null)      // 点击词库词弹出的小词卡
const knownIds = ref(new Set()) // 词库中所有词 id
const learned = ref(new Set())  // 本会话已标记的生词(去重提示)

// 简易词形还原:去掉常见后缀匹配词库
function lemma(w) {
  return w.toLowerCase().replace(/[^a-z']/g, '').replace(/(ing|ed|ies|s|es|ly|er|est|ness|ment|tion|ous|ful|less)$/i, '')
}

// ---------- 阅读计时 + WPM(阅读速度) ----------
// 年级参考目标(简单分级,参照美国小学 oral reading fluency 常用标准)
const WPM_TARGETS = [
  { grade: 3, wpm: 95 }, { grade: 4, wpm: 110 }, { grade: 5, wpm: 120 }, { grade: 6, wpm: 130 },
]
function wpmTarget(level) {
  const idx = Math.min(WPM_TARGETS.length - 1, Math.max(0, (Number(level) || 1) - 1))
  return WPM_TARGETS[idx]
}
const readSeconds = ref(0)  // 本篇已读秒数(实时跳表)
const wpmInfo = ref(null)   // 结算结果 { seconds, words, wpm, target, grade, hit }
let readT0 = 0
let accMs = 0   // 暂停累计(切走再回来,中间离开的时间不算进 WPM)
let readTicker = 0
let alive = true

function elapsedMs() {
  return accMs + (readT0 ? Date.now() - readT0 : 0)
}

function passageWords() {
  return p.value ? p.value.sentences.reduce((a, s) => a + s.en.split(/\s+/).filter(Boolean).length, 0) : 0
}
function startTimer() {
  accMs = 0
  readT0 = Date.now()
  readSeconds.value = 0
  wpmInfo.value = null
  clearInterval(readTicker)
  readTicker = setInterval(() => { if (alive) readSeconds.value = Math.floor(elapsedMs() / 1000) }, 1000)
}
// 用户真正开始读(第一次滚动/点击)才计时——人还没读就把时长白送给 WPM
function armTimer() {
  if (readT0 || !p.value) return
  readT0 = Date.now() - accMs // 接上暂停前累计的阅读时间
  clearInterval(readTicker)
  readTicker = setInterval(() => { if (alive) readSeconds.value = Math.floor(elapsedMs() / 1000) }, 1000)
}
// 切走阅读号:计时暂停(不结算,回来接着读),朗读停掉
function pauseTimer() {
  if (readT0) { accMs += Date.now() - readT0; readT0 = 0 }
  clearInterval(readTicker)
  readTicker = 0
}
// 结算:算出 WPM(词/分钟)并与年级目标对比;时长存 localStorage(不动后端 schema)
// 同时记下「上一次的速度」——下一遍的对比就从这里来
function settleTimer() {
  clearInterval(readTicker)
  readTicker = 0
  const elapsed = elapsedMs()
  readT0 = 0; accMs = 0
  if (!elapsed || !p.value) return
  const seconds = Math.max(1, Math.round(elapsed / 1000))
  const words = passageWords()
  const { grade, wpm: target } = wpmTarget(p.value.level)
  const wpm = Math.round(words / (seconds / 60))
  const prevLast = (() => { try { return JSON.parse(localStorage.getItem('wv_reading_time') || '{}')[p.value.id]?.last ?? null } catch { return null } })()
  wpmInfo.value = { seconds, words, wpm, target, grade, hit: wpm >= target, last: prevLast?.wpm ?? null }
  saveReadTime(p.value.id, seconds, wpm)
}
function fmtSec(s) {
  const m = Math.floor(s / 60), r = s % 60
  return m ? `${m} 分 ${r} 秒` : `${r} 秒`
}
// 年级号 → 中文年级名(WPM 结算用)
const GRADE_NAMES = ['', '一', '二', '三', '四', '五', '六']
// WPM 结算一句话:对照年级目标说人话,给具体动作而不是打分
function wpmComment(w) {
  const g = `${GRADE_NAMES[w.grade] || w.grade}年级`
  if (w.wpm >= w.target * 1.3) return `这个速度对${g}来说已经挺快了，记得回头看看理解题是不是都做对了`
  if (w.hit) return `这个速度对${g}来说是达标了，保持就好`
  if (w.wpm >= w.target - 15) return `离${g}的目标只差一点，试试先看一眼题目再读，带着问题读会快一些`
  return `这个速度对${g}来说还偏慢，多半是逐词翻译了，试着整句抓意思`
}
// 读后验收一句话:按真实正确率分档
function resultLine(sb) {
  if (sb.accuracy >= 0.9) return `${sb.right}/${sb.total} 全对，这篇读懂了`
  if (sb.accuracy >= 0.7) return `对了 ${sb.right}/${sb.total}，看看错题的解析，再回原文找对应的那句`
  return `对了 ${sb.right}/${sb.total}，建议把文章再读一遍，重点看错题对应的那几句`
}
// 按篇累计阅读时长/最佳速度,localStorage 持久化
function saveReadTime(passageId, seconds, wpm) {
  try {
    const all = JSON.parse(localStorage.getItem('wv_reading_time') || '{}')
    const prev = all[passageId] || { count: 0, seconds: 0, best: 0 }
    all[passageId] = { count: prev.count + 1, seconds: prev.seconds + seconds, best: Math.max(prev.best, wpm), last: { seconds, wpm } }
    localStorage.setItem('wv_reading_time', JSON.stringify(all))
  } catch { /* 隐私模式 */ }
}

onMounted(() => {
  knownIds.value = new Set(store.words.map((w) => w.id))
  document.addEventListener('pointerdown', popDocDown, true) // 点空白收旁注
  window.addEventListener('keydown', popKey)
  // 错题本深链:带着具体短文进入
  if (store.pendingPassage?.mod === 'reading') { pid.value = store.pendingPassage.id; store.pendingPassage = null }
  // 默认选第一篇
  if (!pid.value && readings.value.length) pid.value = readings.value[0].id
})
// KeepAlive 回舱:可能带着错题深链的新篇(切走再回来直接落那篇)
onActivated(() => {
  if (store.pendingPassage?.mod === 'reading') { settleTimer(); pid.value = store.pendingPassage.id; store.pendingPassage = null }
})
// KeepAlive 切走:计时暂停(离开时间不算 WPM),朗读别在后台继续,旁注收起
onDeactivated(() => { pauseTimer(); stopSpeaking(); popWord.value = null; closeAny() })
onUnmounted(() => {
  alive = false; clearInterval(readTicker); stopSpeaking()
  document.removeEventListener('pointerdown', popDocDown, true)
  window.removeEventListener('keydown', popKey)
})

function pickPassage(x) {
  settleTimer() // 翻页:先结算上一篇的阅读速度
  pid.value = x.id
  answered.value = {}
  results.value = {}
  submitted.value = null
  showZh.value = {}
  learned.value = new Set()
  curSi.value = -1
  startTimer()
}

// 词库中所有词的 lookup 索引(词形还原后)
const lemmaMap = computed(() => {
  const m = new Map()
  for (const w of store.words) {
    m.set(lemma(w.word), w)
  }
  return m
})
// 精确拼写索引(原词形优先命中,统计/渲染共用 O(1) 查找)
const exactMap = computed(() => {
  const m = new Map()
  for (const w of store.words) {
    m.set(w.word.toLowerCase(), w)
  }
  return m
})

// 把句子按词切分,标出哪些是词库词
function tokenize(sentence) {
  return sentence.split(/(\s+|[,.;:!?'"()—–])/g).filter(Boolean)
}

function wordMatch(token) {
  if (!token || /^\s+$/.test(token) || /^[,.;:!?'"()—–-]$/.test(token)) return null
  const w = lemma(token)
  if (!w) return null
  // 优先完全匹配,再还原后匹配
  return exactMap.value.get(w) || lemmaMap.value.get(w) || null
}

// ---- 语料↔词汇联动:i+1 可见化 ----
// 已学词集合(进过复习队列的:store.states 有记录即算,键是 word_id)
const learnedIds = computed(() => new Set(Object.keys(store.states).map(Number)))
// 本词是否已学(SRS 有记录,或本会话刚加入复习)
function isLearnedWord(id) { return learnedIds.value.has(id) || learned.value.has(id) }
// 每篇阅读的词库词统计 id -> { vocab, learned }(词形还原后按词去重)
const passageStats = computed(() => {
  const m = new Map()
  for (const ps of readings.value) {
    const ids = new Set()
    for (const s of ps.sentences) {
      for (const tok of tokenize(s.en)) {
        const w = wordMatch(tok)
        if (w) ids.add(w.id)
      }
    }
    const all = [...ids]
    m.set(ps.id, { vocab: all.length, learned: all.filter((id) => learnedIds.value.has(id)).length })
  }
  return m
})
// 当前篇的统计(卡头 chip 用)
const pstat = computed(() => passageStats.value.get(pid.value) || { vocab: 0, learned: 0 })

function isVocab(tok) { return !!wordMatch(tok) }
// 词库外的英文词也能点:交给 AI 讲解卡(解释/记法/技巧/运用/语法)
function isAnyTok(tok) { return /^[A-Za-z][A-Za-z'-]{1,}$/.test(tok) }

function classOf(tok) {
  if (!isVocab(tok)) return 'word-plain'
  return 'word-vocab'
}

function speakSentence(s) { speak(s.en, { rate: 0.95 }) }

function showTranslation(si) { showZh.value = { ...showZh.value, [si]: !showZh.value[si] }; curSi.value = si }

// 车厢进度轨道:已读(看过翻译/精读过)的车厢点亮,当前句呼吸
const curSi = ref(-1)
const readCount = computed(() => Object.values(showZh.value).filter(Boolean).length)
const trackPct = computed(() => (p.value && p.value.sentences.length
  ? Math.min(100, (readCount.value / p.value.sentences.length) * 100) : 0))

// 选单上的同篇最佳速度(localStorage wv_reading_time,不添后端负担)
function bestWpmOf(id) {
  try { return JSON.parse(localStorage.getItem('wv_reading_time') || '{}')[id]?.best ?? 0 } catch { return 0 }
}

// 错题回跳:带着问题回到车厢顶部重读(理解题没有句级映射,诚实处理:回看原文)
function backToCars() {
  document.getElementById('train-track')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

// ---- 词卡(旁注):内联展开在所点词所在的车厢里,正文自动让位 —— 零遮挡 ----
const popSi = ref(-1) // 词所在车厢序号(车厢自带的 --i):卡展开在那节车厢内
// 任意词 AI 卡:词库外的词也点得开 —— 五维讲解(解释/记法/技巧/运用/语法),与库词卡互斥
const anyBlank = () => ({ word: '', loading: false, data: null, error: '' })
const popAny = ref(anyBlank())
function popSiFromEvent(e) {
  const si = Number(e?.target?.closest?.('.train-car')?.style.getPropertyValue('--i'))
  if (Number.isInteger(si)) popSi.value = si
}
function openWord(w, e) {
  if (e) e.stopPropagation()
  if (!w) return
  popWord.value = w
  popAny.value = anyBlank() // 两卡互斥
  popSiFromEvent(e)
}
async function openAnyWord(tok, e) {
  if (e) e.stopPropagation()
  if (!tok) return
  popWord.value = null // 两卡互斥
  popSiFromEvent(e)
  if (popAny.value.word === tok && (popAny.value.data || popAny.value.loading)) return // 同词已讲/在途,复用
  popAny.value = { word: tok, loading: true, data: null, error: '' }
  try {
    const r = await api.explain({ mode: 'word', word: tok, userId: store.user?.id })
    if (popAny.value.word !== tok) return // 途中换了词,回包作废
    popAny.value = { word: tok, loading: false, data: r, error: '' }
  } catch (err) {
    if (popAny.value.word !== tok) return
    popAny.value = { word: tok, loading: false, data: null, error: err?.message || '讲解暂不可用' }
  }
}
function closeAny() { popAny.value = anyBlank() }
function popDocDown(e) {
  if (!popWord.value && !popAny.value.word) return
  if (e.target.closest?.('.word-pop') || e.target.closest?.('.word-vocab')) return
  popWord.value = null
  closeAny()
}
function popKey(e) {
  if (e.key !== 'Escape') return
  if (popWord.value || popAny.value.word) { popWord.value = null; closeAny() }
}
// 换篇收旁注:词跟着旧篇走了,卡留着只会悬空
watch(() => pid.value, () => { popWord.value = null; closeAny() })

async function markLearned(w) {
  if (learned.value.has(w.id)) { message.info('已经在复习队列里了'); return }
  try {
    await store.api_learnWord(w.id)
    learned.value.add(w.id)
    learned.value = new Set(learned.value) // 触发响应
    message.success(`已把「${w.word}」加入复习队列，词汇圣殿里能看到它`)
  } catch (err) { message.error('加入失败') }
}

function gotoGalaxy(w) {
  popWord.value = null
  store.openWordInGalaxy(w.id)
}

// ---- 词卡增强:常用搭配 + 同根家族词 ----
// 同根(同 root/family)相关词,排除自己,最多 2 个 → 点击跳转查看
const familyWords = computed(() => {
  const w = popWord.value
  if (!w) return []
  return store.words
    .filter((x) => x.id !== w.id && (x.family === w.family || x.root === w.root))
    .slice(0, 2)
})
// 搭配句里把目标词高亮
function colloHtml(c) {
  const word = String(popWord.value.word).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return c.en.replace(new RegExp(`(${word})`, 'gi'), '<b class="collo-hit">$1</b>')
}
// 点同根词 → 词卡切换到该词(重新弹出,带高亮动画)
function jumpWord(w) { openWord(w) }

// 上次这篇的成绩(结算卡对比行):提交前先取——此刻库里最新一条就是「上次」
async function lastAccuracy(passageId) {
  try {
    const r = await api.historyPassages('reading', store.user?.id, 20)
    return r?.items?.find((i) => i.passage_id === passageId)?.accuracy ?? null
  } catch { return null }
}

async function pick(qi, oi) {
  if (answered.value[qi] !== undefined || !p.value) return
  const correct = oi === p.value.questions[qi].answer
  answered.value = { ...answered.value, [qi]: oi }
  results.value = { ...results.value, [qi]: correct }
  if (Object.keys({ ...answered.value, [qi]: oi }).length === p.value.questions.length) {
    const right = Object.values({ ...results.value, [qi]: correct }).filter(Boolean).length
    const prev = await lastAccuracy(p.value.id)
    submitted.value = { right, total: p.value.questions.length, accuracy: right / p.value.questions.length, prev }
    settleTimer() // 完成:结算本篇阅读速度
    try {
      await store.api_submitReading(p.value.id, right, p.value.questions.length)
      store.refreshStats()
    } catch { message.warning('成绩没能入库(后端不可达)，本轮结果只在本页显示') }
  }
}

function optCls(qi, oi, q) {
  if (answered.value[qi] === undefined) return ''
  if (oi === q.answer) return 'correct'
  if (oi === answered.value[qi]) return 'wrong'
  return ''
}
</script>

<template>
  <div class="view-scroll" @scroll.passive="armTimer" @pointerdown="armTimer">
    <div class="view-inner fade-in">
      <div class="terr-head">
        <div class="terr-kicker">TERRITORY · READING</div>
        <h2 class="terr-title"><BlurText text="阅读号列车" as="span" /></h2>
        <div class="terr-latin">READING RAILS</div>
        <div class="terr-rule" aria-hidden="true" />
        <p class="terr-sub">
          像翻分级读物——选一篇难度合适的短文，逐句精读、点词即学（生词自动进复习队列）、
          句句可朗读、读完做理解题。靠「i+1 可理解输入」稳定长大词汇量。
        </p>
      </div>

      <!-- 怎么练才有效:方法论条(收起一行,展开步骤) -->
      <HowToTrain view="reading" />

      <!-- 短文加载中:skeleton 占位 -->
      <template v-if="store.fetching">
        <div class="passage-head">
          <span v-for="i in 3" :key="i" class="skeleton sk-pick" :style="{ width: `${100 + i * 20}px` }" />
        </div>
        <div class="card">
          <div class="skeleton sk-line" :style="{ width: '44%', height: '20px', marginBottom: '16px' }" />
          <div v-for="i in 5" :key="i" class="skeleton sk-line" :style="{ width: `${98 - i * 3}%`, height: i % 2 ? '58px' : '26px', marginTop: '10px' }" />
        </div>
      </template>

      <!-- 无短文:空态 -->
      <EmptyState
        v-else-if="!readings.length"
        icon="车" title="阅读号列车还没有进站"
        desc="分级短文刷新一下通常就能加载出来;一直空着,晚点再来"
      />

      <template v-else>
        <div class="scene-hint">PICK A PASSAGE · 挑一篇难度合适的短文上车</div>
        <div class="passage-head">
          <button
            v-for="x in readings" :key="x.id"
            class="passage-pick" :class="{ active: pid === x.id }"
            @click="pickPassage(x)"
          >{{ x.title }} <span class="pp-lv">Lv.{{ x.level }}</span><span
            v-if="learnedIds.size && passageStats.get(x.id)?.vocab" class="pp-stat"
            :title="`这篇有 ${passageStats.get(x.id)?.vocab ?? 0} 个词库词，你已学 ${passageStats.get(x.id)?.learned ?? 0} 个`"
          >已学 {{ passageStats.get(x.id)?.learned ?? 0 }}/{{ passageStats.get(x.id)?.vocab ?? 0 }}</span><span
            v-if="bestWpmOf(x.id)" class="pp-stat" :title="`这篇你的最快阅读速度:每分钟 ${bestWpmOf(x.id)} 词`"
          >最快 {{ bestWpmOf(x.id) }} 词/分</span></button>
        </div>

        <div v-if="p" class="card read-card">
        <div class="read-head">
          <div class="read-head-main">
            <div class="read-kicker">NOW READING · 正在读</div>
            <h3 class="read-title">{{ p.title }}</h3>
          </div>
          <div class="head-meta">
            <span class="chip cyan">{{ p.sentences.length }} 句</span>
            <span v-if="pstat.learned" class="chip green">{{ pstat.learned }} 个已学词复现</span>
            <span class="chip amber">{{ learned.size }} 生词已加入复习</span>
            <span v-if="!wpmInfo" class="chip dim">已读 {{ fmtSec(readSeconds) }}</span>
            <button class="btn small stop-read-btn" @click="stopSpeaking()">
              <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>停止朗读
            </button>
          </div>
        </div>
        <p class="reading-hint">句中<span class="hint-sample">高亮的词</span>点开就是词卡，可以直接加进复习队列；<span class="hint-sample known">绿色</span>是你学过的词——在文章里再遇见它一次，记忆就加固一分。点喇叭能听整句朗读。</p>

        <!-- 阅读速度结算:WPM 与年级目标对比 -->
        <div v-if="wpmInfo" class="wpm-panel dots-host fade-in">
          <span class="dots-decor dots-fade" aria-hidden="true" style="--dots-o:.16" />
          <div class="wpm-gauge">
            <div class="wpm-big" :class="wpmInfo.hit ? 'ok' : 'warn'">
              <b><CountNum :v="wpmInfo.wpm" mono /></b>
              <span>词 / 分钟 · WPM</span>
            </div>
            <div class="wpm-detail">
              <div class="wpm-line">
                <span>这篇 {{ wpmInfo.words }} 个词，你读了 {{ fmtSec(wpmInfo.seconds) }}</span>
                <span v-if="wpmInfo.last" class="chip dim">上次 {{ wpmInfo.last }} 词/分{{ wpmInfo.wpm > wpmInfo.last ? ' · 这遍更快' : wpmInfo.wpm < wpmInfo.last ? ' · 这遍更稳' : '' }}</span>
                <span class="chip" :class="wpmInfo.hit ? 'green' : 'amber'">
                  {{ wpmInfo.grade }} 年级目标 {{ wpmInfo.target }} 词/分钟
                </span>
              </div>
              <div class="wpm-note">{{ wpmComment(wpmInfo) }}</div>
              <!-- hit 类把「达标」递给轨道终点,让亮点块换金(达标=点亮) -->
              <div class="wpm-bar" :class="{ hit: wpmInfo.hit }">
                <i :class="wpmInfo.hit ? 'wpm-ok' : 'wpm-warn'" :style="{ width: Math.min(100, (wpmInfo.wpm / wpmInfo.target) * 100) + '%' }" />
              </div>
            </div>
          </div>
        </div>

        <!-- 车厢轨道:左侧连续进度线(已读填充到当前,当前句呼吸) -->
        <div id="train-track" class="train-wrap">
          <div class="train-progress" aria-hidden="true">
            <div class="tp-fill" :style="{ height: trackPct + '%' }" />
            <div v-if="curSi >= 0" class="tp-thumb" :class="{ read: showZh[curSi] }" :style="{ top: (curSi / Math.max(1, p.sentences.length - 1)) * 100 + '%' }" />
          </div>
          <div class="train-track">
          <div
            v-for="(s, si) in p.sentences" :key="si"
            class="train-car" :class="{ read: showZh[si], current: curSi === si }"
            :style="{ '--i': si }"
          >
            <div class="car-num">{{ si + 1 }}</div>
            <div class="car-body">
              <div class="sentence-en">
                <template v-for="(tok, ti) in tokenize(s.en)" :key="ti">
                  <span
                    v-if="isVocab(tok)"
                    class="word-vocab"
                    :class="{ known: isLearnedWord(wordMatch(tok).id) }"
                    @click="openWord(wordMatch(tok), $event)"
                    :title="wordMatch(tok).meaning"
                  >{{ tok }}</span>
                  <span
                    v-else-if="isAnyTok(tok)"
                    class="word-vocab any" :title="`点开「${tok}」的讲解`"
                    @click="openAnyWord(tok, $event)"
                  >{{ tok }}</span>
                  <span v-else class="word-plain">{{ tok }}</span>
                </template>
              </div>
              <div v-if="showZh[si]" class="sentence-zh fade-in">{{ s.zh }}</div>
              <div class="car-actions">
                <button class="play-btn" title="朗读这一句" @click="speakSentence(s)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg></button>
                <button class="play-btn" title="看中文翻译（先逼自己读英文）" @click="showTranslation(si)">
                  {{ showZh[si] ? '隐藏翻译' : '看翻译' }}
                </button>
              </div>
              <!-- 词卡(旁注):内联展开在所点词所在的车厢里,正文自动让位 —— 零遮挡;:key 让同根词跳转时重播弹出动画 -->
              <div v-if="popSi === si && popWord" class="word-pop card" :key="popWord.id">
                <button class="wp-close" @click="popWord = null">✕</button>
                <div class="wp-word">{{ popWord.word }} <span class="wp-pos">{{ popWord.pos }}</span>
                  <button class="play-btn" @click="speak(popWord.word)" title="发音"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg></button>
                </div>
                <div class="ipa" style="font-size: var(--fs-lg)">{{ popWord.ipa }}</div>
                <div class="wp-meaning">{{ popWord.meaning }}</div>
                <div class="wp-root">
                  <b>词根 {{ popWord.root }}-</b>({{ popWord.root_meaning }})<br />
                  {{ popWord.etymology }}
                </div>
                <div v-if="popWord.collocations?.length" class="wp-label">这个词常跟谁一起用</div>
                <div v-for="(c, i) in popWord.collocations?.slice(0, 3)" :key="i" class="wp-item">
                  <div>
                    <div class="collo-en" v-html="colloHtml(c)"></div>
                    <div class="zh" style="margin-top: 3px">{{ c.zh }}</div>
                  </div>
                  <button class="play-btn" @click="speak(c.en)" title="听这条搭配"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg></button>
                </div>
                <div v-if="familyWords.length" class="wp-label">同词根的亲戚词，点开看看</div>
                <div v-if="familyWords.length" class="family-row">
                  <button v-for="fw in familyWords" :key="fw.id" class="family-chip" :title="fw.etymology" @click="jumpWord(fw)">
                    <b>{{ fw.word }}</b>
                    <span class="fam-zh">{{ fw.meaning }}</span>
                    <span class="fam-lv">Lv.{{ fw.level }}</span>
                  </button>
                </div>
                <div v-if="popWord.examples?.length" class="wp-label">例句</div>
                <div v-for="(e, i) in popWord.examples?.slice(0, 2)" :key="i" class="wp-item">
                  <div><div>{{ e.en }}</div><div class="zh" style="margin-top: 3px">{{ e.zh }}</div></div>
                  <button class="play-btn" @click="speak(e.en)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg></button>
                </div>
                <!-- 复制 / 查询 / 分享 / 收藏(Phase 2+4) -->
                <div class="pop-tools">
                  <CopyButton :text="formatWordText(popWord)" icon="copy" title="复制" />
                  <LookupMenu :word="popWord.word" :ipa="popWord.ipa" />
                  <CopyButton :text="wordPermalink(popWord.id)" icon="link" title="复制永久链接" />
                  <CollectPopover :word-id="popWord.id" />
                </div>
                <div class="rv-actions pop-actions">
                  <button class="btn primary" @click="markLearned(popWord)">加入复习队列</button>
                  <button class="btn ghost" @click="gotoGalaxy(popWord)">开往星系 →</button>
                  <button class="btn ghost" @click="popWord = null">稍后</button>
                </div>
              </div>
              <!-- 任意词 AI 卡:词库外的词也点得开 —— 五维讲解(解释/记法/技巧/运用/语法) -->
              <div v-if="popSi === si && popAny.word && !popWord" class="word-pop card any-pop" :key="'any-' + popAny.word">
                <button class="wp-close" @click="closeAny()">✕</button>
                <div class="wp-word">{{ popAny.word }}
                  <button class="play-btn" @click="speak(popAny.word)" title="发音"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg></button>
                </div>
                <div v-if="popAny.loading" class="wa-scan">
                  <span class="mono">AI 正在讲这个词…</span>
                  <span class="wa-bar"><i /></span>
                </div>
                <div v-else-if="popAny.error" class="wa-error">{{ popAny.error }}</div>
                <template v-else-if="popAny.data">
                  <div v-if="popAny.data.explain" class="wa-row">
                    <span class="wa-tag mono">解释</span>
                    <p>{{ popAny.data.explain }}</p>
                  </div>
                  <div v-if="popAny.data.mnemonic" class="wa-row">
                    <span class="wa-tag mono">记法</span>
                    <p>{{ popAny.data.mnemonic }}</p>
                  </div>
                  <div v-if="popAny.data.tip" class="wa-row">
                    <span class="wa-tag mono">技巧</span>
                    <p>{{ popAny.data.tip }}</p>
                  </div>
                  <div v-if="popAny.data.usage" class="wa-row">
                    <span class="wa-tag mono">运用</span>
                    <p>{{ popAny.data.usage }}</p>
                  </div>
                  <div v-if="popAny.data.grammar" class="wa-row">
                    <span class="wa-tag mono">语法</span>
                    <p>{{ popAny.data.grammar }}</p>
                  </div>
                  <div class="wa-foot mono">{{ popAny.data.source === 'llm' ? 'AI LIVE · 实时讲解' : 'LOCAL · 本地速览' }}</div>
                </template>
                <div class="pop-tools">
                  <LookupMenu :word="popAny.word" />
                </div>
              </div>
            </div>
          </div>
          </div>
        </div>
      </div>

      <div v-if="p && p.questions?.length > 0" class="card">
        <div class="read-head">
          <div class="read-head-main">
            <div class="read-kicker">COMPREHENSION CHECK</div>
            <h3 class="read-title">读后验收</h3>
          </div>
        </div>
        <!-- stagger:题干/选项/反馈沿 45ms 级联进场,与车厢轨道同一节拍 -->
        <div v-for="(q, qi) in p.questions" :key="qi" class="quiz-item stagger">
          <div class="quiz-q">{{ qi + 1 }}. {{ q.q }}</div>
          <div class="rv-options">
            <button
              v-for="(o, oi) in q.options" :key="oi"
              class="rv-opt" :class="optCls(qi, oi, q)"
              :disabled="answered[qi] !== undefined" @click="pick(qi, oi)"
            >{{ o }}</button>
          </div>
          <div v-if="answered[qi] !== undefined" class="rv-feedback fade-in">
            <span v-if="results[qi]" class="ok">答对了。{{ q.explain }}</span>
            <template v-else>
              <span class="no">不对。{{ q.explain }}</span>
              <button class="btn small ghost quiz-back" @click="backToCars">回车厢再读一遍</button>
            </template>
          </div>
        </div>
        <!-- 结算仪式:列车到站——环长满 + 上次这篇对比,WPM 面板在上方继续唱速度戏 -->
        <SettleCard
          v-if="submitted"
          :score="submitted.accuracy" :right="submitted.right" :total="submitted.total"
          :prev="submitted.prev" kicker="ARRIVED · 列车到站"
          :title="resultLine(submitted)"
        />
      </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
/* BlurText 接管「阅读号列车」入场:全局 terrRise 在本视图置空,避免双重动画 */
.terr-title { animation: none; }

/* 篇目挑选 hint(与回声谷/口语竞技场 signal-hint 同语言):前置一道金色小刻线,上车前的发车令 */
.scene-hint {
  font-family: var(--mono); font-size: var(--fs-2xs); letter-spacing: 0.2em;
  color: var(--text-3); margin-bottom: 8px;
}
.scene-hint::before {
  content: ''; display: inline-block; width: 18px; height: 1px;
  margin-right: 10px; vertical-align: 3px;
  background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--gold) 70%, transparent));
}

/* 本篇落点:领地命名式页头(mono kicker + 衬线标题)——阅读材料的名字值得衬线 */
.read-card { margin-bottom: 16px; }
.read-head {
  display: flex; justify-content: space-between; align-items: flex-end;
  gap: 16px; flex-wrap: wrap; margin-bottom: 16px;
}
.read-head-main { min-width: 0; }
.read-kicker {
  font-family: var(--mono); font-size: var(--fs-2xs); font-weight: 600;
  letter-spacing: 0.22em; color: var(--accent); margin-bottom: 8px;
}
.read-title {
  font-family: var(--serif);
  font-size: clamp(22px, 2.6vw, 28px); font-weight: 600;
  letter-spacing: 0.04em; line-height: 1.15; color: var(--text); margin: 0;
}

/* 图例:高亮规则用真实样式演示(所标即所得),不另发明一套说明色 */
.reading-hint { color: var(--text-3); font-size: var(--fs-xs); line-height: 2; margin: 0 0 16px; }
.hint-sample {
  display: inline-block; padding: 0 4px; margin: 0 2px; border-radius: 4px;
  color: var(--accent); background: color-mix(in srgb, var(--accent) 9%, transparent);
  border-bottom: 2px solid color-mix(in srgb, var(--accent) 45%, transparent);
}
.hint-sample.known {
  color: var(--success); background: color-mix(in srgb, var(--success) 10%, transparent);
  border-bottom-color: color-mix(in srgb, var(--success) 45%, transparent);
}
/* 选单上的「已学/词库词」统计(只在用户有学习记录后出现);彩底上的字走 --on-accent,暖夜不翻车 */
.pp-stat { margin-left: 7px; font-size: var(--fs-2xs); font-family: var(--mono); color: var(--text-3); font-variant-numeric: tabular-nums }
.passage-pick.active .pp-stat { color: color-mix(in srgb, var(--on-accent) 72%, transparent) }
.play-btn svg { width: 13px; height: 13px; }
.stop-read-btn { display: inline-flex; align-items: center; gap: 5px; }
.stop-read-btn svg { width: 11px; height: 11px; }
/* 卡片头右侧 meta 行 */
.head-meta { display: flex; gap: 8px; align-items: center; flex-wrap: wrap }

/* 短文加载骨架 */
.sk-pick { height: 30px; border-radius: 8px; }
.sk-line { border-radius: 8px; }

/* 阅读速度(WPM)结算:仪器读数台 —— 大号 mono 数字滚动 + 点阵仪表底纹
   (纸面正文区不放点阵,密度只给仪器) */
.wpm-panel { position: relative; margin: 0 0 16px; padding: 16px; border-radius: var(--r-lg); background: var(--surface-sunken); border: 1px solid var(--line) }
.wpm-gauge { display: flex; align-items: center; gap: 24px; flex-wrap: wrap }
.wpm-big { display: flex; flex-direction: column; flex-shrink: 0; animation: ringPop 0.55s var(--ease-squish-2) backwards }
.wpm-big b {
  font-family: var(--mono); font-size: 40px; font-weight: 700; line-height: 1;
  font-variant-numeric: tabular-nums; letter-spacing: -0.02em;
}
.wpm-big.ok b {
  color: var(--gold); /* 达标 = 点亮:大数字走金,不再用绿(绿留给条与 chip 语义) */
  text-shadow: 0 0 24px color-mix(in srgb, var(--gold) 25%, transparent);
}
.wpm-big.warn b { color: var(--warn) }
.wpm-big > span {
  font-family: var(--mono); font-size: var(--fs-2xs); letter-spacing: 0.2em;
  color: var(--text-3); margin-top: 8px;
}
.wpm-detail { flex: 1; min-width: 240px; }
.wpm-line { font-size: var(--fs-sm); display: flex; align-items: center; gap: 8px; flex-wrap: wrap }
.wpm-note { margin-top: 8px; font-size: var(--fs-sm); color: var(--text-2); line-height: 1.7 }
/* 速度轨:素台升仪器 —— accent 起的渐变底轨 + 终点一块亮点刻度(满程标记),不再是整根哑轨 */
.wpm-bar {
  position: relative; margin-top: 12px; height: 8px; border-radius: 999px;
  background: linear-gradient(to right, color-mix(in srgb, var(--accent) 12%, var(--surface-active)), var(--surface-active) 72%);
  overflow: hidden;
}
.wpm-bar::after {
  content: ''; position: absolute; right: 0; top: 1px; bottom: 1px; width: 3px; border-radius: 2px;
  background: color-mix(in srgb, var(--accent) 70%, transparent);
  box-shadow: 0 0 6px color-mix(in srgb, var(--accent) 40%, transparent);
}
/* 达标时终点亮点块换金并加辉光:WPM 轨道尽头的「金刻度」 */
.wpm-bar.hit::after {
  background: var(--gold);
  box-shadow: 0 0 8px color-mix(in srgb, var(--gold) 55%, transparent);
}
.wpm-bar i { display: block; height: 100%; border-radius: 999px; transition: width 0.9s var(--ease-out-4) }
.wpm-bar i.wpm-ok { background: var(--grad-success) }
.wpm-bar i.wpm-warn { background: var(--grad-warm) }
@keyframes ringPop { from { transform: scale(0.6); opacity: 0 } }

/* 理解题 */
.quiz-item { margin-bottom: 16px }
.quiz-q { margin-bottom: 8px }
.quiz-back { margin-left: 10px; }
/* 反馈行:答对/答错的色字外套一层极淡同色底 —— 一行字升格成「回执条」,不新造色 */
.rv-feedback .ok {
  background: color-mix(in srgb, var(--success) 8%, transparent);
  padding: 2px 9px; border-radius: 7px;
}
.rv-feedback .no {
  background: color-mix(in srgb, var(--danger) 8%, transparent);
  padding: 2px 9px; border-radius: 7px;
}
.quiz-summary { font-weight: 700; margin-top: 10px }
.quiz-summary.good { color: var(--success) }
.quiz-summary.warn { color: var(--warn) }

/* 车厢式进度:左缘铁轨 —— 底轨 + 每 8px 一道枕木刻线,绿色填充是走过的路段 */
.train-wrap { position: relative; padding-left: 24px; }
.train-progress {
  position: absolute; left: 6px; top: 16px; bottom: 16px; width: 3px;
  border-radius: 2px; background: var(--surface-active); overflow: visible;
}
.train-progress::before {
  content: ''; position: absolute; inset: 0; border-radius: 2px;
  background: repeating-linear-gradient(to bottom, transparent 0 7px, color-mix(in srgb, var(--text-3) 20%, transparent) 7px 8px);
}
.tp-fill {
  position: absolute; top: 0; left: 0; width: 3px; border-radius: 2px;
  background: linear-gradient(to bottom, color-mix(in srgb, var(--success) 40%, transparent), var(--success));
  transition: height 0.6s var(--ease-out-4);
}
.tp-thumb {
  position: absolute; left: -3.5px; width: 10px; height: 10px; border-radius: 50%;
  transform: translateY(-50%);
  background: var(--accent); box-shadow: 0 0 8px color-mix(in srgb, var(--accent) 55%, transparent);
  animation: tpBreath 2s ease-in-out infinite;
  transition: background 0.3s var(--ease-out-3);
}
.tp-thumb.read { background: var(--success); box-shadow: 0 0 8px color-mix(in srgb, var(--success) 55%, transparent); }
@keyframes tpBreath { 0%, 100% { opacity: 0.55 } 50% { opacity: 1 } }
/* 车厢:进站级联(sigRise 逐节上浮,与信号轨道同一语汇) */
.train-track { display: flex; flex-direction: column; gap: 12px }
.train-track > * { animation: sigRise 0.5s var(--ease-out-4) backwards; animation-delay: calc(var(--i, 0) * 45ms); }
.train-car {
  display: flex; gap: 16px; padding: 16px 20px; border-radius: var(--r-md); align-items: flex-start;
  background: var(--surface-sunken); border: 1px solid var(--line);
  transition: background 0.25s var(--ease-out-3), border-color 0.25s var(--ease-out-3),
    transform 0.25s var(--ease-out-3), box-shadow 0.25s var(--ease-out-3);
}
/* 车厢悬浮:整节轻抬 1px,像磁悬浮过弯的一拍(与全站 hover 升起同语言,幅度取小档) */
.train-car:hover { transform: translateY(-1px); box-shadow: var(--shadow-sm); }
.train-car.current {
  border-color: color-mix(in srgb, var(--accent) 28%, transparent);
  /* 当前车厢:accent 内衬微光 + 外缘淡晕 —— 「这节正在精读」 */
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 16%, transparent),
    0 0 18px color-mix(in srgb, var(--accent) 10%, transparent);
}
.train-car.read { background: color-mix(in srgb, var(--success) 6%, transparent); border-color: color-mix(in srgb, var(--success) 30%, transparent); }
.car-num {
  width: 28px; height: 28px; border-radius: var(--r-sm); display: flex; align-items: center; justify-content: center;
  font-family: var(--mono); font-size: var(--fs-xs); color: var(--accent);
  background: color-mix(in srgb, var(--accent) 10%, transparent); border: 1px solid color-mix(in srgb, var(--accent) 30%, transparent);
  flex-shrink: 0;
}
.train-car.read .car-num { background: color-mix(in srgb, var(--success) 18%, transparent); color: var(--success); border-color: color-mix(in srgb, var(--success) 40%, transparent); }
.car-body { flex: 1; min-width: 0 }
/* 正文是「纸」:流式字号(16→24px 随视口)+ 60ch 版心 + 宽行距 —— 分级读物的大字排版,
   点阵密度为零,纸面只靠版心/行距/段距立住可读性 */
.sentence-en {
  font-size: var(--font-size-fluid-1); line-height: 1.85;
  word-break: break-word; letter-spacing: 0.005em; max-width: 60ch;
}
.sentence-zh { font-size: var(--fs-base); color: var(--text-3); margin-top: 8px; line-height: 1.8; max-width: 60ch }
.car-actions { display: flex; gap: 8px; margin-top: 8px }

/* 生词高亮:纸上的批注笔 —— 底色轻、下缘一道笔触;已学的词换绿墨 */
.word-vocab {
  display: inline-block; padding: 0 4px; margin: 0 1px; border-radius: 4px; cursor: pointer;
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 9%, transparent);
  border-bottom: 2px solid color-mix(in srgb, var(--accent) 45%, transparent);
  transition: background 0.2s var(--ease-out-3), border-bottom-color 0.2s var(--ease-out-3);
}
.word-vocab:hover { background: color-mix(in srgb, var(--accent) 22%, transparent); border-bottom-color: var(--accent); }
.word-vocab.known { color: var(--success); background: color-mix(in srgb, var(--success) 10%, transparent); border-bottom-color: color-mix(in srgb, var(--success) 45%, transparent); }
.word-vocab.known:hover { background: color-mix(in srgb, var(--success) 18%, transparent); border-bottom-color: var(--success); }
.word-plain { color: inherit; }

/* 词库外的词也点得开:更淡的点线(词库词是金色块),点开走 AI 五维讲解 */
.word-vocab.any {
  color: var(--text-2);
  background: transparent;
  border-bottom: 1px dotted color-mix(in srgb, var(--text-3) 38%, transparent);
}
.word-vocab.any:hover { color: var(--text); background: color-mix(in srgb, var(--accent) 6%, transparent); border-bottom-color: var(--text-3); }

/* 任意词 AI 卡字段行(解释/记法/技巧/运用/语法):与句法透镜同一语言 */
.any-pop { margin: 10px 0 4px; }
.wa-scan { display: flex; align-items: center; gap: 10px; margin: 10px 0 4px; font-size: var(--fs-2xs); color: var(--text-3); letter-spacing: 0.14em; }
.wa-bar { flex: 1; height: 2px; background: var(--surface-sunken); border-radius: 1px; overflow: hidden; }
.wa-bar i { display: block; height: 100%; width: 30%; background: var(--accent); animation: waScan 1.4s ease-in-out infinite; }
@keyframes waScan { 0% { transform: translateX(-100%) } 100% { transform: translateX(330%) } }
.wa-error { margin: 10px 0 4px; font-size: var(--fs-xs); color: var(--warn); line-height: 1.6; }
.wa-row { display: grid; grid-template-columns: 44px 1fr; gap: 10px; padding: 7px 0; border-bottom: 1px dashed var(--line); }
.wa-tag { font-size: var(--fs-2xs); color: var(--accent); letter-spacing: 0.08em; align-self: start; padding-top: 2px; }
.wa-row p { font-size: var(--fs-sm); line-height: 1.7; color: var(--text); margin: 0; }
.wa-foot { margin-top: 8px; font-size: var(--fs-2xs); letter-spacing: 0.16em; color: var(--text-3); }

/* 词卡旁注:内联展开在车厢里,正文自动让位 —— 零遮挡 */
.word-pop { width: min(620px, 100%); margin: 12px 0 4px; padding: 22px 24px 18px; animation: popIn 0.18s var(--ease) }
@keyframes popIn { from { transform: scale(0.97); opacity: 0 } to { transform: scale(1); opacity: 1 } }
.pop-actions { margin-top: 14px; gap: 8px; justify-content: flex-start }
.pop-tools { display: flex; gap: 6px; margin: 12px 0 4px; }

/* 词卡:常用搭配(目标词高亮)+ 同根相关词 */
.collo-en { font-size: var(--fs-base) }
.collo-en :deep(.collo-hit) {
  color: var(--accent); background: var(--accent-soft);
  padding: 0 4px; border-radius: 5px; font-weight: 700;
}
.family-row { display: flex; gap: 8px; flex-wrap: wrap }
.family-chip {
  display: flex; align-items: baseline; gap: 8px; padding: 7px 12px;
  border-radius: 10px; cursor: pointer; font-family: inherit;
  background: var(--surface); border: 1px dashed var(--line-strong);
  color: var(--text); font-size: var(--fs-sm); transition: all 0.2s var(--ease);
}
.family-chip:hover { background: var(--accent-soft); border-color: var(--accent); border-style: solid; transform: translateY(-1px) }
.family-chip b { font-size: var(--fs-base); color: var(--accent) }
.fam-zh { color: var(--text-3); font-size: var(--fs-xs) }
.fam-lv { font-family: var(--mono); font-size: var(--fs-2xs); color: var(--text-3) }
</style>
