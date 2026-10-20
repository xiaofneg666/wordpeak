<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useUniverse } from '../stores/universe'
import { api } from '../api'
import { speak } from '../speech'
import { message } from '../ui'
import CopyButton from './CopyButton.vue'
import LookupMenu from './LookupMenu.vue'
import CollectPopover from './CollectPopover.vue'
import { formatWordText } from '../utils/wordText.js'

function shuffle(arr) { return [...arr].sort(() => Math.random() - 0.5) }

// 三题型:choice 45% / spell 30% / dictation 25%
function buildQuiz(word, allWords, type) {
  const family = allWords.filter((w) => w.id !== word.id && w.family === word.family)
  const others = allWords.filter((w) => w.id !== word.id && w.family !== word.family)
  const distractors = [...shuffle(family).slice(0, 3), ...shuffle(others)].slice(0, 3)
  const enToZh = Math.random() < 0.7
  const options = shuffle([word, ...distractors])
  return {
    word, type, enToZh, options,
    answerIdx: options.findIndex((o) => o.id === word.id),
  }
}

const store = useUniverse()
const quizzes = ref(null)
const idx = ref(0)
const picked = ref(null)
const result = ref(null)
const record = ref([])
const loading = ref(true)
const retryMode = ref(false)
const originalRecord = ref([])

const q = computed(() => quizzes.value?.[idx.value])
const right = computed(() => record.value.filter((r) => r.correct).length)
const total = computed(() => quizzes.value?.length || 0)
const accuracy = computed(() => total.value ? Math.round((right.value / total.value) * 100) : 0)
// 正确率数字的档位色类(纯视觉,与全站打分语汇对齐:≥80 绿 / ≥50 琥珀 / 其余红)
const accTier = computed(() => (accuracy.value >= 80 ? 'st-ok' : accuracy.value >= 50 ? 'st-mid' : 'st-no'))

let startTime = Date.now()
watch(idx, () => { startTime = Date.now() })

// 拼写
const spellInput = ref('')
const dictRate = ref(0.85)

// 已答题目快照:左右滑切题 / 上一题回看时恢复现场(选项、反馈、输入内容、near 标记)
const savedAnswers = ref([])
const nearMiss = ref(false) // 拼写「差一点」:相似度达标记对,但提示拼写细节
function snapshotCurrent() {
  savedAnswers.value[idx.value] = { picked: picked.value, result: result.value, spell: spellInput.value, near: nearMiss.value }
}
function restoreAt(i) {
  const s = savedAnswers.value[i]
  picked.value = s ? s.picked : null
  result.value = s ? s.result : null
  spellInput.value = s ? s.spell : ''
  nearMiss.value = s ? !!s.near : false
}

