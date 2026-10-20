// 翻译端点:POST /api/translate → 单句英文→中文(主)或任意→中文
// 有 ANTHROPIC_KEY/GEMINI_KEY 时调模型;无则降级:对常见模板套规则,陌生短语返回
//   { source: 'local', note: 'local-only' },前端能据此 fallback。
// 落库设计:不写 translation_results,所有翻译按需计算,不污染知识库。
import { Router } from 'express'
import { err, ok } from '../helpers.js'

export const translateRouter = Router()

const SYSTEM_PROMPT = `你是英中翻译。给出 1 个最自然的中文释义。
只输出一个 JSON:{"zh":"...","note":""}。若输入不是英文,提示一下。`

async function askAnthropic(key, text) {
  // 走中转时配 ANTHROPIC_BASE_URL / ANTHROPIC_MODEL(见 .env.example)
  const baseUrl = (process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/+$/, '')
  const res = await fetch(`${baseUrl}/v1/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001', max_tokens: 200, system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: `text: ${text}` }],
    }),
    signal: AbortSignal.timeout(15000),
  })
  if (!res.ok) throw new Error(`anthropic ${res.status}`)
  const body = await res.json()
  // 思考型模型 content[0] 可能是 thinking 块,扫全部 type=text 再取 JSON
  const t = (body?.content ?? []).filter((b) => b?.type === 'text').map((b) => b.text).join('\n')
  if (!t) return null
  const m = t.match(/\{[\s\S]*\}/)
  if (!m) return null
  try { return JSON.parse(m[0]) } catch { return null }
}

async function askGemini(key, text) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: 'user', parts: [{ text: `text: ${text}` }] }],
      generationConfig: { maxOutputTokens: 200, temperature: 0.2 },
    }),
    signal: AbortSignal.timeout(15000),
  })
  if (!res.ok) throw new Error(`gemini ${res.status}`)
  const body = await res.json()
  const t = body?.candidates?.[0]?.content?.parts?.[0]?.text
  if (!t) return null
  const m = t.match(/\{[\s\S]*\}/)
  if (!m) return null
  try { return JSON.parse(m[0]) } catch { return null }
}

// 本地降级:利用 store 已知翻译(命中词库 example.zh / meaning);其余返回 generic note
async function localTranslate(text, hint) {
  // hint 可选:前端传 { known_words: [{word, zh, ...}] } 时,我们从 example/meaning 里查
  const known = hint?.known_words || []
  const lower = text.toLowerCase()
  // 句子级别的「已知词汇拼接」近似释义:用各词的 meaning 串起来
  const found = []
  for (const w of known) {
    const re = new RegExp(`\\b${w.word.toLowerCase().replace(/[^a-z]/g, '')}\\b`)
    if (re.test(lower)) found.push(w.meaning?.split(/[,，;；]/)[0] || w.word)
  }
  if (found.length) {
    return { zh: `「${text}」— 含已知词:${found.join('; ')}。整句建议在 Settings 开启 AI 翻译以获得更准的释义。`, source: 'local', note: 'partial', known_hits: found.length }
  }
  return { zh: null, source: 'local', note: 'no_keyword_model' }
}

translateRouter.post('/translate', async (req, res) => {
  const { text, hint } = req.body ?? {}
  const t = String(text ?? '').trim()
  if (!t) return res.status(400).json(err('text 不能为空'))
  if (t.length > 1000) return res.status(400).json(err('text 太长(>1000 字符)'))

  const anthropicKey = process.env.ANTHROPIC_API_KEY
  const geminiKey = process.env.GEMINI_API_KEY
  if (anthropicKey) {
    try { const r = await askAnthropic(anthropicKey, t); if (r) return res.json(ok({ ...r, source: 'llm' })) }
    catch (e) { console.warn('[translate] anthropic 失败,降级:', e.message) }
  }
  if (geminiKey) {
    try { const r = await askGemini(geminiKey, t); if (r) return res.json(ok({ ...r, source: 'llm' })) }
    catch (e) { console.warn('[translate] gemini 失败,降级:', e.message) }
  }
  const local = await localTranslate(t, hint)
  return res.json(ok(local))
})