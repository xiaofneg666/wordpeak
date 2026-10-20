// 语音合成（听力朗读 / 单词发音）+ 语音识别（口语打分：音素级比对）
import { VOWELS, DIPHTHONGS, CONSONANTS, PLACES } from './phoneticsData'

let cachedVoice = null

function pickVoice() {
  if (cachedVoice) return cachedVoice
  const voices = window.speechSynthesis?.getVoices() || []
  cachedVoice =
    voices.find((v) => /en[-_]US/i.test(v.lang) && /female|samantha|zira|aria/i.test(v.name)) ||
    voices.find((v) => /en[-_]US/i.test(v.lang)) ||
    voices.find((v) => /^en/i.test(v.lang)) ||
    null
  return cachedVoice
}
if (window.speechSynthesis) window.speechSynthesis.onvoiceschanged = () => { cachedVoice = null }

// 全局基准语速:SettingsView 滑杆写进 store.settings(wv_settings 镜像),这里不引 store 直接读
function baseRate() {
  try {
    const v = JSON.parse(localStorage.getItem('wv_settings') || '{}').speechRate
    return Math.min(1.5, Math.max(0.5, Number(v) || 1))
  } catch { return 1 }
}

// rate 省略 → 基准语速;给了 rate → 相对基准的倍率(慢速按钮就是"比基准再慢")
// absolute: true → 调用方自己管理绝对语速(如回声谷滑杆,它恢复的就是同一份 speechRate,不能叠乘)
export function speak(text, { rate, absolute, onend } = {}) {
  if (!window.speechSynthesis) return
  window.speechSynthesis.cancel()
  const u = new SpeechSynthesisUtterance(text)
  u.lang = 'en-US'
  const r = absolute ? (rate ?? baseRate()) : baseRate() * (rate ?? 1)
  u.rate = Math.min(2, Math.max(0.3, r))
  const v = pickVoice()
  if (v) u.voice = v
  if (onend) u.onend = onend
  window.speechSynthesis.speak(u)
}

export function stopSpeaking() {
  window.speechSynthesis?.cancel()
}

// ---------- 语音识别 ----------
export function recognizerSupported() {
  return !!(window.SpeechRecognition || window.webkitSpeechRecognition)
}

export function listenOnce({ onResult, onEnd, onError } = {}) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition
  if (!SR) { onError?.('此浏览器不支持语音识别，建议使用 Chrome/Edge'); return null }
  const r = new SR()
  r.lang = 'en-US'
  r.interimResults = false
  r.maxAlternatives = 1
  r.onresult = (e) => onResult?.(e.results[0][0].transcript)
  r.onend = () => onEnd?.()
  r.onerror = (e) => onError?.(e.error)
  try { r.start() } catch (err) { onError?.(String(err)) }
  return r
}

// ---------- 音素级比对 ----------
// 已知音素符号表(长符号优先,贪心切分 IPA 字符串)
const PHONEME_SYMBOLS = [...Object.keys(VOWELS), ...Object.keys(DIPHTHONGS), ...Object.keys(CONSONANTS)]
  .sort((a, b) => b.length - a.length)
const VOWEL_WEIGHT = 1.35 // 元音承载单词辨识度,加权更高
const CONS_WEIGHT = 1.0
const MATCH_THRESHOLD = 0.55 // 词级相似度达到即算"命中"

const isVowelSym = (p) => p in VOWELS || p in DIPHTHONGS
const weightOf = (p) => (isVowelSym(p) ? VOWEL_WEIGHT : CONS_WEIGHT)

// IPA 字符串(/ˈfɔːməl/ 含重音符)→ 音素序列;未知符号跳过
export function ipaToPhonemes(ipa) {
  if (!ipa) return []
  const s = String(ipa).replace(/[/ˈˌˑ.\s]/g, '')
  const out = []
  let i = 0
  while (i < s.length) {
    const hit = PHONEME_SYMBOLS.find((p) => s.startsWith(p, i))
    if (hit) { out.push(hit); i += hit.length } else i++
  }
  return out
}

// 轻量拼读规则(grapheme→phoneme 兜底,词库没收录的词也猜个大概;只用于相似度,不求精确)
const G2P_RULES = [
  [/^kn/, ['n']], [/^wr/, ['r']], [/^ps/, ['s']],
  [/tion/, ['ʃ', 'ə', 'n']], [/sion/, ['ʒ', 'ə', 'n']], [/ture/, ['tʃ', 'ə']],
  [/eigh/, ['eɪ']], [/igh/, ['aɪ']],
  [/ee/, ['iː']], [/ea/, ['iː']], [/oo/, ['uː']],
  [/ai/, ['eɪ']], [/ay/, ['eɪ']], [/ey/, ['eɪ']],
  [/oi/, ['ɔɪ']], [/oy/, ['ɔɪ']],
  [/au/, ['ɔː']], [/aw/, ['ɔː']],
  [/ou/, ['aʊ']], [/ow/, ['aʊ']], [/oa/, ['əʊ']],
  [/sh/, ['ʃ']], [/ch/, ['tʃ']], [/th/, ['θ']], [/ph/, ['f']], [/ck/, ['k']],
  [/ng$/, ['ŋ']], [/qu/, ['k', 'w']], [/wh/, ['w']], [/gh/, []],
]
const G2P_SINGLE = { a: 'æ', e: 'e', i: 'ɪ', o: 'ɒ', u: 'ʌ', y: 'ɪ' }
const G2P_TAIL = { a: 'æ', e: 'e', i: 'ɪ', o: 'ɒ', u: 'ʌ', y: 'aɪ' }

