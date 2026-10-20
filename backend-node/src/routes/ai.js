// AI 口语发音建议:POST /api/ask
// 请求 { transcript(识别结果), original(原句), phoneme?(目标音标) }
// 响应壳 data: { advice, source: 'llm' | 'local' }
// 有 ANTHROPIC_API_KEY(优先)或 GEMINI_API_KEY 时调真模型;无 key 或调用失败时
// 降级为本地基于规则的对比分析(逐词对错 + 差异定位 + 通用建议),绝不硬编码任何 key。
import { Router } from 'express'
import { db } from '../db.js'
import { err, ok } from '../helpers.js'

export const aiRouter = Router()

// 要求模型输出短小中文 JSON:定位元音/辅音问题 + 给改进建议
const SYSTEM_PROMPT = `你是英语发音教练。用户会给你一句原句(original)、语音识别转写(transcript)和可选的目标音标(phoneme)。
请对比两者,指出用户最可能存在的元音或辅音发音问题(具体到音标),并给出简短可操作的中文改进建议。
只输出一个 JSON 对象,不要任何其他文字,格式:
{"problem": "哪个音发错了(含音标)", "advice": "怎么改(一两句)", "words": ["读错的关键词"]}`

// ---- LLM 调用(Anthropic Messages API 优先,Gemini 兜底) ----

function extractJson(text) {
  if (!text) return null
  const m = text.match(/\{[\s\S]*\}/) // 容忍模型输出被 ```json 包裹等噪声
  if (!m) return null
  try { return JSON.parse(m[0]) } catch { return null }
}

async function askAnthropic(key, transcript, original, phoneme) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: `original: ${original}\ntranscript: ${transcript}${phoneme ? `\nphoneme: ${phoneme}` : ''}` }],
    }),
    signal: AbortSignal.timeout(15000),
  })
  if (!res.ok) throw new Error(`anthropic ${res.status}`)
  const body = await res.json()
  return extractJson(body?.content?.[0]?.text)
}

async function askGemini(key, transcript, original, phoneme) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: 'user', parts: [{ text: `original: ${original}\ntranscript: ${transcript}${phoneme ? `\nphoneme: ${phoneme}` : ''}` }] }],
      generationConfig: { maxOutputTokens: 300, temperature: 0.3 },
    }),
    signal: AbortSignal.timeout(15000),
  })
  if (!res.ok) throw new Error(`gemini ${res.status}`)
  const body = await res.json()
  return extractJson(body?.candidates?.[0]?.content?.parts?.[0]?.text)
}

// ---- 本地降级分析:纯规则对比 transcript 与 original ----

// 常见"听错片段 → 音素问题"提示表(按顺序匹配差异片段)
const PHONEME_HINTS = [
  [/th/, '/θ/ /ð/ 咬舌音:舌尖轻轻贴住上齿送气,别读成 s / z'],
  [/v/, '/v/ 上齿轻咬下唇摩擦,别读成 w'],
  [/w/, '/w/ 双唇收圆快速张开,别读成 v'],
  [/l/, '/l/ 舌尖抵上齿龈,亮音要有'],
  [/r/, '/r/ 舌尖卷起不碰任何地方,别读成 l 或汉语"日"'],
  [/ng/, '/ŋ/ 后鼻音,舌根抵软腭'],
  [/er|ir|ur/, '/ɜː/ 长中央元音,舌位居中、嘴唇放松'],
  [/ee|ea/, '/iː/ 长元音要拉满,嘴角向两侧咧开'],
  [/i(?![i:])/, '/ɪ/ 短元音更松更短,别读成汉语"衣"'],
  [/a/, '/æ/ 或 /ɑː/:嘴巴张大或拉长,别读成汉语"唉"'],
  [/o/, '/ɒ/ 短圆唇向后,别读成汉语"欧"'],
  [/oo|ou/, '/uː/ 或 /aʊ/:区分长"乌"与"奥乌"滑动'],
  [/e/, '/e/ 短元音,嘴角微微咧开,别读成 /eɪ/'],
  [/s/, '/s/ 舌尖靠近齿龈送气,别读成汉语"丝"的浊化'],
  [/z/, '/z/ 声带振动,别与 /s/ 混淆'],
  [/d|t/, '词尾 /d/ /t/ 轻爆破即可,不要加汉语"得/特"'],
]

const normalize = (s) => String(s).toLowerCase().replace(/[^a-z'\s]/g, ' ').replace(/\s+/g, ' ').trim()
const words = (s) => normalize(s).split(' ').filter(Boolean)

// 找出 expected 与 heard 的第一处差异片段,并给出音素提示
function diffHint(expected, heard) {
  const a = expected, b = heard
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  const seg = a.slice(i, i + 3) || a // 期望词里"应该是"的片段(最多 3 个字母)
  for (const [re, tip] of PHONEME_HINTS) if (re.test(seg)) return tip
  return `与 "${seg}" 对应的音发得不够准,注意长短元音与清浊辅音的区别`
}

async function localAnalyze(transcript, original, phoneme) {
  const expected = words(original)
  const heard = words(transcript)
  const detail = []
  for (let i = 0; i < expected.length; i++) {
    const exp = expected[i]
    const got = heard[i] ?? '(未识别)'
    if (exp !== got) detail.push({ word: exp, heard: got, tip: diffHint(exp, got) })
  }
  // 若调用方指定了目标音标,附上知识库里的官方练习提示
  let phonemeTip = null
  if (phoneme) {
    const row = await db.get('SELECT tip FROM phonemes WHERE symbol = ?', String(phoneme))
    if (row) phonemeTip = `音标 ${phoneme}:${row.tip}`
  }

  if (!detail.length) {
    return {
      problem: phoneme ? `整句识别与原句一致;继续巩固 ${phoneme} 的发音` : '整句识别与原句一致,没有发现明显发音偏差',
      words: [],
      advice: [phonemeTip, '注意语调起伏和连读,录一句自己听听,和原声对比节奏。'].filter(Boolean).join(' '),
    }
  }
  const problems = [...new Set(detail.map((d) => d.tip))]
  return {
    problem: `共 ${detail.length}/${expected.length} 个词识别不一致,最可能的问题:${problems[0]}`,
    words: detail.map((d) => d.word).slice(0, 5),
    advice: `${problems.slice(0, 2).join(';')}。${phonemeTip ?? ''}建议放慢速度把错词单独读 5 遍,再用整句连读。`,
  }
}

// ---- 路由 ----

aiRouter.post('/ask', async (req, res) => {
  const { transcript, original, phoneme } = req.body ?? {}
  if (typeof transcript !== 'string' || !transcript.trim() || typeof original !== 'string' || !original.trim())
    return res.status(400).json(err('transcript 与 original 必须是非空字符串'))

  const anthropicKey = process.env.ANTHROPIC_API_KEY
  const geminiKey = process.env.GEMINI_API_KEY
  if (anthropicKey) {
    try {
      const advice = await askAnthropic(anthropicKey, transcript, original, phoneme)
      if (advice) return res.json(ok({ advice, source: 'llm' }))
    } catch (e) { console.warn('[ask] anthropic 调用失败,降级本地分析:', e.message) }
  }
  if (geminiKey) {
    try {
      const advice = await askGemini(geminiKey, transcript, original, phoneme)
      if (advice) return res.json(ok({ advice, source: 'llm' }))
    } catch (e) { console.warn('[ask] gemini 调用失败,降级本地分析:', e.message) }
  }
  return res.json(ok({ advice: await localAnalyze(transcript, original, phoneme), source: 'local' }))
})
