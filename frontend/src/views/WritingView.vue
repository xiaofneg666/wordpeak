<script setup>
// 写作工坊(费曼输出法:把学到的词写成句子,把句子写成段落)
// 两阶段:① 造句(单词规则打分) ② 成文(主题+目标词家族段落)
// 提交后进入「批注稿」:原文逐句渲染,AI 教练的 issue/tip 锚定回原句(问题句琥珀左缘、
// 点击展开批注),命中的目标词绿色高亮——批改与原文不再割裂
// 航行日志:GET /writing/history 最近 N 篇,均分/最高分/分数趋势线,旧文可回看
import { computed, ref, onMounted, onActivated } from 'vue'
import HowToTrain from '../components/HowToTrain.vue'
import { useUniverse } from '../stores/universe'
import { speak } from '../speech'
import { message } from '../ui'
import EmptyState from '../components/EmptyState.vue'
import { api } from '../api'

const store = useUniverse()
const stage = ref('sentence')

// ===== 阶段 1:造句 =====
// 抽词策略:优先待复习/快忘了/学习中,优先选中等级高(巩固)— 新词太难写不出,巩固复习的反而好测试
function pickSentenceWord() {
  const learned = store.words.filter((w) => {
    const s = store.states[w.id]
    return s && !s.is_new
  })
  const due = learned.filter((w) => store.states[w.id]?.due)
  const pool = (due.length ? due : learned).length ? (due.length ? due : learned) : store.words
  return pool[Math.floor(Math.random() * pool.length)]
}

const sentenceStage = ref({
  word: null,           // 当前目标词
  text: '',            // 用户输入
  feedback: null,      // 上次评分详情
  ai: null,            // AI 教练批改
  review: null,        // 批注稿(逐句 + 锚定批注 + 目标词高亮)
  editing: true,       // false = 批注稿视图,「继续修改」回 true
  busy: false,
})

function newSentence() {
  sentenceStage.value.word = pickSentenceWord()
  sentenceStage.value.text = ''
  sentenceStage.value.feedback = null
  sentenceStage.value.ai = null
  sentenceStage.value.review = null
  sentenceStage.value.editing = true
  saveDraft()
}

// 简单词形变化:look/looks/looked/looking 等基础屈折(够日常词汇,后续可扩 lemmatizer)
const INFLECTIONS = (w) => {
  const l = w.toLowerCase()
  const set = new Set([l])
  if (l.endsWith('y')) { set.add(l.slice(0, -1) + 'ies'); set.add(l.slice(0, -1) + 'ied'); set.add(l.slice(0, -1) + 'ier'); set.add(l + 'ing'); set.add(l + 's') }
  else if (/[sxz]$|[cs]h$/.test(l)) { set.add(l + 'es'); set.add(l.slice(0, -1) + 'ing'); set.add(l.slice(0, -2) + 'ed'); set.add(l) }
  else { set.add(l + 's'); set.add(l + 'ing'); set.add(l + 'ed') }
  return [...set]
}

// 造句评分:5 项加权(总分 0-1)
function gradeSentence(word, text) {
  const checks = []
  const t = text.trim()
  if (!t) return { score: 0, checks: [{ ok: false, msg: '还没写东西', weight: 1 }] }
  const tokenRe = /[A-Za-z']+/g
  const tokens = (t.toLowerCase().match(tokenRe) || [])
  const has = INFLECTIONS(word).some((v) => tokens.includes(v.replace(/[^a-z]/g, '')))
  checks.push({ ok: has, msg: has ? `用上了「${word}」(含词形变化)` : `没找到「${word}」或其常见变形`, weight: 0.25 })
  const cap = /^[A-Z]/.test(t)
  checks.push({ ok: cap, msg: cap ? '句首大写' : '句首字母要大写', weight: 0.15 })
  const punct = /[.!?]$/.test(t)
  checks.push({ ok: punct, msg: punct ? '有句末标点' : '句末加 . / ! / ? 收尾', weight: 0.10 })
  const len = tokens.length
  const lenOk = len >= 3 && len <= 25
  checks.push({
    ok: lenOk, weight: 0.25,
    msg: len < 3 ? `只有 ${len} 个词,句子太短` : len > 25 ? `${len} 个词,更像段落不像句子了` : `${len} 个词,长度合适`,
  })
  const hasCJK = /[一-鿿]/.test(t)
  checks.push({ ok: !hasCJK, msg: hasCJK ? '中英文混排了 — 用英语写就行' : '纯英文', weight: 0.15 })
  const avgLen = tokens.length ? tokens.reduce((a, w) => a + w.length, 0) / tokens.length : 0
  const wordsReal = avgLen >= 3
  checks.push({
    ok: wordsReal, weight: 0.10,
    msg: avgLen >= 3 ? '词形完整' : `平均词长 ${avgLen.toFixed(1)},像是没写完整`,
  })
  const score = checks.reduce((s, c) => s + (c.ok ? c.weight : 0), 0)
  return { score: Math.round(score * 100) / 100, checks }
}

// ===== 批注稿:把 AI 批改锚定回原句 =====
// 句子切分与后端 localGrade 同规则(?<=[.!?])\s+;锚定用归一化包含匹配(LLM 可能改写原句)
const normFor = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '')

function anchorNote(textParts, a) {
  const an = normFor(a.en || '')
  let best = -1
  let bestLen = 0
  textParts.forEach((p, i) => {
    const pn = normFor(p)
    if (!an || !pn) return
    let l = 0
    if (pn.includes(an)) l = an.length
    else if (an.includes(pn)) l = pn.length
    else {
      const head = an.slice(0, 12) // LLM 常截断/改写句尾,句头滑窗兜底
      if (head.length >= 6 && pn.includes(head)) l = head.length
    }
    if (l > bestLen) { bestLen = l; best = i }
  })
  return bestLen >= 5 ? best : -1
}

