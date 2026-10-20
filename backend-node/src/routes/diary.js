// 英语日记:中文起笔 → AI 译英 → 逐句带读(前端复用口语打分引擎)
//   GET    /api/users/:userId/diary            → 历史列表(倒序 ≤100)
//   POST   /api/users/:userId/diary            → 保存一篇 {zh_text, en_text}
//   PATCH  /api/users/:userId/diary/:id        → 手动修正译文 {en_text}
//   DELETE /api/users/:userId/diary/:id        → 删除
//   POST   /api/diary/translate                → 逐句中→英 {sentences:[...]} → {pairs:[{zh,en}]}
// AI key 走 .env / 系统环境变量(ANTHROPIC_API_KEY 优先,其次 GEMINI_API_KEY);
// 无 key 时明确报错给配置指引,不做本地降级(拼词库翻不了整句,只会误导)
import { Router } from 'express'
import { db } from '../db.js'
import { err, ok } from '../helpers.js'

export const diaryRouter = Router()

// ---------- 逐句翻译 ----------
const TRANSLATE_PROMPT = `你是中英翻译。把用户给的编号中文句子逐句翻译成自然、地道的英语,词汇难度贴近英语学习者。
只输出一个 JSON:{"pairs":[{"i":0,"en":"..."}]}。i 与输入编号一一对应,条目数必须与输入完全一致,不要合并或拆分句子。`

// 模型可配:走中转时用中转的模型名(如 SYKJ),默认官方小模型
const ANTHROPIC_MODEL = () => process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001'

// 提取文本块:中转/思考型模型回复里 content[0] 可能是 thinking 块,要扫全部 type=text
function extractJson(content) {
  const blocks = Array.isArray(content) ? content : null
  const text = blocks
    ? blocks.filter((b) => b?.type === 'text').map((b) => b.text).join('\n')
    : String(content ?? '')
  const m = text.match(/\{[\s\S]*\}/)
  if (!m) return null
  try { return JSON.parse(m[0]) } catch { return null }
}