function g2p(word) {
  let s = String(word).toLowerCase().replace(/[^a-z]/g, '')
  if (!s) return []
  if (s.length > 2 && s.endsWith('e') && !/[aeiouy]e$/.test(s)) s = s.slice(0, -1) // 词尾哑音 e
  const out = []
  let i = 0
  while (i < s.length) {
    const rest = s.slice(i)
    let matched = false
    for (const [re, phon] of G2P_RULES) {
      const m = rest.match(re)
      if (m && m.index === 0) { out.push(...phon); i += m[0].length; matched = true; break }
    }
    if (matched) continue
    const ch = s[i]
    const atTail = i === s.length - 1
    if (!atTail && G2P_SINGLE[ch]) out.push(G2P_SINGLE[ch])
    else if (atTail && G2P_TAIL[ch]) out.push(G2P_TAIL[ch])
    else if (ch === 'c') out.push(/[eiy]/.test(s[i + 1] || '') ? 's' : 'k')
    else if (ch === 'x') out.push('k', 's')
    else if (/[bdfghjklmnprstvwz]/.test(ch)) out.push(ch)
    i++
  }
  return out
}

// 词 → 音素序列:优先用词库 IPA(ipaOf 由调用方传入),否则拼读兜底
function phonemesOf(word, ipaOf) {
  const ps = ipaOf ? ipaToPhonemes(ipaOf(word)) : []
  return ps.length ? ps : g2p(word)
}

// 单音素相似度:元音按舌位(前后/高低/圆唇)距离,辅音按部位/方式/清浊
function phonemeSim(a, b) {
  if (a === b) return 1
  const va = isVowelSym(a), vb = isVowelSym(b)
  if (va && vb) {
    const fa = VOWELS[a] || VOWELS[DIPHTHONGS[a]?.[0]] // 双元音取滑动起点近似
    const fb = VOWELS[b] || VOWELS[DIPHTHONGS[b]?.[0]]
    if (!fa || !fb) return 0
    const d = Math.abs(fa.f - fb.f) * 0.45 + Math.abs(fa.h - fb.h) * 0.45 + (fa.r === fb.r ? 0 : 0.1)
    let sim = Math.max(0, 1 - d * 1.6)
    if (a === 'ə' || b === 'ə') sim = Math.max(sim, 0.55) // 弱读音节不苛责
    return sim
  }
  if (!va && !vb) {
    const ca = CONSONANTS[a], cb = CONSONANTS[b]
    if (!ca || !cb) return 0
    let sim = 0
    if (ca.place === cb.place) sim += 0.45
    else {
      const pa = PLACES[ca.place], pb = PLACES[cb.place]
      sim += Math.max(0, 0.45 - (Math.abs(pa.f - pb.f) + Math.abs(pa.h - pb.h)) * 0.4)
    }
    if (ca.manner === cb.manner) sim += 0.35
    if (!!ca.voiced === !!cb.voiced) sim += 0.2
    return Math.min(1, sim)
  }
  return 0 // 元音 vs 辅音
}

// 音素级对齐打分(Needleman-Wunsch):元音/辅音加权,漏音/多音扣 GAP
function alignPhonemes(A, B) {
  const n = A.length, m = B.length
  if (!n || !m) return 0
  const GAP = 0.12
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
  for (let i = 1; i <= n; i++) dp[i][0] = dp[i - 1][0] - GAP * weightOf(A[i - 1])
  for (let j = 1; j <= m; j++) dp[0][j] = dp[0][j - 1] - GAP * weightOf(B[j - 1])
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const wa = weightOf(A[i - 1])
      dp[i][j] = Math.max(
        dp[i - 1][j - 1] + wa * phonemeSim(A[i - 1], B[j - 1]),
        dp[i - 1][j] - wa * GAP,
        dp[i][j - 1] - weightOf(B[j - 1]) * GAP,
      )
    }
  }
  const maxW = Math.max(
    A.reduce((s, p) => s + weightOf(p), 0),
    B.reduce((s, p) => s + weightOf(p), 0),
  )
  return Math.max(0, dp[n][m] / (maxW || 1))
}

// 逐词比对打分(音素级):返回 { score, words: [{ word, matched, said, similarity }] }
// ipaOf: (word) => 词库里的 IPA 字符串(可选,提供后命中词库词用 IPA 对齐,其余拼读兜底)
export function scoreSpeech(target, transcript, { ipaOf } = {}) {
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9'\s]/g, '').split(/\s+/).filter(Boolean)
  const t = norm(target)
  const said = norm(transcript)
  const saidPhonemes = new Map() // said 词音素缓存
  const phOfSaid = (w) => {
    if (!saidPhonemes.has(w)) saidPhonemes.set(w, phonemesOf(w, ipaOf))
    return saidPhonemes.get(w)
  }
  // 每个目标词在已说序列中按顺序消耗式匹配:精确命中立即取,否则取音素相似度最高的候选
  let j = 0
  const words = t.map((w) => {
    const tp = phonemesOf(w, ipaOf)
    let bestK = -1, bestSim = 0
    for (let k = j; k < said.length; k++) {
      if (said[k] === w) { bestK = k; bestSim = 1; break }
      const sim = alignPhonemes(tp, phOfSaid(said[k]))
      if (sim > bestSim) { bestSim = sim; bestK = k }
    }
    const matched = bestSim >= MATCH_THRESHOLD
    if (matched) j = bestK + 1
    return { word: w, matched, said: matched ? said[bestK] : null, similarity: Math.round(bestSim * 100) / 100 }
  })
  const score = t.length ? words.reduce((a, x) => a + (x.matched ? x.similarity : 0), 0) / t.length : 0
  return { score: Math.round(score * 100) / 100, words }
}
