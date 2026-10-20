// 语法机械城:GET /api/grammar、POST /api/grammar/result、GET /api/grammar/state/:uid
// 掌握度(mastery 0~1):以该语法点最近一串答题为连续答对计数,
// mastery = min(1, 连续答对数 / 该点题库题数);答错即清零重新累计(错题流动系统)。
import { Router } from 'express'
import { db, J } from '../db.js'
import { err, ok, utcDateStr } from '../helpers.js'

export const grammarRouter = Router()

function pointMastery(resultsDesc, quizCount) {
  let streak = 0
  for (const r of resultsDesc) { // 由新到旧,连续答对计数
    if (r.correct) streak++
    else break
  }
  const denom = Math.max(quizCount, 1)
  return Math.round(Math.min(1.0, streak / denom) * 1000) / 1000
}

async function pointState(userId, point) {
  const results = await db.all(
    'SELECT * FROM grammar_results WHERE user_id = ? AND point_id = ? ORDER BY id DESC',
    userId, point.id)
  const attempts = results.length
  const wrong = results.filter((r) => !r.correct).length
  const quiz = J.parse(point.quiz)
  const mastery = attempts ? pointMastery(results, quiz.length) : 0.0
  return { point_id: point.id, mastery, attempts, wrong_count: wrong }
}

grammarRouter.get('/grammar', async (req, res) => {
  const points = await db.all('SELECT * FROM grammar_points ORDER BY id')
  return res.json(ok(points.map((p) => ({
    id: p.id,
    title: p.title,
    category: p.category,
    formula: p.formula,
    explanation: p.explanation,
    examples: J.parse(p.examples),
    machine: JSON.parse(p.machine || '{}'),
    quiz: J.parse(p.quiz),
  }))))
})

grammarRouter.post('/grammar/result', async (req, res) => {
  const { user_id: userId, point_id: pointId, quiz_index: quizIndex, correct } = req.body ?? {}
  const user = await db.get('SELECT * FROM users WHERE id = ?', userId)
  if (!user) return res.json(err(`user ${userId} not found`))
  const point = await db.get('SELECT * FROM grammar_points WHERE id = ?', pointId)
  if (!point) return res.json(err(`grammar point ${pointId} not found`))

  await db.run('INSERT INTO grammar_results (user_id, point_id, quiz_index, correct) VALUES (?, ?, ?, ?)',
    userId, pointId, quizIndex, correct ? 1 : 0)
  const now = new Date()
  await db.run('INSERT INTO activity_events (user_id, date, module, correct, total) VALUES (?, ?, ?, ?, 1)',
    userId, utcDateStr(now), 'grammar', correct ? 1 : 0)

  const results = await db.all(
    'SELECT * FROM grammar_results WHERE user_id = ? AND point_id = ? ORDER BY id DESC',
    userId, pointId)
  const mastery = pointMastery(results, J.parse(point.quiz).length)
  return res.json(ok({ ok: true, point_mastery: mastery }))
})

grammarRouter.get('/grammar/state/:userId', async (req, res) => {
  const userId = Number(req.params.userId)
  const user = await db.get('SELECT * FROM users WHERE id = ?', userId)
  if (!user) return res.json(err(`user ${userId} not found`))
  const points = await db.all('SELECT * FROM grammar_points ORDER BY id')
  const attemptedIds = new Set((await db.all(
    'SELECT DISTINCT point_id FROM grammar_results WHERE user_id = ?', userId)).map((r) => r.point_id))
  return res.json(ok(await Promise.all(points.filter((p) => attemptedIds.has(p.id)).map((p) => pointState(userId, p)))))
})