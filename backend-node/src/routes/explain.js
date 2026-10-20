// AI 句法讲解:POST /api/explain
// 请求 { sentence?, mode: 'sentence'|'word', word?(mode=word 时必填), title? }
// 响应壳 data: sentence 模式 { translate, grammar, sense, expression, source }
//             word 模式(任意词五维讲解,词库外的词也可点) { explain, mnemonic, tip, usage, grammar, source }
// 有 ANTHROPIC_API_KEY(优先,支持 ANTHROPIC_BASE_URL/ANTHROPIC_MODEL 走内部代理)或
// GEMINI_API_KEY 时调真模型;无 key 或调用失败时降级为本地查表/构词速览,绝不硬编码任何 key。
// LRU 200 + 每用户 20/min 频控(频控内存内记录,跨进程不共享——多副本/真生产换 Redis)。
import { Router } from 'express'
import { db } from '../db.js'
import { err, ok } from '../helpers.js'

export const explainRouter = Router()

// ---- 讲解 SYSTEM_PROMPT:要求 JSON,字段短小(阅读舱卡片里要铺得开) ----
const EXPLAIN_PROMPT = `你是英语句子讲解老师。给定一句英文(sentence,可能含中文标题 title),给出四个短字段:
- translate: 整句自然中文翻译
- grammar: 关键句法点(从句/时态/语态/搭配,一句话即可,如 "主从复合 · if 引导条件状语")
- sense: 句意/语境要点(一句话,说明这句在实际场景中说什么)
- expression: 可学到的表达(一个短句或短语,如 "subject to 取决于"),可空
严格只输出一个 JSON,不要任何其他文字,格式:
{"translate":"...","grammar":"...","sense":"...","expression":"..."}`

// ---- 词模式 SYSTEM_PROMPT:任意词五维讲解(解释/记法/技巧/运用/语法) ----
const WORD_PROMPT = `你是给中国孩子讲英语单词的老师。给定一个英文单词(word),严格只输出一个 JSON 对象(不要思考过程、不要任何其他文字),五个字段全部用中文、每个一句话以内:
{"explain":"词性+核心中文释义","mnemonic":"记法:拆词根/前后缀/联想记忆","tip":"技巧:易混词辨析或使用要点","usage":"运用:一个高频搭配或短例句(附中文)","grammar":"语法:词性变化或常接句型"}`

function extractJson(text) {
  if (!text) return null
  const m = text.match(/\{[\s\S]*\}/)
  if (!m) return null
  try { return JSON.parse(m[0]) } catch { return null }
}

