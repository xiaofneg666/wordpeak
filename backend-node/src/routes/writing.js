// 写作工坊:POST /api/writing/result(成绩入库 + 计入画像) + POST /api/writing/grade(逐句批改,LLM 三级降级)
import { Router } from 'express'
import { db } from '../db.js'
import { err, ok, utcDateStr } from '../helpers.js'

export const writingRouter = Router()

writingRouter.post('/writing/result', async (req, res) => {
  const { user_id: userId, stage, word_id: wordId, score, text, feedback } = req.body ?? {}
  const stg = String(stage ?? '')
  if (stg !== 'sentence' && stg !== 'essay')
    return res.status(400).json(err('stage 必须是 sentence/essay 之一'))
  const sc = Number(score)
  if (!Number.isFinite(sc) || sc < 0 || sc > 1)
    return res.status(400).json(err('score 必须是 0-1 之间的数字'))
  const user = await db.get('SELECT * FROM users WHERE id = ?', userId)
  if (!user) return res.json(err(`user ${userId} not found`))

  if (wordId != null) {
    const w = await db.get('SELECT id FROM words WHERE id = ?', Number(wordId))
    if (!w) return res.json(err(`word ${wordId} not found`))
  }

  await db.run(`INSERT INTO writing_results (user_id, stage, word_id, score, text, feedback) VALUES (?, ?, ?, ?, ?, ?)`,
    userId, stg, wordId ?? null, Number(sc), String(text ?? '').slice(0, 4000), JSON.stringify(feedback ?? []))
  const now = new Date()
  const correct = Math.round(sc * 10)
  await db.run('INSERT INTO activity_events (user_id, date, module, correct, total) VALUES (?, ?, ?, ?, ?)',
    userId, utcDateStr(now), 'writing', correct, 10)
  return res.json(ok({ ok: true, score: Math.round(sc * 100) / 100 }))
})

// 历史回看:GET /writing/history?user_id=&limit=(默认 30)——按 id 倒序取航行日志
writingRouter.get('/writing/history', async (req, res) => {
  const userId = req.query.user_id
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 30))
  const user = await db.get('SELECT id FROM users WHERE id = ?', userId)
  if (!user) return res.json(err(`user ${userId} not found`))
  const rows = await db.all(
    'SELECT id, stage, word_id, score, text, feedback, created_at FROM writing_results WHERE user_id = ? ORDER BY id DESC LIMIT ?',
    userId, limit)
  const items = rows.map((r) => {
    let checks = []
    try { checks = JSON.parse(r.feedback ?? '[]') } catch { /* 兼容旧脏数据 */ }
    return {
      id: r.id, stage: r.stage, word_id: r.word_id, score: r.score,
      date: r.created_at, text: r.text, checks,
    }
  })
  return res.json(ok({ items }))
})

// ---- 逐句批改(AI 教练)----
// 请求:{ text, stage:'sentence'|'essay', word?, word_ids?[] }
// 响应:{ score, sentences:[{en, issue, tip}], advice, source:'llm'|'local' }

const GRADE_SYSTEM = `你是英语写作教练。用户提交了一段英文写作(可能是造句或短文),可能附了必须用上的词/词根。
请逐句评估:每句给一行 {en, issue(可有可无,具体到 grammar/usage/spelling 一点,中文), tip(怎么改,中文一句)};
最后输出一个 score(0-1,综合目标词使用、句法正确度、表达多样性)和一句 advice(中文,鼓励性+下一步具体动作)。
只输出 JSON,不要任何其他文字:{"score":0.0~1.0, "sentences":[{"en","issue","tip"}], "advice":"..."}`

const INFLECTIONS = (w) => {
  const s = String(w).toLowerCase()
  const set = new Set([s])
  if (s.length > 3 && s.endsWith('y') && !/[aeiou]y$/.test(s)) set.add(s.slice(0, -1) + 'ied')
  if (/(s|x|z|ch|sh)$/.test(s)) { set.add(s + 'es'); set.add(s + 'ing'); set.add(s + 'ed') }
  if (/e$/.test(s)) { set.add(s + 's'); set.add(s.slice(0, -1) + 'ing'); set.add(s + 'd') }
  else if (/[^aeiou][bcdfghjklmnpqrstvwxyz]$/.test(s)) { set.add(s + s.slice(-1) + 'ed'); set.add(s + s.slice(-1) + 'ing'); set.add(s + 's') }
  else { set.add(s + 's'); set.add(s + 'ing'); set.add(s + 'ed') }
  return [...set].map((v) => v.replace(/[^a-z]/g, ''))
}

