// 复习队列与答题:GET /api/review/queue/:uid、POST /api/review/result、GET /api/review/forecast/:uid/:wordId
import { Router } from 'express'
import { db } from '../db.js'
import { err, ok, iso, wordRetrievability, utcDateStr } from '../helpers.js'
import {
  gradeFor, sm2Update, computeStrength, stateLabel,
  resolveGrade, fsrsUpdate, fsrsRetrievability, FSRS_DEFAULT_RETENTION,
} from '../srs.js'

export const reviewRouter = Router()

// users.prefs.desiredRetention(目标记忆保持率,默认 0.90;SettingsView 可调 85/90/95%)
function desiredRetentionOf(user) {
  try {
    const prefs = user?.prefs ? JSON.parse(user.prefs) : {}
    const r = Number(prefs.desiredRetention)
    if (Number.isFinite(r)) return Math.min(0.99, Math.max(0.7, r))
  } catch { /* 坏 JSON 退默认 */ }
  return FSRS_DEFAULT_RETENTION
}

reviewRouter.get('/review/queue/:userId', async (req, res) => {
  const userId = Number(req.params.userId)
  const user = await db.get('SELECT * FROM users WHERE id = ?', userId)
  if (!user) return res.json(err(`user ${userId} not found`))
  const count = Math.max(1, Math.min(50, Number(req.query.count) || 10))
  const now = new Date()

  const allWordIds = (await db.all("SELECT id FROM words WHERE family <> 'general' ORDER BY id")).map((r) => r.id)
  const states = new Map((await db.all('SELECT * FROM user_words WHERE user_id = ?', userId)).map((s) => [s.word_id, s]))

  // 到期词:due_at <= now,按当前记忆概率 R 升序(越暗、越危急的先复习)
  const dueItems = []
  for (const s of states.values()) {
    if (s.due_at != null && new Date(s.due_at + 'Z') <= now) {
      const isNew = s.first_learned_at == null
      const r = isNew ? 0.0 : (wordRetrievability(s, now) ?? 0.0)
      dueItems.push({ wordId: s.word_id, r })
    }
  }
  dueItems.sort((a, b) => a.r - b.r)
  const queue = dueItems.slice(0, count).map((x) => ({ word_id: x.wordId, is_new: false, retrievability: x.r }))

  // 不足 count 则补新词(按难度与 id 顺序,先易后难)
  if (queue.length < count) {
    const learnedIds = new Set(states.keys())
    for (const wid of allWordIds) {
      if (queue.length >= count) break
      if (!learnedIds.has(wid)) queue.push({ word_id: wid, is_new: true, retrievability: null })
    }
  }

  return res.json(ok(queue))
})

