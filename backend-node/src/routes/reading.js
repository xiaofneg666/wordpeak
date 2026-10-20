// 阅读号列车:POST /api/reading/result(module='reading' 计入画像)
import { Router } from 'express'
import { db } from '../db.js'
import { err, ok, utcDateStr } from '../helpers.js'

export const readingRouter = Router()

readingRouter.post('/reading/result', async (req, res) => {
  const { user_id: userId, passage_id: passageId, correct_count: correctCount, total } = req.body ?? {}
  const user = await db.get('SELECT * FROM users WHERE id = ?', userId)
  if (!user) return res.json(err(`user ${userId} not found`))
  const passage = await db.get("SELECT * FROM passages WHERE id = ? AND type = 'reading'", passageId)
  if (!passage) return res.json(err(`reading passage ${passageId} not found`))

  await db.run('INSERT INTO reading_results (user_id, passage_id, correct_count, total) VALUES (?, ?, ?, ?)',
    userId, passageId, correctCount, total)
  const now = new Date()
  await db.run('INSERT INTO activity_events (user_id, date, module, correct, total) VALUES (?, ?, ?, ?, ?)',
    userId, utcDateStr(now), 'reading', correctCount, total)
  const accuracy = Math.round((correctCount / total) * 1000) / 1000
  return res.json(ok({ ok: true, accuracy }))
})