function splitSentences(text) {
  return String(text || '').trim().split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 0)
}

// 本地逐句规则:造句打 1 条整句条目,成文打每句条目;同时聚合 0-1 总分
function localGrade({ text, stage, word, wordIds }) {
  const clean = String(text || '').trim()
  const sentences = splitSentences(clean)
  const items = []
  if (!clean) {
    return { score: 0, sentences: [{ en: '', issue: '还没有写东西', tip: '先随便写一句开始,系统会一句一句帮你看' }], advice: '第一句最难,从一个你已经认识的词开始造句就好。' }
  }
  // 目标词判定(造句:1 个;成文:N 个)
  const tokenRe = /[A-Za-z']+/g
  const tokens = (clean.toLowerCase().match(tokenRe) || [])
  const targetWords = stage === 'sentence' ? (word ? [word] : []) : (wordIds || [])
  const usedSet = new Set(tokens)
  const usedTargets = targetWords.filter((w) => {
    const forms = INFLECTIONS(w).map((v) => v.replace(/[^a-z]/g, ''))
    return forms.some((f) => usedSet.has(f))
  })
  const missingTargets = targetWords.filter((w) => !usedTargets.includes(w))

  // 全局统计
  const totalLen = tokens.length
  const hasCJK = /[一-鿿]/.test(clean)
  const capOk = /^[A-Z]/.test(clean)
  const endsOk = /[.!?]$/.test(clean)
  const avgLen = totalLen ? tokens.reduce((a, t) => a + t.length, 0) / totalLen : 0
  // 重复率(高重复扣分)
  const freq = {}
  for (const t of tokens) freq[t] = (freq[t] || 0) + 1
  const repeatedHeavy = Object.values(freq).some((n) => n > Math.max(4, totalLen * 0.25))

  // 逐句条目
  if (stage === 'sentence') {
    const s = clean
    if (!capOk) items.push({ en: s, issue: '句首没有大写', tip: '英文句子首字母需要大写' })
    if (!endsOk) items.push({ en: s, issue: '句末没有 . ! ?', tip: '用 . / ! / ? 给句子收尾' })
    if (hasCJK) items.push({ en: s, issue: '夹杂了中文字符', tip: '这一关要全英文,别怕错——试着用会的词说清楚意思' })
    if (totalLen < 3) items.push({ en: s, issue: `只 ${totalLen} 个词`, tip: '再补一两个词把场景说完整' })
    if (avgLen < 3) items.push({ en: s, issue: `平均词长 ${avgLen.toFixed(1)}`, tip: '有些词像没写完整,检查一下拼写和变位' })
    if (targetWords.length && missingTargets.length) items.push({ en: s, issue: `没找到「${missingTargets.join(' / ')}」或其常见变形`, tip: `把「${missingTargets[0]}」放进句子——试着用 ${INFLECTIONS(missingTargets[0]).slice(0, 3).join(' / ')} 之一` })
    if (repeatedHeavy) items.push({ en: s, issue: '同一词用得过于密集', tip: '尝试换同义词或换结构,多样性是写作的呼吸' })
  } else {
    for (const s of sentences) {
      const first = s.charAt(0)
      const last = s.charAt(s.length - 1)
      if (!/^[A-Z]/.test(s)) items.push({ en: s, issue: '句首小写', tip: '句首字母大写' })
      if (!/[.!?]$/.test(s.trim())) items.push({ en: s, issue: '缺句末标点', tip: '用 . / ! / ? 收尾' })
      if (/\s{2,}/.test(s)) items.push({ en: s, issue: '多余空格', tip: '英文单词之间只留一个空格' })
      if (/[A-Z]/.test(s.slice(1))) items.push({ en: s, issue: '句中随机大写', tip: '除专有名词与句首外,英文不大写' })
    }
    if (targetWords.length && missingTargets.length) items.push({ en: sentences[0] || clean, issue: `未用到「${missingTargets.join(' / ')}」`, tip: `至少其中之一要进入段落;形变也算: ${missingTargets.slice(0, 2).map((w) => INFLECTIONS(w).slice(0, 3).join('/')).join(' · ')}` })
  }
  if (!items.length) items.push({ en: stage === 'sentence' ? clean : sentences[0] || clean, issue: '没有发现明显问题', tip: '很好——下次试着把句子再拉长一两句,挑战更复杂的结构' })

  // 聚合分(0-1):造句权重(目标词 0.30 + 大写 0.15 + 标点 0.10 + 长度 0.20 + 纯英文 0.15 + 词形完整 0.10),成文弱化目标词权重
  let score = 1
  if (stage === 'sentence') {
    if (targetWords.length && !usedTargets.length) score -= 0.30
    if (!capOk) score -= 0.15
    if (!endsOk) score -= 0.10
    if (totalLen < 3 || totalLen > 25) score -= 0.20
    if (hasCJK) score -= 0.15
    if (avgLen < 3) score -= 0.10
    if (repeatedHeavy) score -= 0.08
  } else {
    if (targetWords.length) score -= 0.20 * (missingTargets.length / targetWords.length)
    if (sentences.length < 3) score -= 0.15
    if (hasCJK) score -= 0.10
    if (repeatedHeavy) score -= 0.08
    const cnt = items.filter((it) => /(大写|标点|空格|随机大写)/.test(it.issue)).length
    score -= 0.05 * cnt
  }
  score = Math.max(0, Math.min(1, Math.round(score * 100) / 100))

  const advice = stage === 'sentence'
    ? (usedTargets.length
        ? '把目标词用上是最关键的一步——下次试试用两个不同的句子分别用它,看看自己理解的不同侧面'
        : '核心目标没达成不是失败——把它再换一种表达进句子里,比换一个词更有效')
    : `本段共 ${sentences.length} 句${targetWords.length ? `,已用上 ${usedTargets.length}/${targetWords.length} 个目标词${missingTargets.length ? `(缺: ${missingTargets.join('、')})` : ''}` : ''}。下一步:把刚才批改里最常出现的那一类问题专门再写一段,直到那一类不再出现。`

  return { score, sentences: items, advice }
}

async function gradeAnthropic(key, payload) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 900,
      system: GRADE_SYSTEM,
      messages: [{ role: 'user', content: `stage: ${payload.stage}\n${payload.word ? `target_word: ${payload.word}\n` : ''}${payload.wordIds?.length ? `target_words: ${payload.wordIds.join(', ')}\n` : ''}text:\n${payload.text}` }],
    }),
    signal: AbortSignal.timeout(15000),
  })
  if (!res.ok) throw new Error(`anthropic ${res.status}`)
  const body = await res.json()
  const txt = body?.content?.[0]?.text
  if (!txt) return null
  const m = txt.match(/\{[\s\S]*\}/)
  if (!m) return null
  try {
    const j = JSON.parse(m[0])
    if (typeof j.score === 'number' && Array.isArray(j.sentences)) return j
  } catch { /* 解析失败,降级 */ }
  return null
}