reviewRouter.post('/review/result', async (req, res) => {
  const { user_id: userId, word_id: wordId, response_ms: responseMs, self_grade: selfGrade } = req.body ?? {}
  // self_grade(学习舱自评:'known'|'fuzzy'|'unknown')优先;不传则按 correct/response_ms(旧契约,兼容老前端)
  const correct = selfGrade != null ? selfGrade !== 'unknown' : !!req.body?.correct
  const user = await db.get('SELECT * FROM users WHERE id = ?', userId)
  if (!user) return res.json(err(`user ${userId} not found`))
  const word = await db.get('SELECT * FROM words WHERE id = ?', wordId)
  if (!word) return res.json(err(`word ${wordId} not found`))

  const now = new Date()
  const desiredRetention = desiredRetentionOf(user)
  let state = await db.get('SELECT * FROM user_words WHERE user_id = ? AND word_id = ?', userId, wordId)
  const wasNew = state == null || state.first_learned_at == null // 首答即计入"学过"
  if (!state) {
    await db.run(`INSERT INTO user_words (user_id, word_id, repetitions, ease, interval_days, lapses, peak_strength)
            VALUES (?, ?, 0, 2.5, 0, 0, 0)`, userId, wordId)
    state = await db.get('SELECT * FROM user_words WHERE user_id = ? AND word_id = ?', userId, wordId)
  }

  // 答题前的记忆概率(教育性反馈用:告诉用户"刚才你有 63% 的把握记得它")
  const rBefore = wasNew || state.last_review_at == null
    ? null
    : fsrsRetrievability({ stability: state.stability, lastReviewAt: new Date(state.last_review_at + 'Z'), now })

  // FSRS 等级:自评优先(元认知),否则按答题速度分档
  const grade = resolveGrade({ correct, responseMs, selfGrade })
  // 旧 SM-2 等级(5 档):legacy 列继续双写,保持 stats/stateLabel 兼容与可回滚
  const legacyGrade = selfGrade === 'unknown' ? 1 : selfGrade === 'known' ? 5 : selfGrade === 'fuzzy' ? 4 : gradeFor(correct, responseMs)

  const upd = sm2Update({
    repetitions: state.repetitions,
    ease: state.ease,
    intervalDays: state.interval_days,
    lapses: state.lapses,
    grade: legacyGrade,
    now,
  })
  const f = fsrsUpdate({
    stability: state.stability,
    difficulty: state.difficulty,
    grade,
    lastReviewAt: state.last_review_at ? new Date(state.last_review_at + 'Z') : now,
    desiredRetention,
    now,
  })
  // 双写:SM-2 旧列原样保留,FSRS 新列接管调度(due_at 由 FSRS 决定)
  await db.run(`UPDATE user_words SET repetitions = ?, ease = ?, interval_days = ?, lapses = ?, peak_strength = ?,
          stability = ?, difficulty = ?,
          last_review_at = ?, due_at = ?, first_learned_at = COALESCE(first_learned_at, ?)
          WHERE user_id = ? AND word_id = ?`,
    upd.repetitions, upd.ease, upd.intervalDays, upd.lapses, upd.peakStrength,
    f.stability, f.difficulty,
    iso(now), iso(f.dueAt), iso(now), userId, wordId)

  const strength = computeStrength({
    peak: upd.peakStrength,
    intervalDays: upd.intervalDays,
    ease: upd.ease,
    lastReviewAt: now,
    now,
  })
  await db.run(`INSERT INTO activity_events (user_id, date, module, correct, total, word_id) VALUES (?, ?, ?, ?, 1, ?)`,
    userId, utcDateStr(now), 'vocab', correct ? 1 : 0, wordId)

  const fresh = await db.get('SELECT * FROM user_words WHERE user_id = ? AND word_id = ?', userId, wordId)
  return res.json(ok({
    word_id: wordId,
    strength,
    // 记忆概率族(新):retrievability_before=答题前的把握;predicted_retention=下次到期那天仍记得的概率
    retrievability_before: rBefore,
    predicted_retention: Math.round(desiredRetention * 1000) / 1000,
    next_interval_days: f.intervalDays,
    interval_days: fresh.interval_days,
    ease: fresh.ease,
    next_review_at: iso(fresh.due_at),
    state: stateLabel(fresh.repetitions, fresh.interval_days, strength),
  }))
})

// 记忆概率曲线(记忆工坊"主动回忆+间隔重复"演示用):
// 从现在起 days 天内该词的 R 衰减轨迹 + 90% 阈值 —— 交点就是"为什么约在那一天复习"
reviewRouter.get('/review/forecast/:userId/:wordId', async (req, res) => {
  const userId = Number(req.params.userId)
  const wordId = Number(req.params.wordId)
  const user = await db.get('SELECT * FROM users WHERE id = ?', userId)
  if (!user) return res.json(err(`user ${userId} not found`))
  const word = await db.get('SELECT id FROM words WHERE id = ?', wordId)
  if (!word) return res.json(err(`word ${wordId} not found`))

  const days = Math.min(180, Math.max(7, Number(req.query.days) || 60))
  const state = await db.get('SELECT * FROM user_words WHERE user_id = ? AND word_id = ?', userId, wordId)
  const learned = state != null && state.first_learned_at != null
  const retention = desiredRetentionOf(user)

  if (!learned || state.stability == null || state.last_review_at == null) {
    return res.json(ok({ learned, word_id: wordId, threshold: retention, points: [], next_due: iso(state?.due_at) }))
  }

  const last = new Date(state.last_review_at + 'Z')
  const now = new Date()
  const elapsedDays = Math.max(0, (now.getTime() - last.getTime()) / 86400000)
  const points = []
  for (let d = 0; d <= days; d++) {
    const t = new Date(last.getTime() + (elapsedDays + d) * 86400000)
    const r = fsrsRetrievability({ stability: state.stability, lastReviewAt: last, now: t })
    points.push({ day: d, retrievability: r })
  }
  return res.json(ok({
    learned, word_id: wordId, stability: state.stability, difficulty: state.difficulty,
    threshold: retention, points, next_due: iso(state.due_at),
  }))
})
