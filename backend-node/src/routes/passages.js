// 听力峡谷/阅读号列车/口语竞技场:GET /api/passages、POST /api/listening/result、POST /api/speaking/result
import { Router } from 'express'
import { db, J } from '../db.js'
import { err, ok, utcDateStr } from '../helpers.js'

export const passagesRouter = Router()

passagesRouter.get('/passages', async (req, res) => {
  // ?type=listening|reading|speaking 可选过滤(前端虽全量拉,但契约上按直觉应生效)
  const type = typeof req.query.type === 'string' ? req.query.type : ''
  const rows = type
    ? await db.all('SELECT * FROM passages WHERE type = ? ORDER BY id', type)
    : await db.all('SELECT * FROM passages ORDER BY id')
  return res.json(ok(rows.map((p) => ({
    id: p.id,
    title: p.title,
    level: p.level,
    type: p.type,
    sentences: J.parse(p.sentences),
    questions: J.parse(p.questions),
  }))))
})

// 历史:GET /passages/history?type=listening|reading&user_id=&limit=(默认 20,上限 50)
// 结算卡「上次这篇 X%」对比的来源——新记录 DESC,前端按 passage_id 找最近一条
passagesRouter.get('/passages/history', async (req, res) => {
  const type = String(req.query.type ?? '')
  if (type !== 'listening' && type !== 'reading')
    return res.status(400).json(err('type 必须是 listening/reading 之一'))
  const userId = req.query.user_id
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20))
  const user = await db.get('SELECT id FROM users WHERE id = ?', userId)
  if (!user) return res.json(err(`user ${userId} not found`))
  const table = type === 'listening' ? 'listening_results' : 'reading_results'
  const rows = await db.all(
    `SELECT passage_id, correct_count, total, created_at FROM ${table} WHERE user_id = ? ORDER BY id DESC LIMIT ?`,
    userId, limit)
  return res.json(ok({
    items: rows.map((r) => ({
      passage_id: r.passage_id,
      right: r.correct_count,
      total: r.total,
      accuracy: r.total ? Math.round((r.correct_count / r.total) * 1000) / 1000 : 0,
      date: r.created_at,
    })),
  }))
})

passagesRouter.post('/listening/result', async (req, res) => {
  const { user_id: userId, passage_id: passageId, correct_count: correctCount, total } = req.body ?? {}
  const user = await db.get('SELECT * FROM users WHERE id = ?', userId)
  if (!user) return res.json(err(`user ${userId} not found`))
  const passage = await db.get('SELECT * FROM passages WHERE id = ?', passageId)
  if (!passage) return res.json(err(`passage ${passageId} not found`))

  await db.run('INSERT INTO listening_results (user_id, passage_id, correct_count, total) VALUES (?, ?, ?, ?)',
    userId, passageId, correctCount, total)
  const now = new Date()
  await db.run('INSERT INTO activity_events (user_id, date, module, correct, total) VALUES (?, ?, ?, ?, ?)',
    userId, utcDateStr(now), 'listening', correctCount, total)

  const accuracy = Math.round((correctCount / total) * 1000) / 1000
  return res.json(ok({ ok: true, accuracy }))
})

passagesRouter.post('/speaking/result', async (req, res) => {
  const { user_id: userId, passage_id: passageId, sentence_index: sentenceIndex, score, transcript } = req.body ?? {}
  const user = await db.get('SELECT * FROM users WHERE id = ?', userId)
  if (!user) return res.json(err(`user ${userId} not found`))
  const passage = await db.get('SELECT * FROM passages WHERE id = ?', passageId)
  if (!passage) return res.json(err(`passage ${passageId} not found`))
  if (passage.type !== 'speaking') return res.json(err(`passage ${passageId} is not a speaking passage`))

  await db.run('INSERT INTO speaking_results (user_id, passage_id, sentence_index, score, transcript) VALUES (?, ?, ?, ?, ?)',
    userId, passageId, sentenceIndex, score, transcript || '')
  const now = new Date()
  await db.run('INSERT INTO activity_events (user_id, date, module, correct, total) VALUES (?, ?, ?, ?, 1)',
    userId, utcDateStr(now), 'speaking', score >= 0.75 ? 1 : 0) // 阈值判定,计入正确率
  return res.json(ok({ ok: true }))
})