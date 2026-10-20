// 发音舱练习闭环:GET /api/phonetics/pairs、/rules、POST /api/phonetics/result、GET /api/phonetics/state/:uid
// kind: pair(听辨测试,ref_id=对子 id) | rule(拼读规则题,ref_id=规则 id) | drill(跟读打分,ref_id=音标符号)
import { Router } from 'express'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { db, DATA_DIR } from '../db.js'
import { err, ok, utcDateStr } from '../helpers.js'

export const phoneticsRouter = Router()

const load = (file) => JSON.parse(readFileSync(path.join(DATA_DIR, file), 'utf-8'))

phoneticsRouter.get('/phonetics/pairs', (_req, res) => res.json(ok(load('minimal_pairs.json'))))
phoneticsRouter.get('/phonetics/rules', (_req, res) => res.json(ok(load('phonics_rules.json'))))

phoneticsRouter.post('/phonetics/result', async (req, res) => {
  const { user_id: userId, kind, ref_id: refId, correct } = req.body ?? {}
  const user = await db.get('SELECT * FROM users WHERE id = ?', userId)
  if (!user) return res.json(err(`user ${userId} not found`))
  if (!['pair', 'rule', 'drill'].includes(kind)) return res.json(err('kind 必须是 pair / rule / drill'))

  await db.run('INSERT INTO phonetic_results (user_id, kind, ref_id, correct) VALUES (?, ?, ?, ?)',
    userId, kind, String(refId ?? ''), correct ? 1 : 0)
  const now = new Date()
  await db.run('INSERT INTO activity_events (user_id, date, module, correct, total) VALUES (?, ?, ?, ?, 1)',
    userId, utcDateStr(now), 'phonetics', correct ? 1 : 0)
  return res.json(ok({ ok: true }))
})

phoneticsRouter.get('/phonetics/state/:userId', async (req, res) => {
  const userId = Number(req.params.userId)
  const user = await db.get('SELECT * FROM users WHERE id = ?', userId)
  if (!user) return res.json(err(`user ${userId} not found`))
  const rows = await db.all(
    'SELECT kind, ref_id, correct, created_at FROM phonetic_results WHERE user_id = ? ORDER BY id DESC',
    userId)
  return res.json(ok(rows.map((r) => ({
    kind: r.kind, ref_id: r.ref_id, correct: !!r.correct, created_at: r.created_at,
  }))))
})