async function askAnthropic(key, system, userText) {
  // .env 可配 ANTHROPIC_BASE_URL/ANTHROPIC_MODEL(内部 Anthropic 兼容代理);缺省走官方
  const base = (process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/+$/, '')
  const model = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001'
  const res = await fetch(`${base}/v1/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model,
      max_tokens: 1500, // 代理后是 thinking 模型:预算太小会把 JSON 截断
      system,
      messages: [{ role: 'user', content: userText }],
    }),
    signal: AbortSignal.timeout(15000),
  })
  if (!res.ok) throw new Error(`anthropic ${res.status}`)
  const body = await res.json()
  // thinking 模型的 content[0] 可能是思考块:取全部 text 块拼接再抽 JSON
  const text = (body?.content || []).filter((b) => b?.type === 'text').map((b) => b.text).join('\n')
  return extractJson(text)
}

async function askGemini(key, system, userText) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: userText }] }],
      generationConfig: { maxOutputTokens: 400, temperature: 0.2 },
    }),
    signal: AbortSignal.timeout(15000),
  })
  if (!res.ok) throw new Error(`gemini ${res.status}`)
  const body = await res.json()
  return extractJson(body?.candidates?.[0]?.content?.parts?.[0]?.text)
}

async function llmExplain(kind, payload) {
  const anthropicKey = process.env.ANTHROPIC_API_KEY
  const geminiKey = process.env.GEMINI_API_KEY
  const system = kind === 'word' ? WORD_PROMPT : EXPLAIN_PROMPT
  const userText = kind === 'word'
    ? `word: ${payload.word}${payload.context ? `\ncontext: ${payload.context}` : ''}`
    : `sentence: ${payload.sentence}${payload.title ? `\ntitle: ${payload.title}` : ''}`
  if (anthropicKey) {
    try {
      const r = await askAnthropic(anthropicKey, system, userText)
      if (r) return { ...r, source: 'llm' }
    } catch (e) { console.warn('[explain] anthropic 调用失败,降级本地:', e.message) }
  }
  if (geminiKey) {
    try {
      const r = await askGemini(geminiKey, system, userText)
      if (r) return { ...r, source: 'llm' }
    } catch (e) { console.warn('[explain] gemini 调用失败,降级本地:', e.message) }
  }
  return null
}

// ---- 本地降级讲解 ----

// 词模式:先精确查词库,查不到再做一次词形还原(transports→transport);仍没有 → null(由 localAny 兜底)
// 注意:词峰的 collocations/examples 存在 words 表里(JSON 字段),不是独立表
async function localWord(word) {
  const cols = 'word, ipa, pos, meaning, root, root_meaning, etymology, level, collocations, examples'
  let row = await db.get(`SELECT ${cols} FROM words WHERE LOWER(word) = LOWER(?)`, word)
  if (!row) {
    const stem = word.toLowerCase().replace(/(ing|ed|ies|es|s|ly|er|est|ness|ment|tion|ous|ful|less)$/i, '')
    if (stem && stem !== word.toLowerCase() && stem.length >= 2) {
      row = await db.get(`SELECT ${cols} FROM words WHERE LOWER(word) = ?`, stem)
    }
  }
  if (!row) return null
  const coll = safeJson(row.collocations).slice(0, 2)
  const ex = safeJson(row.examples).slice(0, 1)
  const usage = [coll.map((c) => `${c.en} · ${c.zh}`).join('; '), ex[0] ? `${ex[0].en} · ${ex[0].zh}` : '']
    .filter(Boolean).join(' / ') || null
  return {
    explain: `${row.pos ? row.pos + ' ' : ''}${row.meaning || '—'}`.trim(),
    mnemonic: row.root
      ? `词根 ${row.root.toUpperCase()}- 意为「${row.root_meaning || '—'}」${row.etymology ? ' · ' + row.etymology : ''}`
      : row.etymology || '整体记,回到句子里多见几面',
    tip: `星等 ${row.level} · 词库已收录,点「加入复习队列」收进宇宙`,
    usage,
    grammar: row.pos || null,
    source: 'local',
  }
}

// 词模式兜底:词库外的任意词也能点 —— 用常见前后缀给一条诚实的本地速览(有 LLM key 时几乎不会走到这)
const AFFIX_HINTS = [
  [/^un/i, 'un- 否定(反义)'], [/^re/i, 're- 再、重复'], [/^dis/i, 'dis- 分开/否定'], [/^pre/i, 'pre- 预先'],
  [/^over/i, 'over- 过度'], [/^sub/i, 'sub- 下面/次级'],
  [/(er|or)$/i, '-er/-or …的人/物'], [/(tion|sion)$/i, '-tion 名词化:行为或结果'],
  [/ness$/i, '-ness 名词化:性质状态'], [/ly$/i, '-ly 副词化'], [/ful$/i, '-ful 充满…的'],
  [/less$/i, '-less 没有…的'], [/(able|ible)$/i, '-able 可…的'], [/ing$/i, '-ing 进行/形容词化'], [/ed$/i, '-ed 完成/形容词化'],
]
function localAny(word) {
  const w = word.toLowerCase()
  const hits = AFFIX_HINTS.filter(([re]) => re.test(w)).map(([, note]) => note).slice(0, 3)
  return {
    explain: `词库暂未收录「${word}」,这条是本地速览;点下方「查询」可用有道/必应词典`,
    mnemonic: hits.length ? `构词线索:${hits.join(' · ')}` : '先整体记读音,回到句子里多见几面',
    tip: '把整句连起来读,语境是最好的释义',
    usage: null,
    grammar: null,
    source: 'local',
  }
}

function safeJson(s) {
  try { const v = JSON.parse(s); return Array.isArray(v) ? v : [] } catch { return [] }
}

// 句模式:在 passages 找该句的位置,顺手用 passage 的 translations(若 passages 表有 zh 字段)+ 词库命中
async function localSentence(sentence) {
  if (!sentence || !sentence.trim()) return null
  const norm = sentence.trim().toLowerCase().replace(/[^a-z'\s]/g, ' ').replace(/\s+/g, ' ').trim()
  const tokens = norm.split(' ').filter(Boolean)
  // 词库命中:逐词查 meaning,挑前 3 个不在 first_learned_at 的作为词义补充
  const hits = []
  for (const tk of tokens.slice(0, 6)) {
    const r = await db.get('SELECT word, meaning, root, root_meaning FROM words WHERE LOWER(word) = ?', tk)
    if (r && !hits.find((h) => h.word === r.word)) hits.push(r)
  }
  // passage:有些 passages 表有 sentences(zh)字段,模糊搜英文一句拿翻译
  let translation = null
  try {
    const passage = await db.get("SELECT sentences FROM passages WHERE sentences LIKE ? LIMIT 1", `%${norm.slice(0, 30)}%`)
    if (passage?.sentences) {
      const list = typeof passage.sentences === 'string' ? JSON.parse(passage.sentences) : passage.sentences
      const found = (list || []).find((s) => String(s.en || '').toLowerCase().replace(/[^a-z'\s]/g, ' ').includes(norm.slice(0, 20)))
      if (found) translation = found.zh || null
    }
  } catch { /* 解析失败静默 */ }
  return {
    translate: translation || '暂无译本(网络不通或该句不在语料中,稍后连上网络会自动有)',
    grammar: hits.length ? `句中含词库词 ${hits.length} 个:${hits.slice(0, 3).map((h) => `${h.word}(${h.meaning?.split(/[,，;；]/)[0] || '—'})`).join('、')}` : '未匹配到词库中的词',
    sense: translation ? '这句出自词峰的分级短文(可去「阅读号列车」点开上下文)· ' + (hits[0] ? `重点词 ${hits[0].word} 见右侧词卡` : '回到车厢再读一遍') : '未在语料中找到这一句的上下文,网络通时由 AI 讲解补全',
    expression: hits[0]?.root ? `词根 ${hits[0].root.toUpperCase()}- · ${hits[0].root_meaning || ''}` : null,
    source: 'local',
  }
}

// ---- LRU 200 + 每用户 20/min 频控 ----
const lru = new Map() // key -> { value, ts }
const LRU_MAX = 200
const LRU_TTL = 1000 * 60 * 60 // 1h

function lruGet(k) {
  const e = lru.get(k)
  if (!e) return null
  if (Date.now() - e.ts > LRU_TTL) { lru.delete(k); return null }
  lru.delete(k); lru.set(k, e) // LRU 触尾
  return e.value
}
function lruSet(k, v) {
  lru.delete(k)
  lru.set(k, { value: v, ts: Date.now() })
  if (lru.size > LRU_MAX) {
    // Map 保留插入顺序,首项最旧
    const oldest = lru.keys().next().value
    if (oldest) lru.delete(oldest)
  }
}

const buckets = new Map() // user -> [timestamps]
const RATE_LIMIT = 20
const RATE_WINDOW = 60 * 1000

function rateCheck(user) {
  const now = Date.now()
  const arr = (buckets.get(user) || []).filter((t) => now - t < RATE_WINDOW)
  if (arr.length >= RATE_LIMIT) return { ok: false, retryAfter: Math.ceil((arr[0] + RATE_WINDOW - now) / 1000) }
  arr.push(now)
  buckets.set(user, arr)
  return { ok: true }
}

explainRouter.post('/explain', async (req, res) => {
  const { sentence, mode, word, title, userId } = req.body ?? {}
  const kind = mode === 'word' ? 'word' : 'sentence'
  const userKey = String(userId ?? 'anon')

  // 频控(限词模式:句子模式相对重,且阅读舱可预期低频)
  const rate = rateCheck(userKey)
  if (!rate.ok) return res.status(429).json(err(`讲解请求过于频繁,${rate.retryAfter}s 后再试`))

  if (kind === 'word') {
    if (typeof word !== 'string' || !word.trim()) return res.status(400).json(err('word 必填(非空字符串)'))
    const w = word.trim().slice(0, 40)
    const cacheKey = `w:${userKey}:${w.toLowerCase()}`
    const cached = lruGet(cacheKey)
    if (cached) return res.json(ok(cached))
    const llm = await llmExplain('word', { word: w })
    // 任意词都可点:词库直查(含词形还原)→ 仍没有就用构词速览兜底,不再 404
    const base = (await localWord(w)) || localAny(w)
    const out = llm ? { ...base, ...llm, source: 'llm' } : base
    lruSet(cacheKey, out)
    return res.json(ok(out))
  }
  // sentence 模式
  if (typeof sentence !== 'string' || !sentence.trim()) return res.status(400).json(err('sentence 必填(非空字符串)'))
  const cacheKey = `s:${userKey}:${sentence.toLowerCase().slice(0, 200)}`
  const cached = lruGet(cacheKey)
  if (cached) return res.json(ok(cached))
  const llm = await llmExplain('sentence', { sentence, title })
  const local = await localSentence(sentence)
  if (!local) return res.status(400).json(err('sentence 无效'))
  const out = llm ? { ...local, ...llm, source: 'llm' } : local
  lruSet(cacheKey, out)
  return res.json(ok(out))
})