async function gradeGemini(key, payload) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: GRADE_SYSTEM }] },
      contents: [{ role: 'user', parts: [{ text: `stage: ${payload.stage}\n${payload.word ? `target_word: ${payload.word}\n` : ''}${payload.wordIds?.length ? `target_words: ${payload.wordIds.join(', ')}\n` : ''}text:\n${payload.text}` }] }],
      generationConfig: { maxOutputTokens: 900, temperature: 0.3 },
    }),
    signal: AbortSignal.timeout(15000),
  })
  if (!res.ok) throw new Error(`gemini ${res.status}`)
  const body = await res.json()
  const txt = body?.candidates?.[0]?.content?.parts?.[0]?.text
  if (!txt) return null
  const m = txt.match(/\{[\s\S]*\}/)
  if (!m) return null
  try {
    const j = JSON.parse(m[0])
    if (typeof j.score === 'number' && Array.isArray(j.sentences)) return j
  } catch { /* 降级 */ }
  return null
}

writingRouter.post('/writing/grade', async (req, res) => {
  const { text, stage, word, word_ids: wordIds } = req.body ?? {}
  const stg = String(stage ?? '')
  if (stg !== 'sentence' && stg !== 'essay') return res.status(400).json(err('stage 必须是 sentence/essay 之一'))
  if (typeof text !== 'string' || !text.trim()) return res.status(400).json(err('text 必须是非空字符串'))

  const payload = { text, stage, word, wordIds: Array.isArray(wordIds) ? wordIds : [] }
  const anthropicKey = process.env.ANTHROPIC_API_KEY
  const geminiKey = process.env.GEMINI_API_KEY
  if (anthropicKey) {
    try { const r = await gradeAnthropic(anthropicKey, payload); if (r) return res.json(ok({ ...r, source: 'llm' })) }
    catch (e) { console.warn('[writing/grade] anthropic 失败,降级:', e.message) }
  }
  if (geminiKey) {
    try { const r = await gradeGemini(geminiKey, payload); if (r) return res.json(ok({ ...r, source: 'llm' })) }
    catch (e) { console.warn('[writing/grade] gemini 失败,降级:', e.message) }
  }
  return res.json(ok({ ...localGrade(payload), source: 'local' }))
})