async function askAnthropic(key, baseUrl, sentences) {
  const res = await fetch(`${baseUrl}/v1/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL(),
      max_tokens: 2000,
      system: TRANSLATE_PROMPT,
      messages: [{ role: 'user', content: `句子列表:\n${sentences.map((s, i) => `${i}. ${s}`).join('\n')}` }],
    }),
    signal: AbortSignal.timeout(30000),
  })
  if (!res.ok) throw new Error(`anthropic ${res.status}`)
  const body = await res.json()
  return extractJson(body?.content)
}

async function askGemini(key, sentences) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: TRANSLATE_PROMPT }] },
      contents: [{ role: 'user', parts: [{ text: `句子列表:\n${sentences.map((s, i) => `${i}. ${s}`).join('\n')}` }] }],
      generationConfig: { maxOutputTokens: 2000, temperature: 0.2 },
    }),
    signal: AbortSignal.timeout(30000),
  })
  if (!res.ok) throw new Error(`gemini ${res.status}`)
  const body = await res.json()
  return extractJson(body?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('\n'))
}

// POST /api/diary/translate {sentences:[...]} → {pairs:[{zh,en}], source}
diaryRouter.post('/diary/translate', async (req, res) => {
  const sentences = Array.isArray(req.body?.sentences)
    ? req.body.sentences.map((s) => String(s ?? '').trim()).filter(Boolean)
    : []
  if (!sentences.length) return res.status(400).json(err('sentences 不能为空'))
  if (sentences.length > 40) return res.status(400).json(err('句子太多(>40),请分批翻译'))
  if (sentences.some((s) => s.length > 500)) return res.status(400).json(err('单句太长(>500 字符)'))

  const anthropicKey = process.env.ANTHROPIC_API_KEY
  const geminiKey = process.env.GEMINI_API_KEY
  if (!anthropicKey && !geminiKey) {
    return res.status(503).json(err('未配置 AI 翻译 key:请在 backend-node/.env 里填写 ANTHROPIC_API_KEY 或 GEMINI_API_KEY(参考 .env.example),然后重启后端'))
  }

  let parsed = null
  if (anthropicKey) {
    const baseUrl = (process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/+$/, '')
    try { parsed = await askAnthropic(anthropicKey, baseUrl, sentences) }
    catch (e) { console.warn('[diary] anthropic 失败,降级 gemini:', e.message) }
  }
  if (!parsed && geminiKey) {
    try { parsed = await askGemini(geminiKey, sentences) }
    catch (e) { console.warn('[diary] gemini 失败:', e.message) }
  }
  // 校验对齐:LLM 必须逐句返回且条数一致
  const pairs = Array.isArray(parsed?.pairs) ? parsed.pairs : null
  if (!pairs || pairs.length !== sentences.length) {
    return res.json(err('翻译结果与句子数不齐,请再试一次'))
  }
  const byIdx = new Map(pairs.map((p) => [Number(p.i), String(p.en ?? '').trim()]))
  const out = []
  for (let i = 0; i < sentences.length; i++) {
    const en = byIdx.get(i)
    if (!en) return res.json(err(`翻译结果不完整(第 ${i + 1} 句缺失),请再试一次`))
    out.push({ zh: sentences[i], en })
  }
  return res.json(ok({ pairs: out, source: 'llm' }))
})

// ---------- 历史条目 CRUD ----------
async function fetchOwnedDiary(userId, id) {
  return db.get('SELECT * FROM diary_entries WHERE id = ? AND user_id = ?', Number(id), userId)
}

// GET /api/users/:userId/diary → 列表(倒序,≤100)
diaryRouter.get('/users/:userId/diary', async (req, res) => {
  const userId = Number(req.params.userId)
  const user = await db.get('SELECT * FROM users WHERE id = ?', userId)
  if (!user) return res.json(err(`user ${userId} not found`))
  const rows = await db.all(
    'SELECT * FROM diary_entries WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 100', userId)
  return res.json(ok(rows))
})

// POST /api/users/:userId/diary {zh_text, en_text} → 保存
diaryRouter.post('/users/:userId/diary', async (req, res) => {
  const userId = Number(req.params.userId)
  const user = await db.get('SELECT * FROM users WHERE id = ?', userId)
  if (!user) return res.status(400).json(err(`user ${userId} not found`))

  const zh = String(req.body?.zh_text ?? '').trim()
  const en = String(req.body?.en_text ?? '').trim()
  if (!zh || !en) return res.status(400).json(err('zh_text / en_text 不能为空'))
  if (zh.length > 2000) return res.status(400).json(err('中文太长(>2000 字)'))
  if (en.length > 4000) return res.status(400).json(err('英文太长(>4000 字符)'))

  const r = await db.run('INSERT INTO diary_entries (user_id, zh_text, en_text) VALUES (?, ?, ?)', userId, zh, en)
  const fresh = await db.get('SELECT * FROM diary_entries WHERE id = ?', Number(r.lastInsertRowid))
  return res.json(ok(fresh))
})

// PATCH /api/users/:userId/diary/:id {en_text} → 手动修正译文
diaryRouter.patch('/users/:userId/diary/:id', async (req, res) => {
  const userId = Number(req.params.userId)
  const entry = await fetchOwnedDiary(userId, req.params.id)
  if (!entry) return res.json(err(`diary entry not found`))
  const en = String(req.body?.en_text ?? '').trim()
  if (!en) return res.status(400).json(err('en_text 不能为空'))
  if (en.length > 4000) return res.status(400).json(err('英文太长(>4000 字符)'))
  await db.run('UPDATE diary_entries SET en_text = ? WHERE id = ?', en, entry.id)
  const fresh = await db.get('SELECT * FROM diary_entries WHERE id = ?', entry.id)
  return res.json(ok(fresh))
})

// DELETE /api/users/:userId/diary/:id → 删除
diaryRouter.delete('/users/:userId/diary/:id', async (req, res) => {
  const userId = Number(req.params.userId)
  const entry = await fetchOwnedDiary(userId, req.params.id)
  if (!entry) return res.json(err(`diary entry not found`))
  await db.run('DELETE FROM diary_entries WHERE id = ?', entry.id)
  return res.json(ok({ ok: true }))
})