const escapeHtml = (x) => String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
// 目标词命中高亮:与阅读舱 .known 同语言(绿色),只动颜色不动布局
function sentenceHtml(sentence, forms) {
  const set = new Set(forms.map((f) => String(f).toLowerCase().replace(/[^a-z']/g, '')))
  let html = ''
  const re = /[A-Za-z']+/g
  let last = 0
  let m
  while ((m = re.exec(sentence))) {
    html += escapeHtml(sentence.slice(last, m.index))
    html += set.has(m[0].toLowerCase()) ? `<b class="ms-hit">${escapeHtml(m[0])}</b>` : escapeHtml(m[0])
    last = re.lastIndex
  }
  html += escapeHtml(sentence.slice(last))
  return html
}

function buildReview(text, ai, forms) {
  const parts = String(text).trim().split(/(?<=[.!?])\s+/).filter(Boolean)
  const notes = parts.map(() => [])
  const loose = []
  if (ai?.sentences?.length) {
    for (const a of ai.sentences) {
      if (!a.issue && !a.tip) continue
      const idx = anchorNote(parts, a)
      if (idx >= 0) notes[idx].push({ issue: a.issue, tip: a.tip })
      else loose.push({ issue: a.issue, tip: a.tip })
    }
  }
  let noteNo = 0
  const sentences = parts.map((p, i) => {
    const flagged = notes[i].length > 0
    if (flagged) noteNo += 1
    return { html: sentenceHtml(p, forms), notes: notes[i], no: flagged ? noteNo : 0, open: false, flagged }
  })
  return { sentences, loose, noteCount: noteNo, advice: ai?.advice || '' }
}

async function submitSentence() {
  if (!sentenceStage.value.word) return
  sentenceStage.value.busy = true
  const r = gradeSentence(sentenceStage.value.word.word, sentenceStage.value.text)
  sentenceStage.value.feedback = r
  let ai = null
  try {
    ai = await api.gradeWriting({ text: sentenceStage.value.text, stage: 'sentence', word: sentenceStage.value.word.word })
    sentenceStage.value.ai = ai
  } catch { sentenceStage.value.ai = null }
  sentenceStage.value.review = buildReview(sentenceStage.value.text, ai, INFLECTIONS(sentenceStage.value.word.word))
  sentenceStage.value.editing = false
  sentenceStage.value.busy = false
  try {
    await store.api_submitWriting({ stage: 'sentence', word_id: sentenceStage.value.word.id, score: r.score, text: sentenceStage.value.text, feedback: r.checks })
    message.success(`已提交 · ${Math.round(r.score * 100)} 分`)
    loadHistory()
  } catch { message.warning('提交失败,可能后端不可用,但本轮批改已显示') }
}

// ===== 阶段 2:成文 =====
// 题目:从一个词根家族抽 4 个词作为「必须用上的词」,给一段中英文主题提示
const ESSAY_TOPICS = [
  { root: 'spect', name: '看', hint: 'Write a short paragraph about something you watched this week. How did it look? Did you enjoy watching it?' },
  { root: 'port', name: '携带', hint: 'Tell me what you carry every day. What does it mean to you to carry these things?' },
  { root: 'dict', name: '说', hint: 'Describe a time you had to say something important. What did you say?' },
  { root: 'struct', name: '建造', hint: 'Describe something you built or made — a physical thing or a habit.' },
  { root: 'vis', name: '看', hint: 'Tell me about a memorable person you saw. What did they look like? How did seeing them affect you?' },
  { root: 'phon', name: '声音', hint: 'Describe a sound you like. Why does that sound appeal to you?' },
  { root: 'graph', name: '写', hint: 'Write a short paragraph about something you wrote this week.' },
  { root: 'scrib', name: '写', hint: 'Talk about something you wrote — an email, a note, a diary entry.' },
]

const essayStage = ref({
  topic: ESSAY_TOPICS[0],
  wordIds: [],
  text: '',
  feedback: null,
  ai: null,
  review: null,
  editing: true,
  busy: false,
})

function pickWordIdsByRoot(root) {
  const candidates = store.words.filter((w) => w.root === root)
  const learned = candidates.filter((w) => store.states[w.id] && !store.states[w.id].is_new)
  // 学过的优先(检验会用),但不足 4 个时用家族其他词补齐——目标词永远出满 4 张牌
  const pool = [...learned, ...candidates.filter((w) => !learned.includes(w))]
  const base = pool.length ? pool : store.words
  const arr = [...base]
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr.slice(0, 4).map((w) => w.id)
}

function newEssay() {
  const t = ESSAY_TOPICS[Math.floor(Math.random() * ESSAY_TOPICS.length)]
  essayStage.value.topic = t
  essayStage.value.wordIds = pickWordIdsByRoot(t.root)
  essayStage.value.text = ''
  essayStage.value.feedback = null
  essayStage.value.ai = null
  essayStage.value.review = null
  essayStage.value.editing = true
  saveDraft()
}

const targetWords = computed(() => {
  const m = new Map(store.words.map((w) => [w.id, w]))
  return essayStage.value.wordIds.map((id) => m.get(id)).filter(Boolean)
})

// 提交后目标词 chip 的命中态(绿=用上 / 灰=没用上)
const hitMap = computed(() => {
  const hits = essayStage.value.feedback?.targetHits
  if (!hits) return {}
  return Object.fromEntries(hits.map((h) => [h.word, h.hit]))
})

// 段落评分
function gradeEssay(topic, targetWordIds, text) {
  const checks = []
  const t = text.trim()
  if (!t) return { score: 0, checks: [{ ok: false, msg: '还没写东西', weight: 1 }], targetHits: [] }
  const tokenRe = /[A-Za-z']+/g
  const tokens = (t.match(tokenRe) || [])
  const lowerTokens = tokens.map((x) => x.toLowerCase())
  const sentences = t.split(/[.!?]+\s+/).map((s) => s.trim()).filter(Boolean)

  const m = new Map(store.words.map((w) => [w.id, w]))
  const targetHits = targetWordIds.map((id) => {
    const w = m.get(id)
    if (!w) return { word: null, hit: false }
    const forms = INFLECTIONS(w.word)
    return { word: w.word, hit: forms.some((v) => lowerTokens.includes(v.replace(/[^a-z']/g, ''))) }
  })
  const hits = targetHits.filter((x) => x.hit).length
  const coverage = targetWordIds.length ? hits / targetWordIds.length : 0
  checks.push({ ok: coverage >= 0.75, weight: 0.35, msg: `用了 ${hits}/${targetWordIds.length} 个目标词` })
  const wc = tokens.length
  checks.push({ ok: wc >= 40, weight: 0.15, msg: wc >= 40 ? `共 ${wc} 个词,够一篇` : `只有 ${wc} 个词,要求 ≥ 40 词` })
  const sc = sentences.length
  checks.push({ ok: sc >= 3, weight: 0.10, msg: sc >= 3 ? `${sc} 个句子` : `只有 ${sc} 个句子,要求 ≥ 3 句` })
  const avgSen = sc ? wc / sc : 0
  checks.push({ ok: avgSen >= 5 && avgSen <= 25, weight: 0.10, msg: avgSen < 5 ? `平均句长 ${avgSen.toFixed(1)},太碎` : avgSen > 25 ? `平均句长 ${avgSen.toFixed(1)},像一段砸在一起` : `平均句长 ${avgSen.toFixed(1)} 词,刚好` })
  const unique = new Set(lowerTokens).size
  const ttr = lowerTokens.length ? unique / lowerTokens.length : 0
  checks.push({ ok: ttr >= 0.55, weight: 0.10, msg: `词形多样性 ${(ttr * 100).toFixed(0)}%${ttr >= 0.55 ? '' : ',像在用 the/the/the… 换点不同词'}` })
  const caps = sentences.filter((s) => /^[A-Z]/.test(s)).length
  const capOk = sc && caps >= Math.max(1, sc - 1)
  checks.push({ ok: capOk, weight: 0.10, msg: capOk ? '每句首字母大写' : `有 ${sc - caps} 个句首没大写` })
  const hasCJK = /[一-鿿]/.test(t)
  checks.push({ ok: !hasCJK, weight: 0.10, msg: hasCJK ? '中英文混排了 — 写作应该是英文' : '纯英文' })
  const score = checks.reduce((s, c) => s + (c.ok ? c.weight : 0), 0)
  return { score: Math.round(score * 100) / 100, checks, targetHits }
}

async function submitEssay() {
  if (!essayStage.value.topic) return
  essayStage.value.busy = true
  const r = gradeEssay(essayStage.value.topic, essayStage.value.wordIds, essayStage.value.text)
  essayStage.value.feedback = r
  const wordTexts = essayStage.value.wordIds.map((id) => store.words.find((w) => w.id === id)?.word).filter(Boolean)
  let ai = null
  try {
    ai = await api.gradeWriting({ text: essayStage.value.text, stage: 'essay', word_ids: wordTexts })
    essayStage.value.ai = ai
  } catch { essayStage.value.ai = null }
  const allForms = wordTexts.flatMap((w) => INFLECTIONS(w))
  essayStage.value.review = buildReview(essayStage.value.text, ai, allForms)
  essayStage.value.editing = false
  essayStage.value.busy = false
  try {
    await store.api_submitWriting({ stage: 'essay', score: r.score, text: essayStage.value.text, feedback: r.checks })
    try { localStorage.setItem('wv_first_essay', '1') } catch {} // 终身成就标记(DailyQuests 读)
    message.success(`已提交 · ${Math.round(r.score * 100)} 分`)
    loadHistory()
  } catch { message.warning('提交失败,本轮批改仍可见') }
}

// ===== 航行日志(写作历史)=====
const history = ref([])
const openLogId = ref(null)

async function loadHistory() {
  if (!store.user?.id) return
  try {
    const r = await api.historyWriting(store.user.id, 30)
    history.value = Array.isArray(r?.items) ? r.items : []
  } catch { /* 后端旧版无此接口,静默 */ }
  // 错题本「再写」深链:带上 pendingWritingId 进来时,自动展开那篇低分文
  if (store.pendingWritingId) {
    if (history.value.some((h) => h.id === store.pendingWritingId)) openLogId.value = store.pendingWritingId
    store.pendingWritingId = null
  }
}

// 旧→新,画趋势线(最新一颗点加重)
const spark = computed(() => {
  const rows = [...history.value].reverse()
  if (rows.length < 2) return null
  const W = 300
  const H = 56
  const pad = 5
  const pts = rows.map((r, i) => [
    pad + (i / (rows.length - 1)) * (W - pad * 2),
    H - pad - (Math.max(0, Math.min(1, r.score)) || 0) * (H - pad * 2),
  ])
  return {
    line: pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' '),
    last: pts[pts.length - 1],
    w: W, h: H,
  }
})

const logStats = computed(() => {
  if (!history.value.length) return null
  const scores = history.value.map((h) => h.score)
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length
  return {
    count: history.value.length,
    avg: Math.round(avg * 100),
    best: Math.round(Math.max(...scores) * 100),
  }
})

// ===== 草稿缓存:离开页面不丢 =====
const DRAFT_KEY = 'wv_writing_draft'
function saveDraft() {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({
      sentence: { wordId: sentenceStage.value.word?.id ?? null, text: sentenceStage.value.text },
      essay: { root: essayStage.value.topic?.root ?? null, wordIds: essayStage.value.wordIds, text: essayStage.value.text },
    }))
  } catch { /* 隐私模式等,忽略 */ }
}

function restoreDraft() {
  try {
    const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null')
    if (!d) return
    if (d.sentence) {
      const w = d.sentence.wordId ? store.words.find((x) => x.id === d.sentence.wordId) : null
      if (w) sentenceStage.value.word = w
      if (typeof d.sentence.text === 'string' && d.sentence.text) sentenceStage.value.text = d.sentence.text
    }
    if (d.essay) {
      const t = ESSAY_TOPICS.find((x) => x.root === d.essay.root)
      if (t) essayStage.value.topic = t
      const ids = (d.essay.wordIds || []).filter((id) => store.words.some((w) => w.id === id))
      if (ids.length) essayStage.value.wordIds = ids
      if (typeof d.essay.text === 'string' && d.essay.text) essayStage.value.text = d.essay.text
    }
  } catch { /* 脏数据忽略 */ }
}

onMounted(() => {
  restoreDraft()
  if (!sentenceStage.value.word) newSentence()
  if (!essayStage.value.wordIds.length) newEssay()
})
// KeepAlive:回工坊刷新历史(也消费错题本「再写」深链的 pendingWritingId)
onActivated(() => { loadHistory() })
</script>

<template>
  <div class="view-scroll">
    <div class="view-inner fade-in">
      <div class="terr-head">
        <div class="terr-kicker">TERRITORY · WRITING</div>
        <h2 class="terr-title"><BlurText text="写作工坊" as="span" /></h2>
        <div class="terr-latin">WRITING WORKSHOP</div>
        <div class="terr-rule" aria-hidden="true" />
        <p class="terr-sub">
          费曼输出法——把学到的词写成句子，把句子写成段落。造句检验会用，成文检验能用。
          提交后进入批注稿：AI 教练逐句圈点，命中的目标词会亮起来，结果计入写作画像。
        </p>
      </div>

      <!-- 怎么练才有效:方法论条(收起一行,展开步骤) -->
      <HowToTrain view="writing" />

      <div class="stage-tabs">
        <button class="stage-tab" :class="{ active: stage === 'sentence' }" @click="stage = 'sentence'">① 造句</button>
        <button class="stage-tab" :class="{ active: stage === 'essay' }" @click="stage = 'essay'">② 成文</button>
      </div>

      <template v-if="stage === 'sentence'">
        <div v-if="!sentenceStage.word" class="card">
          <EmptyState title="还没有目标词" desc="抽个学过/待复习的词" />
          <div style="text-align: center; margin-top: 14px">
            <button class="btn primary" @click="newSentence">抽一个词</button>
          </div>
        </div>
        <div v-else class="card writing-card">
          <div class="word-strip dots-host">
            <span class="dots-decor dots-fade" aria-hidden="true" style="--dots-o:.2" />
            <div class="word-strip-label">TARGET WORD · 本轮目标词</div>
            <div class="word-strip-word">
              <span class="ws-word" :key="sentenceStage.word.id">{{ sentenceStage.word.word }}</span>
              <span class="ipa ws-ipa">{{ sentenceStage.word.ipa }}</span>
              <span class="ws-meaning">{{ sentenceStage.word.meaning }}</span>
              <button class="play-btn" @click="speak(sentenceStage.word.word)" title="听发音">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/></svg>
              </button>
            </div>
            <button class="btn small ghost" @click="newSentence" :disabled="sentenceStage.busy">换一个</button>
          </div>

          <div v-if="sentenceStage.word.examples?.length" class="ref-block">
            <div class="ref-label">先看这个词的例句(可以参考,但要自己写):</div>
            <div v-for="(e, i) in sentenceStage.word.examples.slice(0, 2)" :key="i" class="ref-example">
              <div class="ref-en">{{ e.en }}</div>
              <div class="ref-zh">{{ e.zh }}</div>
            </div>
          </div>

          <template v-if="sentenceStage.editing">
            <textarea
              v-model="sentenceStage.text" class="writing-textarea" rows="3"
              placeholder="在这里写一句包含这个词的英文句子…"
              @input="saveDraft"
            />
            <div class="writing-actions">
              <button class="btn primary" :disabled="!sentenceStage.text.trim() || sentenceStage.busy" @click="submitSentence">
                {{ sentenceStage.busy ? '教练批改中…' : '提交 · 批注稿' }}
              </button>
              <button class="btn ghost" @click="speak(sentenceStage.text)" :disabled="!sentenceStage.text.trim()">朗读我的句子</button>
            </div>
          </template>

          <!-- 批注稿:原句 + 锚定批注 + 目标词高亮(批改与原文同屏) -->
          <div v-if="sentenceStage.review && !sentenceStage.editing" class="manuscript">
            <div class="ms-head">
              <span class="ms-tag">批注稿</span>
              <span v-if="sentenceStage.review.noteCount" class="ms-meta">{{ sentenceStage.review.noteCount }} 处批注 · 点击句子展开</span>
              <span v-else class="ms-meta">没有发现明显问题</span>
              <button class="btn small ghost ms-edit" @click="sentenceStage.editing = true">继续修改</button>
            </div>
            <p
              v-for="(s, i) in sentenceStage.review.sentences" :key="i"
              class="ms-sentence" :class="{ flagged: s.flagged }"
              :style="{ '--i': Math.min(i, 12) }"
              @click="s.flagged && (s.open = !s.open)"
            >
              <span v-if="s.flagged" class="ms-no">{{ s.no }}</span>
              <span class="ms-text" v-html="s.html" />
              <template v-if="s.flagged && s.open">
                <span v-for="(n, j) in s.notes" :key="j" class="ms-notes">
                  <span class="ms-issue">{{ n.issue }}</span>
                  <span class="ms-tip">{{ n.tip }}</span>
                </span>
              </template>
            </p>
            <span v-for="(n, j) in sentenceStage.review.loose" :key="'l' + j" class="ms-notes loose">
              <span class="ms-issue">{{ n.issue }}</span>
              <span class="ms-tip">{{ n.tip }}</span>
            </span>
            <p v-if="sentenceStage.review.advice" class="ms-advice">教练寄语 — {{ sentenceStage.review.advice }}</p>
          </div>

          <div v-if="sentenceStage.feedback" class="grade fade-in">
            <!-- ≥0.85 高分:分数环换金 —— 高分=点亮(与圣殿塔尖灯同源) -->
            <div class="grade-score" :class="{ gold: sentenceStage.feedback.score >= 0.85 }" :style="{ '--sc': sentenceStage.feedback.score }">
              <div class="grade-score-inner">
                <b><CountNum :v="Math.round(sentenceStage.feedback.score * 100)" mono /></b><span>分</span>
              </div>
            </div>
            <ul class="grade-list">
              <li v-for="(c, i) in sentenceStage.feedback.checks" :key="i" :class="{ ok: c.ok }">
                <span class="grade-mark">{{ c.ok ? '✓' : '✗' }}</span>
                <span class="grade-msg">{{ c.msg }}</span>
              </li>
            </ul>
          </div>
        </div>
      </template>

      <template v-else>
        <div v-if="!essayStage.topic" class="card">
          <EmptyState title="还没有主题" desc="选个词根家族练一段" />
        </div>
        <div v-else class="card writing-card">
          <div class="essay-head">
            <div class="essay-topic">
              <span class="topic-tag">主题 · {{ essayStage.topic.name }} 家族</span>
              <p>{{ essayStage.topic.hint }}</p>
            </div>
            <button class="btn small ghost" @click="newEssay">换主题</button>
          </div>

          <div class="targets stagger">
            <span class="targets-label">本段要用到的词:</span>
            <span
              v-for="w in targetWords" :key="w.id" class="target-chip"
              :class="essayStage.feedback ? (hitMap[w.word] ? 'hit' : 'miss') : ''"
            >
              <b>{{ w.word }}</b>
              <span class="target-zh">{{ w.meaning?.split(/[,，;；]/)[0] }}</span>
              <span v-if="essayStage.feedback" class="target-mark">{{ hitMap[w.word] ? '✓' : '✗' }}</span>
            </span>
          </div>

          <template v-if="essayStage.editing">
            <textarea
              v-model="essayStage.text" class="writing-textarea" rows="10"
              placeholder="在这里写一段不少于 40 个词的英文(尽量用上面前 4 个目标词)…"
              @input="saveDraft"
            />
            <div class="writing-meta">
              <span>{{ (essayStage.text.match(/[A-Za-z']+/g) || []).length }} 词</span>
              <span>·</span>
              <span>{{ essayStage.text.split(/[.!?]+\s+/).filter(s => s.trim()).length }} 句</span>
            </div>
            <div class="writing-actions">
              <button class="btn primary" :disabled="!essayStage.text.trim() || essayStage.busy" @click="submitEssay">
                {{ essayStage.busy ? '教练批改中…' : '提交 · 批注稿' }}
              </button>
            </div>
          </template>

          <!-- 批注稿 -->
          <div v-if="essayStage.review && !essayStage.editing" class="manuscript">
            <div class="ms-head">
              <span class="ms-tag">批注稿</span>
              <span v-if="essayStage.review.noteCount" class="ms-meta">{{ essayStage.review.noteCount }} 处批注 · 点击句子展开 · 绿色 = 目标词命中</span>
              <span v-else class="ms-meta">没有发现明显问题 · 绿色 = 目标词命中</span>
              <button class="btn small ghost ms-edit" @click="essayStage.editing = true">继续修改</button>
            </div>
            <p
              v-for="(s, i) in essayStage.review.sentences" :key="i"
              class="ms-sentence" :class="{ flagged: s.flagged }"
              :style="{ '--i': Math.min(i, 12) }"
              @click="s.flagged && (s.open = !s.open)"
            >
              <span v-if="s.flagged" class="ms-no">{{ s.no }}</span>
              <span class="ms-text" v-html="s.html" />
              <template v-if="s.flagged && s.open">
                <span v-for="(n, j) in s.notes" :key="j" class="ms-notes">
                  <span class="ms-issue">{{ n.issue }}</span>
                  <span class="ms-tip">{{ n.tip }}</span>
                </span>
              </template>
            </p>
            <span v-for="(n, j) in essayStage.review.loose" :key="'l' + j" class="ms-notes loose">
              <span class="ms-issue">{{ n.issue }}</span>
              <span class="ms-tip">{{ n.tip }}</span>
            </span>
            <p v-if="essayStage.review.advice" class="ms-advice">教练寄语 — {{ essayStage.review.advice }}</p>
          </div>

          <div v-if="essayStage.feedback" class="grade fade-in">
            <div class="grade-score" :class="{ gold: essayStage.feedback.score >= 0.85 }" :style="{ '--sc': essayStage.feedback.score }">
              <div class="grade-score-inner">
                <b><CountNum :v="Math.round(essayStage.feedback.score * 100)" mono /></b><span>分</span>
              </div>
            </div>
            <ul class="grade-list">
              <li v-for="(c, i) in essayStage.feedback.checks" :key="i" :class="{ ok: c.ok }">
                <span class="grade-mark">{{ c.ok ? '✓' : '✗' }}</span>
                <span class="grade-msg">{{ c.msg }}</span>
              </li>
            </ul>
          </div>
        </div>
      </template>

      <!-- 航行日志:第 N 篇 · 均分 · 趋势 · 旧文回看 -->
      <div v-if="logStats" class="card logbook">
        <div class="log-head">
          <span class="log-tag">航行日志 · LOGBOOK</span>
          <span class="log-chips">
            <span class="chip dim">第 {{ logStats.count }} 篇</span>
            <span class="chip cyan">均分 {{ logStats.avg }}</span>
            <span class="chip amber">最高 {{ logStats.best }}</span>
          </span>
        </div>
        <svg v-if="spark" class="log-spark" :viewBox="`0 0 ${spark.w} ${spark.h}`" preserveAspectRatio="none" aria-hidden="true">
          <polyline :points="spark.line" fill="none" stroke="var(--accent)" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" />
          <circle :cx="spark.last[0]" :cy="spark.last[1]" r="3" fill="var(--accent)" />
        </svg>
        <ol class="log-list">
          <li
            v-for="h in history.slice(0, 8)" :key="h.id" class="log-item"
            :class="{ open: openLogId === h.id }"
            @click="openLogId = openLogId === h.id ? null : h.id"
          >
            <div class="log-row">
              <span class="log-date">{{ (h.date || '').slice(0, 10) }}</span>
              <span class="chip" :class="h.stage === 'essay' ? 'green' : 'cyan'">{{ h.stage === 'essay' ? '成文' : '造句' }}</span>
              <span class="log-score" :class="h.score >= 0.8 ? 'good' : h.score >= 0.5 ? 'mid' : 'low'">{{ Math.round(h.score * 100) }} 分</span>
              <span class="log-excerpt">{{ (h.text || '').replace(/\s+/g, ' ').slice(0, 60) }}{{ (h.text || '').length > 60 ? '…' : '' }}</span>
            </div>
            <div v-if="openLogId === h.id" class="log-detail">
              <p class="log-text">{{ h.text }}</p>
              <ul v-if="h.checks?.length" class="log-checks">
                <li v-for="(c, i) in h.checks" :key="i" :class="{ ok: c.ok }">
                  <span class="grade-mark">{{ c.ok ? '✓' : '✗' }}</span>{{ c.msg }}
                </li>
              </ul>
            </div>
          </li>
        </ol>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* BlurText 接管「写作工坊」入场:全局 terrRise 在本视图置空,避免双重动画 */
.terr-title { animation: none; }

.stage-tabs { display: flex; gap: 8px; margin: 0 0 16px }
.stage-tab {
  position: relative;
  padding: 10px 18px; border-radius: 999px; cursor: pointer;
  background: var(--surface); border: 1px solid var(--line-strong);
  color: var(--text-2); font-family: inherit; font-size: var(--fs-sm); font-weight: 500;
  transition: color 0.2s var(--ease-out-3), border-color 0.2s var(--ease-out-3),
    background 0.2s var(--ease-out-3), box-shadow 0.2s var(--ease-out-3), transform 0.2s var(--ease-out-3);
}
.stage-tab:hover { color: var(--text); border-color: var(--line-accent); transform: translateY(-1px); }
.stage-tab.active {
  background: var(--accent-soft); border-color: var(--line-accent); color: var(--accent); font-weight: 600;
  box-shadow: inset 0 0 0 1px var(--line-accent);
}
/* 页签是关卡:① ② 序号用衬线(个别浏览器按钮不吃 ::first-letter 时安静回落 sans,无害) */
.stage-tab.active::first-letter { font-family: var(--serif); }
/* 关卡点亮:active 页签底缘一道金色发丝线 —— 走到哪关,哪盏金灯亮(与鎏金 terr-rule 同语义,克制在内缘) */
.stage-tab.active::after {
  content: ''; position: absolute; left: 27%; right: 27%; bottom: 5px; height: 1px;
  background: linear-gradient(90deg, transparent, var(--gold), transparent);
  box-shadow: 0 0 8px color-mix(in srgb, var(--gold) 30%, transparent);
}

.writing-card { padding: 24px; }
/* 目标词牌:工坊的信物 —— 点阵仪器底纹 + 衬线大词;换词时重键重播入场 */
.word-strip {
  position: relative;
  display: flex; align-items: center; gap: 16px; flex-wrap: wrap;
  padding: 16px 20px; border-radius: var(--r-md);
  background: var(--accent-soft); border: 1px solid var(--line-accent);
  margin-bottom: 16px;
}
.word-strip-label {
  font-family: var(--mono); font-size: var(--fs-2xs); font-weight: 600;
  letter-spacing: 0.22em; color: var(--accent);
}
.word-strip-word { position: relative; display: flex; align-items: baseline; gap: 8px; flex: 1; min-width: 0; }
.ws-word {
  font-family: var(--serif);
  font-size: var(--fs-2xl); font-weight: 600; letter-spacing: 0.02em; color: var(--text);
  animation: unsealRise 0.45s var(--ease-out-3);
}
.ws-ipa { font-family: var(--mono); font-size: var(--fs-sm); color: var(--accent); }
.ws-meaning { color: var(--text-2); font-size: var(--fs-sm); }
.play-btn { width: 28px; height: 28px; border-radius: 7px; background: var(--surface); border: 1px solid var(--line); color: var(--text-2); cursor: pointer; display: flex; align-items: center; justify-content: center; }

/* 参考例句:印刷体(衬线),像词卡上印的两条例句 */
.ref-block { margin-bottom: 16px; padding: 14px 16px; border-radius: var(--r-md); background: var(--surface-sunken); border: 1px dashed var(--line); }
.ref-label { font-size: var(--fs-xs); color: var(--text-3); margin-bottom: 8px; }
.ref-example + .ref-example { margin-top: 8px; }
.ref-en { font-family: var(--serif); font-size: var(--fs-sm); color: var(--text); letter-spacing: 0.01em; }
.ref-zh { font-size: var(--fs-xs); color: var(--text-3); margin-top: 2px; }

/* 稿纸:写作面 —— 下沉纸面 + 宽行距,焦点时亮 accent 边(与全局输入焦点同一语言) */
.writing-textarea {
  width: 100%; padding: 16px 20px; border-radius: var(--r-md);
  background: var(--surface-sunken); border: 1px solid var(--line-strong);
  color: var(--text); font-family: var(--font); font-size: var(--fs-md); line-height: 1.9;
  resize: vertical; outline: none;
  transition: border-color 0.25s var(--ease-out-3), box-shadow 0.25s var(--ease-out-3);
}
.writing-textarea:focus {
  border-color: var(--accent); box-shadow: 0 0 0 4px var(--accent-soft);
  /* 落笔金线:聚焦时稿纸顶端亮一道鎏金刻线(框体仍走 accent,金只点一线 —— 「此刻在写」) */
  background-image: linear-gradient(to right, color-mix(in srgb, var(--gold) 45%, transparent), var(--gold) 30% 70%, color-mix(in srgb, var(--gold) 45%, transparent));
  background-size: 100% 2px; background-position: top; background-repeat: no-repeat;
}
/* 实时字数/句数:mono 仪表读数,字距放宽到仪表档 */
.writing-meta {
  display: flex; gap: 8px; font-family: var(--mono); font-size: var(--fs-2xs);
  letter-spacing: 0.09em; color: var(--text-3); margin-top: 8px;
  font-variant-numeric: tabular-nums;
}

.writing-actions { display: flex; gap: 8px; margin-top: 14px; }

/* ===== 批注稿:批改与原文同屏 —— 用户文字转衬线,像从草稿排成印刷稿 ===== */
.manuscript {
  position: relative; margin-top: 16px; padding: 20px 24px;
  border: 1px solid var(--line);
  border-radius: var(--r-md); background: var(--surface-sunken);
}
/* 双层发丝框:外 hairline + 内衬 5px 处第二道淡刻线,像稿纸的印刷框
   (原 2px accent 左线太实 —— 批改的层级感交给框线与 flagged 句自己的刻线) */
.manuscript::before {
  content: ''; position: absolute; inset: 5px;
  border: 1px solid color-mix(in srgb, var(--line) 60%, transparent);
  border-radius: calc(var(--r-md) - 5px);
  pointer-events: none;
}
.ms-head { display: flex; align-items: center; gap: 10px; margin-bottom: 4px; flex-wrap: wrap; }
.ms-tag {
  font-family: var(--mono); font-size: var(--fs-2xs); letter-spacing: 0.18em; color: var(--accent); font-weight: 600;
  border: 1px solid color-mix(in srgb, var(--accent) 40%, transparent);
  border-radius: 999px; padding: 1px 9px;
}
.ms-meta { font-size: var(--fs-2xs); color: var(--text-3); }
.ms-edit { margin-left: auto; }
.ms-sentence {
  position: relative; display: block; margin: 0; padding: 10px 12px; border-radius: 8px;
  font-family: var(--serif);
  font-size: var(--fs-md); line-height: 1.9; color: var(--text); letter-spacing: 0.01em;
  animation: unsealRise 0.45s var(--ease) calc(var(--i, 0) * 60ms) backwards;
  transition: background 0.2s var(--ease), transform 0.2s var(--ease), box-shadow 0.2s var(--ease);
}
.ms-sentence.flagged {
  cursor: pointer; margin-top: 6px;
  background: color-mix(in srgb, var(--warn) 6%, transparent);
  border-left: 2px solid color-mix(in srgb, var(--warn) 55%, transparent);
}
/* 批注句 hover:亮边微升 -1px + 琥珀淡影,「这行点得开」 */
.ms-sentence.flagged:hover {
  background: color-mix(in srgb, var(--warn) 10%, transparent);
  transform: translateY(-1px);
  box-shadow: 0 2px 10px color-mix(in srgb, var(--warn) 14%, transparent);
}
/* 干净句也给一点 hover 存在感:极淡 accent 水痕,提示批注稿是逐句可读的 */
.ms-sentence:not(.flagged):hover { background: color-mix(in srgb, var(--accent) 4%, transparent); }
.ms-no {
  font-family: var(--mono); font-size: var(--fs-2xs); font-weight: 700; color: var(--warn);
  margin-right: 8px; vertical-align: super;
}
.ms-hit {
  color: var(--success); font-weight: 600;
  background: color-mix(in srgb, var(--success) 12%, transparent);
  padding: 0 3px; border-radius: 4px;
}
.ms-notes {
  display: flex; flex-direction: column; gap: 2px;
  margin: 8px 0 2px 14px; padding: 8px 12px;
  background: var(--surface); border-radius: 8px;
  animation: unsealRise 0.35s var(--ease) backwards;
}
.ms-notes.loose { margin: 8px 0 0 0; display: flex; }
.ms-issue { font-size: var(--fs-xs); color: var(--warn); line-height: 1.6; }
.ms-tip { font-size: var(--fs-xs); color: var(--text-2); line-height: 1.6; }
.ms-advice {
  margin: 14px 0 0; padding-top: 10px; border-top: 1px dashed var(--line);
  font-size: var(--fs-sm); color: var(--text-2); line-height: 1.7;
}

/* ===== 规则分明细 + 分数环(与口语竞技场 score-ring 同语言) ===== */
.grade {
  margin-top: 16px; padding: 16px;
  background: var(--surface-sunken); border: 1px solid var(--line); border-radius: var(--r-lg);
  display: flex; gap: 20px; align-items: flex-start;
}
/* 分数环:conic 环弹入(squish 曲线),中心留纸面圆盘,数字 CountNum 从 0 滚上去 */
.grade-score {
  width: 78px; height: 78px; border-radius: 50%; flex-shrink: 0;
  background: conic-gradient(var(--accent) calc(var(--sc, 0) * 360deg), var(--surface-active) 0deg);
  display: flex; align-items: center; justify-content: center;
  animation: gradePop 0.55s var(--ease-squish-2) backwards;
}
/* 高分点亮(≥0.85 挂 .gold):conic 换 gold→gold-dim 渐变(亮头在弧前缘)+ 外圈金晕,数字同染 */
.grade-score.gold {
  background: conic-gradient(var(--gold-dim), var(--gold) calc(var(--sc, 0) * 360deg), var(--surface-active) calc(var(--sc, 0) * 360deg));
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--gold) 30%, transparent),
    0 0 22px color-mix(in srgb, var(--gold) 22%, transparent);
}
.grade-score.gold .grade-score-inner b { color: var(--gold); }
.grade-score-inner {
  width: 62px; height: 62px; border-radius: 50%;
  background: var(--surface-sunken);
  display: flex; flex-direction: column; align-items: center; justify-content: center; line-height: 1;
}
.grade-score b { font-size: var(--fs-xl); font-weight: 700; color: var(--text); font-variant-numeric: tabular-nums; }
.grade-score span { font-size: var(--fs-2xs); color: var(--text-3); margin-top: 2px; }
@keyframes gradePop { from { transform: scale(0.6); opacity: 0 } }
.grade-list { list-style: none; flex: 1; display: flex; flex-direction: column; gap: 8px; margin: 0; padding: 0; }
.grade-list li { display: flex; gap: 10px; font-size: var(--fs-sm); line-height: 1.5; }
/* 对错章:彩底上的字走 --on-*(暖夜主题自动换深字,白字会在粉彩底翻车) */
.grade-mark {
  width: 22px; height: 22px; border-radius: 50%; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  font-size: var(--fs-sm); font-weight: 700; color: var(--on-success);
  background: var(--success);
}
.grade-list li:not(.ok) .grade-mark { background: var(--danger); color: var(--on-danger); }
.grade-list li:not(.ok) .grade-msg { color: var(--text-2); }
.grade-list li.ok .grade-msg { color: var(--text-2); }

/* ===== 成文 ===== */
.essay-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 14px; margin-bottom: 16px; flex-wrap: wrap; }
.essay-topic { flex: 1; }
.topic-tag { display: inline-block; padding: 3px 10px; border-radius: 999px; background: var(--accent-soft); color: var(--accent); font-size: var(--fs-2xs); font-weight: 600; margin-bottom: 8px; }
/* 题面提示:英文用衬线斜体,像题目卡片上印的一句话 */
.essay-topic p {
  font-family: var(--serif); font-style: italic;
  font-size: var(--fs-base); color: var(--text-2); line-height: 1.75; margin: 0;
}

.targets { display: flex; gap: 8px; flex-wrap: wrap; align-items: baseline; margin-bottom: 14px; padding: 10px 12px; border-radius: 10px; background: var(--surface-sunken); border: 1px dashed var(--line); }
.targets-label { font-size: var(--fs-xs); color: var(--text-3); margin-right: 4px; }
.target-chip { display: inline-flex; align-items: baseline; gap: 6px; padding: 4px 12px; border-radius: 999px; background: var(--surface); border: 1px solid var(--line-accent); transition: all 0.35s var(--ease); }
.target-chip b { font-family: var(--mono); font-size: var(--fs-sm); color: var(--accent); }
.target-zh { font-size: var(--fs-xs); color: var(--text-3); }
/* 提交后:命中 = 绿,没用上 = 灰暗(原文里同名高亮同色) */
.target-chip.hit { border-color: color-mix(in srgb, var(--success) 50%, transparent); background: color-mix(in srgb, var(--success) 8%, transparent); }
.target-chip.hit b { color: var(--success); }
.target-chip.hit .target-mark { color: var(--success); font-size: var(--fs-2xs); font-weight: 700; }
.target-chip.miss { opacity: 0.55; }
.target-chip.miss .target-mark { color: var(--text-3); font-size: var(--fs-2xs); font-weight: 700; }

/* ===== 航行日志 ===== */
.logbook { margin-top: 24px; padding: 20px 24px; }
.log-head { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 12px; }
.log-tag {
  font-family: var(--mono); font-size: var(--fs-2xs); letter-spacing: 0.22em;
  font-weight: 600; color: var(--accent);
}
.log-chips { display: flex; gap: 6px; }
/* 趋势线:线下铺 8% accent 微域(读数的「地面」),端点加 2-3px 辉光 —— 裸线升格成有床的读数 */
.log-spark {
  width: 100%; height: 56px; display: block; margin-bottom: 8px;
  background: linear-gradient(to top, color-mix(in srgb, var(--accent) 8%, transparent), transparent 72%);
  border-radius: 8px;
}
.log-spark circle { filter: drop-shadow(0 0 3px color-mix(in srgb, var(--accent) 60%, transparent)); }
.log-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; counter-reset: logno; }
.log-item {
  position: relative;
  border-top: 1px solid color-mix(in srgb, var(--line) 60%, transparent);
  cursor: pointer;
}
.log-item:first-child { border-top: 0; }
.log-row {
  display: flex; align-items: baseline; gap: 12px; padding: 12px 8px;
  font-size: var(--fs-xs); border-radius: var(--r-sm);
  transition: background 0.2s var(--ease-out-3), transform 0.2s var(--ease-out-3), box-shadow 0.2s var(--ease-out-3);
}
/* 行前 mono 序号刻线:台账式编号(01/02…),序号自带一道右缘发丝刻线 */
.log-row::before {
  counter-increment: logno;
  content: counter(logno, decimal-leading-zero);
  font-family: var(--mono); font-size: var(--fs-2xs); font-weight: 600;
  color: var(--text-4); font-variant-numeric: tabular-nums; flex-shrink: 0;
  padding-right: 10px; margin-right: 2px;
  border-right: 1px solid color-mix(in srgb, var(--line) 80%, transparent);
}
.log-item:hover .log-row {
  background: color-mix(in srgb, var(--accent) 5%, transparent);
  transform: translateY(-1px); box-shadow: var(--shadow-sm);
}
.log-item.open .log-row { background: color-mix(in srgb, var(--accent) 7%, transparent); }
/* 展开项:左缘 accent 刻线立起(信号轨道/车厢刻线的同一语言) */
.log-item.open::before {
  content: ''; position: absolute; left: 0; top: 8px; bottom: 8px; width: 2px;
  border-radius: 2px; background: var(--accent);
  transform-origin: top; animation: unsealBar 0.4s var(--ease-out-3);
}
.log-date { font-family: var(--mono); font-size: var(--fs-2xs); color: var(--text-3); flex-shrink: 0; }
.log-score { font-family: var(--mono); font-weight: 700; font-variant-numeric: tabular-nums; flex-shrink: 0; }
.log-score.good { color: var(--success) }
.log-score.mid { color: var(--accent) }
.log-score.low { color: var(--text-3) }
.log-excerpt { color: var(--text-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.log-detail { padding: 8px 8px 16px; animation: unsealRise 0.35s var(--ease-out-3); }
.log-text {
  margin: 0 0 10px; padding: 14px 16px; border-radius: var(--r-sm);
  background: var(--surface-sunken); border: 1px solid var(--line);
  font-size: var(--fs-base); line-height: 1.85; color: var(--text-2); white-space: pre-wrap;
}
.log-checks { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.log-checks li { display: flex; gap: 8px; font-size: var(--fs-xs); color: var(--text-2); align-items: center; }
.log-checks .grade-mark { width: 18px; height: 18px; font-size: var(--fs-2xs); }
</style>