// countUp
function useCountUp(target) {
  const val = ref(0)
  let raf = 0
  watch(target, (t, _) => {
    cancelAnimationFrame(raf)
    const from = val.value
    const dur = 600
    const t0 = performance.now()
    const step = (ts) => {
      const p = Math.min((ts - t0) / dur, 1)
      val.value = Math.round(from + (t - from) * (1 - Math.pow(1 - p, 3)))
      if (p < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
  }, { immediate: true })
  return val
}
const rightNum = useCountUp(right)
const accNum = useCountUp(accuracy)

// 答对 confetti 触发器
const confettiKey = ref(0)
function burstConfetti() { confettiKey.value++ }

let alive = true

async function loadQueue() {
  loading.value = true
  try {
    const queue = await api.reviewQueue(store.user.id, 10)
    const items = queue.length ? queue : [{ word_id: store.words[0]?.id, is_new: true }]
    const qs = items
      .map((it) => {
        const w = store.words.find((x) => x.id === it.word_id)
        if (!w) return null
        const r = Math.random()
        const type = r < 0.45 ? 'choice' : r < 0.75 ? 'spell' : 'dictation'
        return buildQuiz(w, store.words, type)
      })
      .filter(Boolean)
    if (alive) { quizzes.value = qs; loading.value = false; savedAnswers.value = [] }
  } catch (e) {
    if (alive) { loading.value = false; quizzes.value = [] }
  }
}

onMounted(() => {
  loadQueue()
  window.addEventListener('keydown', onKey)
  if (store.challengeMode) startChallengeTimer()
})
onUnmounted(() => {
  alive = false
  window.removeEventListener('keydown', onKey)
  clearInterval(challengeTimer)
})

function onKey(e) {
  if (!q.value) return
  if (q.value.type === 'choice' && picked.value === null) {
    // 数字键 1-4
    if (e.key >= '1' && e.key <= '4') {
      const i = Number(e.key) - 1
      if (q.value.options[i]) { e.preventDefault(); choose(i) }
      return
    }
    // 字母键 A B C D
    const map = { a: 0, b: 1, c: 2, d: 3 }
    if (e.key.toLowerCase() in map) {
      const i = map[e.key.toLowerCase()]
      if (q.value.options[i]) { e.preventDefault(); choose(i) }
      return
    }
  }
  if (e.key === 'Enter' && picked.value !== null) { e.preventDefault(); next() }
  // 左右方向键切题(与触摸手势等效;未答完时输入框里的光标移动不受影响)
  if (e.key === 'ArrowRight' && picked.value !== null) { e.preventDefault(); next() }
  if (e.key === 'ArrowLeft' && (picked.value !== null || document.activeElement?.tagName !== 'INPUT')) { e.preventDefault(); prev() }
  if (e.key === ' ' && q.value?.type === 'spell') {
    if (document.activeElement?.tagName !== 'INPUT') return
    e.preventDefault()
    if (spellInput.value) submitSpell()
  }
}

async function choose(optIdx) {
  if (picked.value !== null || !q.value) return
  picked.value = optIdx
  const correct = optIdx === q.value.answerIdx
  if (correct) burstConfetti()
  await submitAnswer(correct)
}

async function submitSpell() {
  if (!q.value || !spellInput.value.trim()) return
  const user = spellInput.value.trim().toLowerCase()
  const answer = q.value.word.word.toLowerCase()
  nearMiss.value = false
  let correct = user === answer
  // 宽容评分:只差 1-2 个字母(相似度 ≥ 0.8)记对,但反馈里点出拼写细节
  if (!correct) {
    const sim = 1 - editDistance(user, answer) / Math.max(user.length, answer.length)
    if (sim >= 0.8) { correct = true; nearMiss.value = true }
  }
  picked.value = 1
  if (correct && !nearMiss.value) burstConfetti()
  await submitAnswer(correct)
}

// 字母编辑距离(Levenshtein):拼写题相似度判定用
function editDistance(a, b) {
  const m = a.length, n = b.length
  if (!m) return n
  if (!n) return m
  let prev = Array.from({ length: n + 1 }, (_, j) => j)
  for (let i = 1; i <= m; i++) {
    const cur = [i]
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    prev = cur
  }
  return prev[n]
}

function speakDictation() { if (q.value) speak(q.value.word.word, { rate: dictRate.value }) }

async function submitAnswer(correct) {
  const ms = Date.now() - startTime
  let res = null
  try { res = await api.submitReview(store.user.id, q.value.word.id, correct, ms) } catch { /* 离线 */ }
  result.value = res
  record.value = [...record.value, { wordId: q.value.word.id, correct, ms }]
  snapshotCurrent()
  if (q.value.enToZh || !correct || nearMiss.value) speak(q.value.word.word) // 差一点拼对也读一遍正音
}

function next() {
  snapshotCurrent()
  if (idx.value + 1 >= quizzes.value.length) {
    picked.value = null
    idx.value = quizzes.value.length
    settleChallenge()
    return
  }
  idx.value++
  restoreAt(idx.value)
}

// 回看上一题(左右滑切题 / ← 键);已答题目恢复作答现场,未答题目恢复草稿
function prev() {
  if (idx.value <= 0) return
  snapshotCurrent()
  idx.value--
  restoreAt(idx.value)
}

function finish() { store.selectWord(null); store.closeReview() }

function startRetry() {
  originalRecord.value = record.value
  const wrong = quizzes.value.filter((qu) => record.value.find((r) => r.wordId === qu.word.id && !r.correct))
  if (!wrong.length) { message.info('这轮全对,没有错题可练'); return }
  quizzes.value = wrong.map((qu) => buildQuiz(qu.word, store.words, Math.random() < 0.3 ? 'choice' : 'spell'))
  idx.value = 0; picked.value = null; result.value = null; record.value = []; savedAnswers.value = []; nearMiss.value = false
  retryMode.value = true; startTime = Date.now()
}

function cancelRetry() {
  if (!originalRecord.value.length) { finish(); return }
  quizzes.value = originalRecord.value.map((r) => {
    const w = store.words.find((x) => x.id === r.wordId)
    return w ? buildQuiz(w, store.words, Math.random() < 0.3 ? 'choice' : 'spell') : null
  }).filter(Boolean)
  idx.value = quizzes.value.length
  record.value = originalRecord.value
  savedAnswers.value = []
  nearMiss.value = false
  retryMode.value = false
}

// 答错时显示同词根家族词(进入家族的桥梁)
const familyWords = computed(() => {
  if (!q.value || picked.value === null) return []
  return store.words.filter((w) => w.family === q.value.word.family && w.id !== q.value.word.id).slice(0, 6)
})

// ---- 反馈语分档:基于本轮 record 的连对/连错与上一题情况说话,不空夸不训话 ----
// 只统计到当前题(左右滑回看旧题时,反馈仍对应当时那题,不被后面的作答影响)
function streakOf(correctVal) {
  const rs = record.value.slice(0, idx.value + 1)
  let n = 0
  for (let i = rs.length - 1; i >= 0; i--) {
    if (rs[i].correct === correctVal) n++
    else break
  }
  return n
}
const correctStreak = computed(() => streakOf(true))
const wrongStreak = computed(() => streakOf(false))
const prevWasWrong = computed(() => {
  const rs = record.value.slice(0, idx.value + 1)
  return rs.length >= 2 && !rs[rs.length - 2].correct
})
// 记忆概率化反馈(FSRS):把"为什么是这个间隔"讲给用户听
const strengthNote = computed(() => {
  const r = result.value
  if (!r) return ''
  const days = r.next_interval_days ?? r.interval_days
  const pct = Math.round((r.predicted_retention ?? 0.9) * 100)
  const d = days >= 1 ? `${Math.round(days)} 天` : '今天稍后'
  return ` ${d}后见——到那天你大概还剩 ${pct}% 的记忆,复习刚好卡在遗忘前`
})
const okLine = computed(() => {
  const s = correctStreak.value
  if (s >= 3) return `连对 ${s} 题了,这批词你熟。${strengthNote.value}`
  if (prevWasWrong.value) return `上一题刚错过,这题接住了。${strengthNote.value}`
  return `答对了。${strengthNote.value}`
})
const noLine = computed(() => {
  const s = wrongStreak.value
  const m = `「${q.value?.word.meaning ?? ''}」`
  const reassurance = ' 不认识没关系,它的记忆稳定性刚被重置得更短,今天就会再排给你'
  if (s >= 3) return `连着 ${s} 题没对,慢点没关系,一题一题来。正确释义是${m}${reassurance}`
  if (s === 2) return `连着 2 题了,这个词根值得多看两眼。正确释义是${m}${reassurance}`
  return `正确释义是${m},这个词会再排给你${reassurance}`
})
const spellOkLine = computed(() =>
  (correctStreak.value >= 3 ? `连对 ${correctStreak.value} 题,这批词你熟。` : '拼对了。') + strengthNote.value)
const spellNoLead = computed(() =>
  (wrongStreak.value >= 2 ? `连着 ${wrongStreak.value} 题没对,慢点没关系。` : '') + '正确拼写是')

// ---- 今日挑战:10 题 / 限时 90 秒,到点直接结算 ----
const isChallenge = computed(() => store.challengeMode)
const CHALLENGE_MS = 90 * 1000
const challengeLeft = ref(CHALLENGE_MS)
const challengeSec = computed(() => Math.ceil(challengeLeft.value / 1000))
const challengeStars = ref(0) // 本轮入账星数(当日仅首次有效)
const challengeClaimed = ref(false)
let challengeTimer = null

function startChallengeTimer() {
  challengeLeft.value = CHALLENGE_MS
  clearInterval(challengeTimer)
  challengeTimer = setInterval(() => {
    challengeLeft.value = Math.max(0, challengeLeft.value - 250)
    if (challengeLeft.value <= 0) {
      clearInterval(challengeTimer)
      // 时间到:未答的题不再作答,直接进入结算
      picked.value = null
      idx.value = quizzes.value?.length || 0
      settleChallenge()
    }
  }, 250)
}

function settleChallenge() {
  if (!isChallenge.value || challengeClaimed.value) return
  challengeClaimed.value = true
  const got = store.claimChallengeStars(right.value)
  challengeStars.value = got ? right.value : 0
  if (got) message.success(`今天拿到了 ${right.value} 颗星`)
}

// ---- 移动端手势:左右滑切题、上下滑退出(与键盘操作并存) ----
const touchStart = ref(null)
function onTouchStart(e) {
  const t = e.touches[0]
  touchStart.value = { x: t.clientX, y: t.clientY }
}
function onTouchEnd(e) {
  const s = touchStart.value
  touchStart.value = null
  if (!s || !q.value) return
  const t = e.changedTouches[0]
  const dx = t.clientX - s.x
  const dy = t.clientY - s.y
  if (Math.abs(dx) > Math.abs(dy)) {
    if (Math.abs(dx) < 60) return // 距离太短,视为点按
    if (dx < 0) {
      // 左滑:下一题(需已作答,与 ↵ 一致)
      if (picked.value === null) { message.info('先答完这题,再左滑看下一题'); return }
      next()
    } else {
      prev() // 右滑:上一题
    }
  } else if (Math.abs(dy) >= 90) {
    finish() // 上滑/下滑:退出复盘
  }
}

// ---- 结算图 1:本轮错题家族分布(横向柱状,SVG 自绘) ----
const familyErrors = computed(() => {
  const wrongs = record.value.filter((r) => !r.correct)
  if (!wrongs.length) return []
  const by = new Map()
  for (const r of wrongs) {
    const w = store.words.find((x) => x.id === r.wordId)
    if (!w) continue
    const root = w.root || '其他'
    if (!by.has(root)) by.set(root, { root, meaning: w.root_meaning || '', count: 0 })
    by.get(root).count++
  }
  return [...by.values()].sort((a, b) => b.count - a.count || a.root.localeCompare(b.root)).slice(0, 6)
})
const familyGeom = computed(() => {
  const rows = familyErrors.value
  if (!rows.length) return null
  const labelW = 128, valW = 34, rowH = 34, W = 480, H = rows.length * rowH + 6
  const barMax = W - labelW - valW - 10
  const maxN = Math.max(...rows.map((r) => r.count), 1)
  return {
    W, H, labelW, rowH,
    rows: rows.map((r, i) => ({ ...r, y: i * rowH + 5, w: Math.max(3, (r.count / maxN) * barMax) })),
  }
})

// ---- 结算图 2:答题节奏时间线(每题一个点,绿=对/红=错,纵轴=耗时) ----
const timelineGeom = computed(() => {
  const rs = record.value
  if (rs.length < 2) return null
  const W = 480, H = 150, padL = 40, padR = 16, padT = 20, padB = 26
  const innerW = W - padL - padR, innerH = H - padT - padB
  const mss = rs.map((r) => r.ms || 0)
  const maxMs = Math.max(...mss, 1)
  const minMs = Math.min(...mss)
  const span = Math.max(maxMs - minMs, 1)
  const pts = rs.map((r, i) => ({
    i,
    x: padL + (i / (rs.length - 1)) * innerW,
    // 答得快 → 点位高(靠近"快"),答得慢 → 点位低
    y: padT + ((r.ms || 0) - minMs) / span * innerH,
    correct: r.correct,
    ms: r.ms || 0,
  }))
  const path = pts.map((p, i) => (i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`)).join(' ')
  return { W, H, padL, padT, innerH, pts, path }
})

// 选项标签(用 A/B/C/D,数字键 1-4 同样有效)
const OPT_LABEL = ['A', 'B', 'C', 'D']
const OPT_KEY = ['1', '2', '3', '4']

function optCls(i) {
  if (picked.value === null) return ''
  if (i === q.value.answerIdx) return 'correct'
  if (i === picked.value) return 'wrong'
  return ''
}
</script>

<template>
  <!-- 答对 confetti 层(每次 burst 时 v-for 重新挂载触发动画) -->
  <div v-if="confettiKey" :key="confettiKey" class="confetti-layer" aria-hidden="true">
    <span
      v-for="i in 36" :key="i" class="confetti"
      :style="{
        '--cx': `${Math.random() * 100}%`,
        '--cy': `${10 + Math.random() * 20}%`,
        '--tx': `${(Math.random() - 0.5) * 200}px`,
        '--ty': `${-80 - Math.random() * 120}px`,
        '--rot': `${Math.random() * 720 - 360}deg`,
        '--hue': [0, 120, 200, 280, 50, 330][i % 6],
        '--d': `${0.6 + Math.random() * 0.4}s`,
      }"
    />
  </div>

  <Transition name="fade">
    <div v-if="loading" class="review-overlay dots-host">
      <span class="dots-decor dots-fade" aria-hidden="true" style="--dots-o:.2" />
      <div class="review-box loading-box">
        <div class="rv-loader">
          <span /><span /><span /><span />
        </div>
        <p class="rv-sub">正在排今天的题…</p>
      </div>
    </div>

    <div v-else-if="!quizzes || quizzes.length === 0" class="review-overlay dots-host">
      <span class="dots-decor dots-fade" aria-hidden="true" style="--dots-o:.2" />
      <div class="review-box">
        <p>没拿到题,看看后端开了没 (localhost:8000)</p>
        <div class="rv-actions" style="margin-top: 20px"><button class="btn" @click="finish">返回</button></div>
      </div>
    </div>

    <div v-else-if="idx >= quizzes.length" class="review-overlay dots-host">
      <span class="dots-decor dots-fade" aria-hidden="true" style="--dots-o:.2" />
      <div class="review-box fade-in settle-box">
        <div class="rv-settle-kick">{{ isChallenge ? 'CHALLENGE SETTLED · 挑战定格' : retryMode ? 'RETRY SETTLED · 重练定格' : 'REVIEW SETTLED · 本轮定格' }}</div>
        <div class="section-title">{{ isChallenge ? '今天的挑战跑完了' : retryMode ? '错题重练完了' : '这轮复习完了' }}</div>
        <div class="rv-stat-row settle-visual">
          <div class="rv-stat"><b class="st-ok">{{ rightNum }}</b><span>答对</span></div>
          <div class="rv-stat"><b class="st-no">{{ total - right }}</b><span>答错</span></div>
          <div class="rv-stat"><b :class="accTier">{{ accNum }}%</b><span>正确率</span></div>
          <div v-if="isChallenge" class="rv-stat"><b class="star-stat">{{ challengeStars }}</b><span>今天拿到的星</span></div>
        </div>
        <p class="rv-sub">
          <template v-if="isChallenge">
            限时 90 秒,你答对了 {{ right }} / {{ total }} 题,
            {{ challengeStars > 0 ? '今天拿到了 ' + challengeStars + ' 颗星' : '今天的星之前已经记过一轮(每天只记首次),明天再来冲' }}
          </template>
          <template v-else-if="retryMode">刚才错过的词又过了一遍,还错的会继续排给你</template>
          <template v-else>答对的词强度都涨了;答错的会优先排进下一轮</template>
        </p>

        <!-- 本轮错题家族分布(横向柱状,一眼看到薄弱词根) -->
        <div v-if="familyGeom" class="settle-chart">
          <div class="settle-chart-title">这次错的题集中在这几个词根</div>
          <svg class="settle-svg" :viewBox="`0 0 ${familyGeom.W} ${familyGeom.H}`" role="img" aria-label="错题家族分布">
            <template v-for="row in familyGeom.rows" :key="row.root">
              <text :x="familyGeom.labelW - 10" :y="row.y + 14" text-anchor="end" class="fam-label">
                {{ row.root.toUpperCase() }}-<tspan class="fam-meaning">· {{ row.meaning }}</tspan>
              </text>
              <rect
                :x="familyGeom.labelW" :y="row.y" :width="row.w" height="20" rx="5"
                class="fam-bar" :style="{ animationDelay: `${row.y * 0.02}s` }"
              />
              <text :x="familyGeom.labelW + row.w + 8" :y="row.y + 14" class="fam-count">{{ row.count }}</text>
            </template>
          </svg>
        </div>

        <!-- 答题节奏时间线:每题一个点(绿=对/红=错),纵轴=答题耗时 -->
        <div v-if="timelineGeom" class="settle-chart">
          <div class="settle-chart-title">你每题答得有多快</div>
          <svg class="settle-svg" :viewBox="`0 0 ${timelineGeom.W} ${timelineGeom.H}`" role="img" aria-label="答题节奏时间线">
            <path :d="timelineGeom.path" class="tl-line" />
            <template v-for="p in timelineGeom.pts" :key="p.i">
              <circle :cx="p.x" :cy="p.y" r="5" :class="p.correct ? 'tl-dot-ok' : 'tl-dot-no'" :style="{ animationDelay: `${p.i * 0.06}s` }">
                <title>第 {{ p.i + 1 }} 题 · {{ p.correct ? '答对' : '答错' }} · 耗时 {{ (p.ms / 1000).toFixed(1) }}s</title>
              </circle>
              <text :x="p.x" :y="timelineGeom.H - 8" text-anchor="middle" class="tl-num">{{ p.i + 1 }}</text>
            </template>
            <text :x="timelineGeom.padL - 8" :y="timelineGeom.padT + 4" text-anchor="end" class="tl-axis">快</text>
            <text :x="timelineGeom.padL - 8" :y="timelineGeom.padT + timelineGeom.innerH" text-anchor="end" class="tl-axis">慢</text>
          </svg>
        </div>

        <div class="rv-actions" style="flex-wrap: wrap; justify-content: center">
          <button v-if="!retryMode && !isChallenge && total - right > 0" class="btn primary" @click="startRetry">把 {{ total - right }} 道错题再来一遍</button>
          <button v-if="retryMode" class="btn ghost" @click="cancelRetry">回到刚才的结果</button>
          <button class="btn primary" @click="finish">返回星系</button>
        </div>
      </div>
    </div>
  </Transition>

  <!-- 答题(移动端:左右滑切题 · 上下滑退出) -->
  <Transition name="slide">
    <div
      v-if="q" class="review-overlay dots-host"
      @touchstart.passive="onTouchStart" @touchend.passive="onTouchEnd"
    >
      <span class="dots-decor dots-fade" aria-hidden="true" style="--dots-o:.2" />
      <div class="review-box">
        <!-- 键盘提示 + 题型 + 进度 -->
        <div class="rv-topbar">
          <div class="kbd-hint">
            <template v-if="q.type === 'choice'">
              <span class="kbd-group"><span class="kbd">A</span><span class="kbd">B</span><span class="kbd">C</span><span class="kbd">D</span> 选</span>
              <span class="kbd kbd-divider">或</span>
              <span class="kbd-group"><span class="kbd">1</span><span class="kbd">2</span><span class="kbd">3</span><span class="kbd">4</span></span>
            </template>
            <template v-else>
              <span class="kbd kbd-divider">输入后</span>
              <span class="kbd-group"><span class="kbd">␣</span> 提交</span>
            </template>
            <span class="kbd-touch">
              <span class="kbd-divider">·</span>
              <span class="kbd-group">左滑下一题 · 右滑上一题 · 上下滑退出</span>
            </span>
            <span class="kbd-divider">·</span>
            <span class="kbd-group"><span class="kbd">↵</span> 下一题</span>
          </div>
          <span v-if="isChallenge" class="chip" :class="challengeLeft <= 15000 ? 'red' : 'amber'">剩 {{ challengeSec }}s</span>
          <span v-if="retryMode" class="chip amber">错题重练中</span>
        </div>

        <div class="rv-progress">
          <i
            v-for="(r, i) in record" :key="i"
            :class="record[i].correct ? 'done' : 'bad'"
            :style="{ animationDelay: `${i * 0.05}s` }"
          />
          <i v-for="i in total - record.length" :key="'e' + i" />
        </div>

        <div class="rv-type-tag">
          <span v-if="q.type === 'choice'" class="chip cyan">四选一 · 选词 / 释义</span>
          <span v-else-if="q.type === 'spell'" class="chip amber">拼写 · 看意思拼单词</span>
          <span v-else class="chip red">听写 · 听完拼写</span>
        </div>

        <!-- 四选一 -->
        <template v-if="q.type === 'choice'">
          <template v-if="q.enToZh">
            <div class="rv-prompt">{{ q.word.word }}</div>
            <div class="ipa rv-ipa">{{ q.word.ipa }}</div>
          </template>
          <div v-else class="rv-zh">{{ q.word.meaning }}</div>
          <div class="rv-sub">
            {{ q.enToZh ? '这个词的意思是?' : '哪个单词对应这个含义?' }}
            <button class="play-btn" style="margin-left: 10px" title="播放" @click="speak(q.enToZh ? q.word.word : q.word.meaning.split(/[,，;；]/)[0])">
              <svg class="spk" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M11 5 6 9H3v6h3l5 4V5z"/><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M15.5 8.5a5 5 0 0 1 0 7"/></svg>
            </button>
          </div>
          <div class="rv-options">
            <button
              v-for="(o, i) in q.options" :key="o.id"
              class="rv-opt" :class="optCls(i)"
              :disabled="picked !== null" @click="choose(i)"
            >
              <span class="opt-key" :class="optCls(i)">{{ OPT_LABEL[i] }}<span class="opt-key-num">{{ OPT_KEY[i] }}</span></span>
              <span class="opt-content">
                <span class="opt-text">{{ q.enToZh ? o.meaning : o.word }}</span>
                <span v-if="!q.enToZh" class="opt-src">{{ o.meaning.split(/[,，]/)[0] }}</span>
              </span>
              <span v-if="picked !== null && i === q.answerIdx" class="opt-mark">✓</span>
              <span v-else-if="picked === i" class="opt-mark no">✗</span>
            </button>
          </div>
        </template>

        <!-- 拼写 / 听写 -->
        <template v-else>
          <template v-if="q.type === 'dictation'">
            <div class="rv-zh rv-dict-title">听写</div>
            <div class="rv-sub">听单词发音,拼出对应的英文单词</div>
            <div class="dictation-controls">
              <button class="btn primary dict-play" @click="speakDictation">
                <svg class="spk" viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M11 5 6 9H3v6h3l5 4V5z"/><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M15.5 8.5a5 5 0 0 1 0 7"/></svg>
                播放 {{ dictRate }}x
              </button>
              <div class="rate-selector">
                <span class="rate-chip" :class="{ active: dictRate === 0.6 }" @click="dictRate = 0.6">0.6x</span>
                <span class="rate-chip" :class="{ active: dictRate === 0.85 }" @click="dictRate = 0.85">0.85x</span>
                <span class="rate-chip" :class="{ active: dictRate === 1.0 }" @click="dictRate = 1.0">1.0x</span>
              </div>
              <button class="btn small" @click="speak(q.word.word, { rate: 0.4 })">慢速 0.4x</button>
            </div>
          </template>
          <template v-else>
            <template v-if="q.enToZh">
              <div class="rv-zh">{{ q.word.meaning }}</div>
              <div class="ipa rv-ipa">{{ q.word.ipa }} · 听拼写</div>
            </template>
            <template v-else>
              <div class="rv-zh">{{ q.word.meaning }}</div>
              <div class="rv-sub">看到意思,拼出对应单词</div>
            </template>
            <div class="rv-sub">
              <button class="play-btn" style="margin-left: 0" title="听单词" @click="speak(q.word.word)">
                <svg class="spk" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M11 5 6 9H3v6h3l5 4V5z"/><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M15.5 8.5a5 5 0 0 1 0 7"/><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M18.3 5.7a9 9 0 0 1 0 12.6"/></svg>
                听单词
              </button>
              <button class="play-btn" style="margin-left: 6px" @click="speak(q.word.word, { rate: 0.5 })">慢速 0.5x</button>
            </div>
          </template>
          <input
            v-model="spellInput" class="spell-input" :class="picked !== null ? (record[idx]?.correct ? (nearMiss ? 'near' : 'ok') : 'no') : ''"
            :placeholder="q.type === 'dictation' ? '听完拼写…' : '拼写单词,按空格提交…'" autofocus
            @keydown.enter.prevent="submitSpell" @keydown.space.prevent="submitSpell"
          />
          <div v-if="picked !== null" class="rv-feedback fade-in rv-feedback-center">
            <div v-if="nearMiss" class="ok text-warn">
              差一点就全对了 · 正确拼写是 <b class="text-mono">{{ q.word.word }}</b> · 你写的是
              <span class="you-wrote">{{ spellInput }}</span>,这题记对,但拼写细节再留意一次
            </div>
            <div v-else-if="record[idx]?.correct" class="ok text-success">
              {{ spellOkLine }}
            </div>
            <div v-else class="no text-danger">
              {{ spellNoLead }} <b class="text-mono">{{ q.word.word }}</b> · 你写的是
              <span class="you-wrote">{{ spellInput }}</span>
            </div>
          </div>
        </template>

        <!-- 答错时:同词根家族桥梁卡(帮助记忆触类旁通) -->
        <Transition name="fade">
          <div
            v-if="picked !== null && record[idx] && !record[idx].correct && familyWords.length"
            class="family-bridge fade-in"
          >
            <div class="family-bridge-head">
              <div>
                <div class="fb-title">这题考的是 <b>{{ q.word.root }}-</b> 家族的词</div>
                <div class="fb-sub">同一个词根的词长得像,放在一起记更省力,点一个看看</div>
              </div>
            </div>
            <div class="family-bridge-words">
              <button
                v-for="fw in familyWords" :key="fw.id"
                class="fb-word" @click="store.openWordInGalaxy(fw.id); store.closeReview()"
              >{{ fw.word }}<span class="fb-zh">{{ fw.meaning.split(/[,，;；]/)[0] }}</span></button>
            </div>
          </div>
        </Transition>

        <div v-if="picked !== null" class="rv-feedback fade-in rv-feedback-center" style="margin-top: 14px">
          <span v-if="record[idx]?.correct && q.type === 'choice'" class="ok text-success">
            {{ okLine }}
          </span>
          <span v-else-if="!record[idx]?.correct && q.type === 'choice'" class="no text-danger">
            {{ noLine }}
          </span>
          <div v-if="picked !== null && q.word" class="rv-feedback-tools">
            <CopyButton :text="formatWordText(q.word)" icon="copy" title="复制" />
            <LookupMenu :word="q.word.word" :ipa="q.word.ipa" />
            <CollectPopover :word-id="q.word.id" />
          </div>
        </div>

        <div class="rv-actions">
          <button v-if="picked !== null" class="btn primary lg-next" @click="next">
            {{ idx + 1 >= total ? '看这轮的结果' : '下一题' }}
          </button>
          <button class="btn ghost" @click="finish">先到这里</button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
/* === 答对 confetti === */
.confetti-layer { position: fixed; inset: 0; z-index: 200; pointer-events: none; }
.confetti {
  position: absolute; top: 0; left: 0; width: 8px; height: 12px; border-radius: 2px;
  background: hsl(var(--hue, 200), 80%, 60%);
  transform: translate(var(--cx), var(--cy));
  animation: confettiFly var(--d, 0.8s) ease-out forwards;
}
@keyframes confettiFly {
  0% { transform: translate(var(--cx), var(--cy)) rotate(0); opacity: 1; }
  100% { transform: translate(calc(var(--cx) + var(--tx)), calc(var(--cy) + var(--ty))) rotate(var(--rot)); opacity: 0; }
}

/* === 加载 === */
.loading-box { display: flex; flex-direction: column; align-items: center; gap: 24px; }
.rv-loader { display: flex; gap: 8px; }
.rv-loader span {
  width: 10px; height: 10px; border-radius: 50%; background: var(--accent);
  animation: loaderBounce 1.2s infinite ease-in-out;
  box-shadow: 0 0 12px var(--accent-soft);
}
.rv-loader span:nth-child(2) { animation-delay: .15s }
.rv-loader span:nth-child(3) { animation-delay: .3s }
.rv-loader span:nth-child(4) { animation-delay: .45s }
@keyframes loaderBounce {
  0%, 60%, 100% { transform: translateY(0); opacity: 0.5; }
  30% { transform: translateY(-10px); opacity: 1; }
}

/* === scrim(主题化) === */
.review-overlay {
  position: fixed; inset: 0; z-index: 100;
  display: flex; align-items: center; justify-content: center;
  background: var(--scrim-strong);
  backdrop-filter: blur(28px) saturate(1.3);
  -webkit-backdrop-filter: blur(28px) saturate(1.3);
  animation: fadeIn 0.3s var(--ease);
}
.review-box {
  width: min(680px, 92vw); text-align: center;
  animation: riseIn 0.4s var(--ease);
}

.fade-enter-active, .fade-leave-active { transition: opacity 0.3s var(--ease); }
.fade-enter-from, .fade-leave-to { opacity: 0; }
.slide-enter-active, .slide-leave-active { transition: transform 0.4s var(--ease), opacity 0.3s var(--ease); }
.slide-enter-from, .slide-leave-to { transform: translateY(20px) scale(0.97); opacity: 0; }

/* 顶部键盘提示 */
.rv-topbar { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px; margin-bottom: 14px; min-height: 28px; }
.kbd-hint { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; color: var(--text-3); font-size: var(--fs-xs); }
.kbd-group { display: inline-flex; gap: 3px; align-items: center; }
.kbd-divider { margin: 0 2px; opacity: 0.4; }
.kbd {
  display: inline-block; padding: 2px 7px; min-width: 22px; text-align: center;
  border-radius: 5px; font-family: var(--mono); font-size: var(--fs-2xs);
  color: var(--accent); background: var(--accent-soft);
  border: 1px solid var(--line-accent);
  box-shadow: 0 2px 0 var(--line);
  transition: all 0.15s var(--ease);
}
.kbd:hover { transform: translateY(1px); box-shadow: none; }
/* 触摸手势提示只在移动端/触摸设备显示(桌面用键盘提示) */
.kbd-touch { display: none; }
@media (max-width: 768px), (hover: none) and (pointer: coarse) {
  .kbd-touch { display: inline-flex; gap: 6px; align-items: center; }
}
/* 播放按钮里的喇叭图标与文字基线对齐 */
.spk { vertical-align: -2.5px; }

/* 进度点/题干/选项/反馈/结算样式:统一收敛到全局 styles.css 的 .rv-* 单一来源 */
.rv-ipa { font-size: var(--fs-xl); font-weight: 500; }
.rv-dict-title { color: var(--warn); }
.rv-opt.dim { opacity: 0.5; }
.rv-feedback-center { text-align: center; }
.rv-feedback-tools { display: inline-flex; gap: 5px; flex-wrap: wrap; justify-content: center; margin-top: 10px; }
.you-wrote { font-family: var(--mono); background: color-mix(in srgb, var(--danger) 15%, transparent); padding: 0 4px; border-radius: 4px; }

/* 听写控制 */
.dictation-controls { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; justify-content: center; margin: 8px 0 16px }
.dict-play { padding: 12px 24px; font-size: var(--fs-base); }
.rate-selector { display: flex; gap: 4px; padding: 4px; background: var(--surface); border: 1px solid var(--line); border-radius: 999px; }
.rate-chip {
  padding: 6px 12px; border-radius: 999px; font-family: var(--mono); font-size: var(--fs-xs);
  color: var(--text-3); cursor: pointer; transition: all 0.15s;
}
.rate-chip:hover { color: var(--text); }
.rate-chip.active { background: var(--accent-soft); color: var(--accent); }

/* 拼写输入 */
.spell-input {
  width: 100%; padding: 18px; font-size: var(--fs-xl); font-family: var(--mono);
  text-align: center; letter-spacing: 2px;
  background: var(--surface-sunken); border: 2px solid var(--line);
  border-radius: 12px; color: var(--text); outline: none;
  transition: all 0.2s var(--ease);
}
.spell-input:focus { border-color: var(--accent); box-shadow: 0 0 0 4px var(--accent-soft); }
.spell-input.ok { border-color: var(--success); color: var(--success); background: color-mix(in srgb, var(--success) 8%, transparent); }
.spell-input.near { border-color: var(--warn); color: var(--warn); background: color-mix(in srgb, var(--warn) 8%, transparent); }
.spell-input.no { border-color: var(--danger); color: var(--danger); background: color-mix(in srgb, var(--danger) 8%, transparent); }

/* 家族桥梁(答错时) */
.family-bridge {
  margin-top: 18px; padding: 16px 18px; border-radius: 14px;
  background: linear-gradient(135deg, var(--accent-soft), transparent);
  border: 1px solid var(--line-accent);
  text-align: left;
}
.family-bridge-head { display: flex; gap: 12px; align-items: flex-start; margin-bottom: 12px; }
.fb-title { font-size: var(--fs-base); font-weight: 600; color: var(--text); }
.fb-sub { font-size: var(--fs-xs); color: var(--text-2); margin-top: 2px; }
.family-bridge-words { display: flex; gap: 6px; flex-wrap: wrap; }
.fb-word {
  padding: 7px 12px; border-radius: 9px; font-size: var(--fs-sm); font-weight: 500;
  background: var(--surface); border: 1px solid var(--line-strong);
  color: var(--text); cursor: pointer; transition: all 0.2s;
  display: inline-flex; align-items: center; gap: 6px;
}
.fb-word:hover { transform: translateY(-2px); border-color: var(--accent); background: var(--accent-soft); }
.fb-zh { font-size: var(--fs-2xs); color: var(--text-3); }

/* 反馈/操作行:全局 .rv-feedback/.rv-actions(收敛) */
.lg-next { padding: 12px 28px; font-size: var(--fs-base); }

/* 结算 */
.rv-stat b.star-stat { color: var(--warn); font-size: 30px; }

/* 结算图表(错题家族分布 / 答题节奏时间线,SVG 自绘)
   晚一拍升起,不抢统计数字的戏 */
.settle-chart {
  margin: 4px auto 0; padding: 14px 16px;
  background: var(--surface-sunken); border: 1px solid var(--line);
  border-radius: 14px; text-align: left;
  animation: sigRise 0.5s var(--ease-out-3) 0.3s backwards;
}
.settle-chart + .settle-chart { margin-top: 12px; animation-delay: 0.42s; }
.settle-chart-title {
  font-size: var(--fs-sm); font-weight: 600; color: var(--text-2);
  margin-bottom: 10px; display: flex; align-items: center; gap: 6px;
}
.settle-svg { width: 100%; display: block; }

/* 错题家族分布(横向柱状) */
.fam-label { font-family: var(--mono); font-size: var(--fs-sm); fill: var(--text-2); font-weight: 600; }
.fam-meaning { font-size: var(--fs-2xs); fill: var(--text-3); font-weight: 400; }
.fam-bar {
  fill: color-mix(in srgb, var(--danger) 40%, transparent); stroke: var(--danger); stroke-width: 1;
  transform-origin: left center;
  animation: famGrow 0.5s var(--ease) both;
}
@keyframes famGrow { from { transform: scaleX(0); } to { transform: scaleX(1); } }
.fam-count { font-family: var(--mono); font-size: var(--fs-sm); font-weight: 700; fill: var(--danger); }

/* 答题节奏时间线 */
.tl-line { fill: none; stroke: var(--accent); stroke-width: 1.6; opacity: 0.5; stroke-linejoin: round; stroke-linecap: round; }
.tl-dot-ok {
  fill: var(--success); stroke: var(--surface-sunken); stroke-width: 2;
  filter: drop-shadow(0 0 4px color-mix(in srgb, var(--success) 50%, transparent));
  animation: dotPop 0.4s var(--ease-snap) both;
}
.tl-dot-no {
  fill: var(--danger); stroke: var(--surface-sunken); stroke-width: 2;
  filter: drop-shadow(0 0 4px color-mix(in srgb, var(--danger) 50%, transparent));
  animation: dotPop 0.4s var(--ease-snap) both;
}
.tl-num { font-family: var(--mono); font-size: var(--fs-2xs); fill: var(--text-3); }
.tl-axis { font-size: var(--fs-2xs); fill: var(--text-3); }

/* ==========================================================================
   结算定格仪式:结算不是系统消息,是命名时刻
   kicker(mono)→ 衬线标题(星图命名式)→ 数字按档位着色 + squish 级联弹入
   ========================================================================== */
.rv-settle-kick {
  font-family: var(--mono); font-size: var(--fs-2xs); font-weight: 600;
  letter-spacing: 0.32em; color: var(--accent); opacity: 0.85;
  margin-bottom: 10px;
  animation: sigRise 0.5s var(--ease-out-3) 0.01s backwards;
}
.settle-box .section-title {
  font-family: var(--serif);
  font-weight: 600; letter-spacing: 0.1em;
  animation: sigRise 0.5s var(--ease-out-3) 0.06s backwards;
}
/* 数字按语义着色(全局 .rv-stat b 默认 accent,结算页按档位收敛,与 SettleCard 同语汇) */
.rv-stat b.st-ok { color: var(--success); }
.rv-stat b.st-mid { color: var(--warn); }
.rv-stat b.st-no { color: var(--danger); }
/* 统计磁贴 squish 弹入级联:数字逐个落位,不是一排同时出现 */
.settle-visual .rv-stat { animation: statPop 0.55s var(--ease-squish-2) backwards; }
.settle-visual .rv-stat:nth-child(2) { animation-delay: 0.08s }
.settle-visual .rv-stat:nth-child(3) { animation-delay: 0.16s }
.settle-visual .rv-stat:nth-child(4) { animation-delay: 0.24s }
@keyframes statPop { from { transform: scale(0.55); opacity: 0 } }

/* ==========================================================================
   答题入场级联:题型 → 题干 → 音标 → 说明 → 选项/输入
   换题时 v-for 选项重挂载,级联自然重放(回看旧题恢复现场时同样成立)
   ========================================================================== */
.rv-type-tag { animation: sigRise 0.4s var(--ease-out-3) backwards; }
.rv-prompt, .rv-zh { animation: sigRise 0.45s var(--ease-out-3) 0.05s backwards; }
.rv-ipa { animation: sigRise 0.45s var(--ease-out-3) 0.11s backwards; }
.rv-sub { animation: sigRise 0.45s var(--ease-out-3) 0.16s backwards; }
.dictation-controls { animation: sigRise 0.45s var(--ease-out-3) 0.2s backwards; }
.rv-options > * { animation: sigRise 0.45s var(--ease-out-3) 0.22s backwards; }
.rv-options > *:nth-child(2) { animation-delay: 0.28s }
.rv-options > *:nth-child(3) { animation-delay: 0.34s }
.rv-options > *:nth-child(4) { animation-delay: 0.4s }
.spell-input { animation: sigRise 0.45s var(--ease-out-3) 0.22s backwards; }
</style>
