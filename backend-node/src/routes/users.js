// 用户:POST /api/users(幂等创建)、GET /api/users/:id/stats?days=7|14|30(学习画像)
// GET /api/users/:id/activity?days=365(全年活跃度热力图)
import { Router } from 'express'
import { db } from '../db.js'
import { err, ok, wordStrength, utcDateStr } from '../helpers.js'

export const usersRouter = Router()

usersRouter.post('/users', async (req, res) => {
  const username = String(req.body?.username ?? '').trim()
  if (!username) return res.json(err('username 不能为空'))
  let user = await db.get('SELECT * FROM users WHERE username = ?', username)
  if (!user) {
    const r = await db.run('INSERT INTO users (username) VALUES (?)', username)
    user = await db.get('SELECT * FROM users WHERE id = ?', Number(r.lastInsertRowid))
  }
  return res.json(ok({ id: user.id, username: user.username }))
})

// ---- 用户个性化档案(goal / self_level / prefs) ----

// 合法枚举(前端 store 里有对应中文标签)
const GOALS = ['exam', 'study', 'work', 'interest']          // 考试 / 留学出国 / 工作 / 兴趣
const SELF_LEVELS = ['beginner', 'intermediate', 'advanced']  // 入门 / 中级 / 高级

// users 行 -> 档案对象(prefs JSON 字符串安全解为对象,坏数据不炸、退回空对象)
function profileOf(user) {
  let prefs = {}
  try { prefs = user.prefs ? JSON.parse(user.prefs) : {} } catch { prefs = {} }
  return { goal: user.goal ?? null, self_level: user.self_level ?? null, prefs }
}

// GET /api/users/:id/profile → { goal, self_level, prefs }
usersRouter.get('/users/:userId/profile', async (req, res) => {
  const user = await db.get('SELECT * FROM users WHERE id = ?', Number(req.params.userId))
  if (!user) return res.json(err(`user ${req.params.userId} not found`))
  return res.json(ok(profileOf(user)))
})

// POST /api/users/:id/profile → 部分更新(只更新 body 里出现的字段;null/'' 清空)
// body: { goal?, self_level?, prefs? };prefs 必须是 JSON 对象(界面偏好键值对)
usersRouter.post('/users/:userId/profile', async (req, res) => {
  const userId = Number(req.params.userId)
  const user = await db.get('SELECT * FROM users WHERE id = ?', userId)
  if (!user) return res.status(400).json(err(`user ${userId} not found`))

  const body = req.body ?? {}
  const sets = [], params = []

  if ('goal' in body) {
    const v = body.goal
    if (v != null && v !== '' && !GOALS.includes(v))
      return res.status(400).json(err(`goal 必须是 ${GOALS.join('/')} 之一`))
    sets.push('goal'); params.push(v || null)
  }
  if ('self_level' in body) {
    const v = body.self_level
    if (v != null && v !== '' && !SELF_LEVELS.includes(v))
      return res.status(400).json(err(`self_level 必须是 ${SELF_LEVELS.join('/')} 之一`))
    sets.push('self_level'); params.push(v || null)
  }
  if ('prefs' in body) {
    const v = body.prefs
    if (v != null && (typeof v !== 'object' || Array.isArray(v)))
      return res.status(400).json(err('prefs 必须是 JSON 对象'))
    sets.push('prefs'); params.push(v == null ? null : JSON.stringify(v))
  }
  if (!sets.length) return res.status(400).json(err('没有要更新的字段(goal / self_level / prefs)'))

  await db.run(`UPDATE users SET ${sets.map((s) => `${s} = ?`).join(', ')} WHERE id = ?`, ...params, userId)
  const fresh = await db.get('SELECT * FROM users WHERE id = ?', userId)
  return res.json(ok(profileOf(fresh)))
})

// 连续学习天数:从今天(或昨天)往前数连续有活动记录的天数
function streakDays(dates) {
  if (!dates.size) return 0
  const today = new Date()
  let cur = dates.has(utcDateStr(today)) ? today : new Date(today.getTime() - 86400000)
  let streak = 0
  while (dates.has(utcDateStr(cur))) {
    streak++
    cur = new Date(cur.getTime() - 86400000)
  }
  return streak
}

// 模块粒度清空范围:结果表 + 该模块在 activity_events 里的流水
const MODULE_SCOPES = {
  vocab: { tables: ['user_words'], activity: 'vocab' },
  grammar: { tables: ['grammar_results'], activity: 'grammar' },
  listening: { tables: ['listening_results'], activity: 'listening' },
  speaking: { tables: ['speaking_results'], activity: 'speaking' },
  phonetics: { tables: ['phonetic_results'], activity: 'phonetics' },
  reading: { tables: ['reading_results'], activity: 'reading' },
  writing: { tables: ['writing_results'], activity: 'writing' },
}

// POST /api/users/:id/reset            → 清空全部学习数据(保留账号)
// POST /api/users/:id/reset { modules } → 只清指定模块(如 ['listening','speaking'])
usersRouter.post('/users/:userId/reset', async (req, res) => {
  const userId = Number(req.params.userId)
  const user = await db.get('SELECT * FROM users WHERE id = ?', userId)
  if (!user) return res.json(err(`user ${userId} not found`))

  const mods = Array.isArray(req.body?.modules) ? [...new Set(req.body.modules.map(String))] : null
  if (mods) {
    if (!mods.length) return res.json(err('modules 不能为空数组'))
    for (const m of mods) {
      if (!MODULE_SCOPES[m]) return res.json(err(`未知模块: ${m}`))
    }
    for (const m of mods) {
      const scope = MODULE_SCOPES[m]
      for (const table of scope.tables) await db.run(`DELETE FROM ${table} WHERE user_id = ?`, userId)
      await db.run('DELETE FROM activity_events WHERE user_id = ? AND module = ?', userId, scope.activity)
    }
    return res.json(ok({ ok: true, modules: mods }))
  }

  // 清空该用户所有学习数据(保留账号)
  await clearUserData(userId)
  return res.json(ok({ ok: true }))
})

// ---- 数据导出 / 导入(迁移、备份、跨设备恢复) ----

// 学习数据所在的所有表(导出与导入共用同一顺序)
//   `select` 可重写 SELECT 子句用于 JOIN(向后兼容老导出格式,主键 KEY = id)
//   `whereClause` 决定 WHERE 子句结构(默认 user_id = ?;collection_words 改用 IN 子查询)
//   collection_words 无 user_id → JOIN collections 限定归属
const STATE_TABLES = [
  { key: 'word_states', table: 'user_words' },
  { key: 'grammar_states', table: 'grammar_results' },
  { key: 'listening_results', table: 'listening_results' },
  { key: 'speaking_results', table: 'speaking_results' },
  { key: 'phonetic_results', table: 'phonetic_results' },
  { key: 'reading_results', table: 'reading_results' },
  { key: 'writing_results', table: 'writing_results' },
  { key: 'activity_events', table: 'activity_events' },
  // Phase 4:收藏夹(向后兼容:旧导出文件无这两个键 → ?? [] 跳过)
  { key: 'collections', table: 'collections' },
  {
    key: 'collection_words', table: 'collection_words',
    select: 'SELECT cw.collection_id, cw.word_id, cw.added_at, c.name AS collection_name FROM collection_words cw JOIN collections c ON c.id = cw.collection_id',
    whereClause: 'WHERE c.user_id = ?',
  },
]

async function clearUserData(userId) {
  for (const t of STATE_TABLES) {
    if (t.whereClause) {
      // collection_words:无 user_id 列,通过 IN 子查询清掉用户所有 collection 的词
      await db.run(`DELETE FROM ${t.table} WHERE collection_id IN (SELECT id FROM collections WHERE user_id = ?)`, userId)
    } else {
      await db.run(`DELETE FROM ${t.table} WHERE user_id = ?`, userId)
    }
  }
}

// GET /api/users/:id/export → 该用户全部学习数据的完整 JSON
usersRouter.get('/users/:userId/export', async (req, res) => {
  const userId = Number(req.params.userId)
  const user = await db.get('SELECT * FROM users WHERE id = ?', userId)
  if (!user) return res.json(err(`user ${userId} not found`))

  const payload = {
    version: 1,
    user: { id: user.id, username: user.username },
    exported_at: new Date().toISOString().slice(0, 19),
  }
  for (const t of STATE_TABLES) {
  const { key, table, select, whereClause } = t
  // 默认 SELECT * FROM {table} WHERE user_id = ? ORDER BY id;collection_words 用 JOIN 写法
  const sql = select
    ? `${select} ${whereClause} ORDER BY cw.collection_id, cw.word_id`
    : `SELECT * FROM ${table} WHERE user_id = ? ORDER BY id`
  const rows = (await db.all(sql, userId))
    .map((row) => {
      const { id, user_id, ...rest } = row
      return rest // 去掉主键与 user_id,导入时重新生成(collection_words JOIN 去掉别名 collection_name 也去掉)
    })
  payload[key] = rows
}
  return res.json(ok(payload))
})

// 校验导入数据:每类必须是数组,元素是对象且必填字段齐全,外键真实存在
async function validateImport(payload, userId) {
  if (payload == null || typeof payload !== 'object' || Array.isArray(payload))
    return '导入数据必须是 JSON 对象'
  for (const { key } of STATE_TABLES) {
    const rows = payload[key]
    if (rows === undefined) continue // 缺某类数据视该类为空
    if (!Array.isArray(rows)) return `${key} 必须是数组`
  }

  // word_states:word_id 必须是已有词条
  for (const s of payload.word_states ?? []) {
    if (s == null || typeof s !== 'object' || !Number(s.word_id))
      return 'word_states 里存在无效记录(缺少 word_id)'
    if (!await db.get('SELECT id FROM words WHERE id = ?', Number(s.word_id)))
      return `word_states 引用了不存在的 word_id: ${s.word_id}`
  }
  // grammar_states:point_id 必须是已有语法点
  for (const s of payload.grammar_states ?? []) {
    if (s == null || typeof s !== 'object' || !Number(s.point_id))
      return 'grammar_states 里存在无效记录(缺少 point_id)'
    if (!await db.get('SELECT id FROM grammar_points WHERE id = ?', Number(s.point_id)))
      return `grammar_states 引用了不存在的 point_id: ${s.point_id}`
  }
  // 各类 *_results:passage_id 必须是已有篇章
  for (const key of ['listening_results', 'speaking_results', 'reading_results']) {
    for (const r of payload[key] ?? []) {
      if (r == null || typeof r !== 'object' || !Number(r.passage_id))
        return `${key} 里存在无效记录(缺少 passage_id)`
      if (!await db.get('SELECT id FROM passages WHERE id = ?', Number(r.passage_id)))
        return `${key} 引用了不存在的 passage_id: ${r.passage_id}`
    }
  }
  // writing_results:word_id 可空;有的话必须是已有词条;score 必须是 0-1
  for (const r of payload.writing_results ?? []) {
    if (r == null || typeof r !== 'object') return 'writing_results 里存在无效记录(必须是对象)'
    if (!['sentence', 'essay'].includes(String(r.stage ?? '')))
      return `writing_results.stage 必须是 sentence/essay`
    const sc = Number(r.score)
    if (!Number.isFinite(sc) || sc < 0 || sc > 1) return 'writing_results.score 必须是 0-1 之间'
    if (r.word_id != null && !await db.get('SELECT id FROM words WHERE id = ?', Number(r.word_id)))
      return `writing_results 引用了不存在的 word_id: ${r.word_id}`
  }
  // phonetic_results / activity_events:仅校验元素形状
  for (const key of ['phonetic_results', 'activity_events']) {
    for (const r of payload[key] ?? []) {
      if (r == null || typeof r !== 'object') return `${key} 里存在无效记录(必须是对象)`
    }
  }
  // Phase 4:collections 引用 word_id 必须存在(collection_words 也)
  for (const s of payload.collection_words ?? []) {
    if (s == null || typeof s !== 'object' || !Number(s.word_id))
      return 'collection_words 里存在无效记录(缺少 word_id)'
    if (!await db.get('SELECT id FROM words WHERE id = ?', Number(s.word_id)))
      return `collection_words 引用了不存在的 word_id: ${s.word_id}`
  }
  // collections 仅校验元素形状(name 字符串)
  for (const c of payload.collections ?? []) {
    if (c == null || typeof c !== 'object' || typeof c.name !== 'string' || !c.name.trim())
      return 'collections 里存在无效记录(name 必须是非空字符串)'
  }
  return null
}

// POST /api/users/:id/import → 用同样格式的 JSON 覆盖恢复(先清空再重放)
usersRouter.post('/users/:userId/import', async (req, res) => {
  const userId = Number(req.params.userId)
  const user = await db.get('SELECT * FROM users WHERE id = ?', userId)
  if (!user) return res.status(400).json(err(`user ${userId} not found`))

  const bad = await validateImport(req.body, userId)
  if (bad) return res.status(400).json(err(`导入数据校验失败: ${bad}`))

  const num = (v, dflt = 0) => (v == null || v === '' || Number.isNaN(Number(v)) ? dflt : Number(v))
  const txt = (v) => (v == null ? null : String(v).slice(0, 19))

  await clearUserData(userId)
  const counts = {}
  const ins = {
    word_states: db.prepare(`INSERT INTO user_words (user_id, word_id, repetitions, ease, interval_days, lapses, peak_strength, stability, difficulty, first_learned_at, last_review_at, due_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    grammar_states: db.prepare(`INSERT INTO grammar_results (user_id, point_id, quiz_index, correct, created_at) VALUES (?, ?, ?, ?, ?)`),
    listening_results: db.prepare(`INSERT INTO listening_results (user_id, passage_id, correct_count, total, created_at) VALUES (?, ?, ?, ?, ?)`),
    speaking_results: db.prepare(`INSERT INTO speaking_results (user_id, passage_id, sentence_index, score, transcript, created_at) VALUES (?, ?, ?, ?, ?, ?)`),
    phonetic_results: db.prepare(`INSERT INTO phonetic_results (user_id, kind, ref_id, correct, created_at) VALUES (?, ?, ?, ?, ?)`),
    reading_results: db.prepare(`INSERT INTO reading_results (user_id, passage_id, correct_count, total, created_at) VALUES (?, ?, ?, ?, ?)`),
    writing_results: db.prepare(`INSERT INTO writing_results (user_id, stage, word_id, score, text, feedback, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`),
    activity_events: db.prepare(`INSERT INTO activity_events (user_id, date, module, correct, total, word_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`),
    // Phase 4:收藏夹按 name 重建(同 name 已存在由 UNIQUE 约束兜底)
    collections: db.prepare(`INSERT INTO collections (user_id, name, color, created_at) VALUES (?, ?, ?, ?)`),
    collection_words: db.prepare(`INSERT INTO collection_words (collection_id, word_id, added_at) VALUES (?, ?, ?)`),
  }
  for (const r of req.body.word_states ?? []) await ins.word_states.run(userId, num(r.word_id), num(r.repetitions), num(r.ease, 2.5),
    num(r.interval_days), num(r.lapses), num(r.peak_strength),
    r.stability == null ? null : num(r.stability), r.difficulty == null ? null : num(r.difficulty),
    txt(r.first_learned_at), txt(r.last_review_at), txt(r.due_at))
  for (const r of req.body.grammar_states ?? []) await ins.grammar_states.run(userId, num(r.point_id), num(r.quiz_index), num(r.correct), txt(r.created_at))
  for (const r of req.body.listening_results ?? []) await ins.listening_results.run(userId, num(r.passage_id), num(r.correct_count), num(r.total), txt(r.created_at))
  for (const r of req.body.speaking_results ?? []) await ins.speaking_results.run(userId, num(r.passage_id), num(r.sentence_index), num(r.score), String(r.transcript ?? ''), txt(r.created_at))
  for (const r of req.body.phonetic_results ?? []) await ins.phonetic_results.run(userId, String(r.kind ?? ''), String(r.ref_id ?? ''), num(r.correct), txt(r.created_at))
  for (const r of req.body.reading_results ?? []) await ins.reading_results.run(userId, num(r.passage_id), num(r.correct_count), num(r.total), txt(r.created_at))
  for (const r of req.body.writing_results ?? []) await ins.writing_results.run(userId, String(r.stage ?? 'sentence'), r.word_id == null ? null : num(r.word_id), num(r.score, 0), String(r.text ?? '').slice(0, 4000), JSON.stringify(r.feedback ?? []), txt(r.created_at))
  for (const r of req.body.activity_events ?? []) await ins.activity_events.run(userId, String(r.date ?? '').slice(0, 10), String(r.module ?? ''),
    num(r.correct), num(r.total), r.word_id == null ? null : num(r.word_id), txt(r.created_at))
  // Phase 4:collection → collection_words 按 name 重建 → 建立 word_id ↔ collection_name 的映射
  const nameToId = new Map()
  for (const c of req.body.collections ?? []) {
    const name = String(c.name ?? '').trim()
    if (!name) continue
    // 同名已存在(可能用户先手动建的) → 直接复用 id;否则插一条
    let row = await db.get('SELECT id FROM collections WHERE user_id = ? AND name = ?', userId, name)
    if (!row) row = await db.get('SELECT * FROM collections WHERE id = ?', (await ins.collections.run(userId, name, String(c.color ?? 'accent'), txt(c.created_at))).lastInsertRowid)
    nameToId.set(name, row.id)
  }
  for (const cw of req.body.collection_words ?? []) {
    const cid = nameToId.get(String(cw.collection_name ?? ''))
    if (!cid) continue
    await ins.collection_words.run(cid, num(cw.word_id), txt(cw.added_at))
  }
  for (const { key } of STATE_TABLES) counts[key] = (req.body[key] ?? []).length

  return res.json(ok({ ok: true, imported: counts }))
})

usersRouter.get('/users/:userId/stats', async (req, res) => {
  const userId = Number(req.params.userId)
  const user = await db.get('SELECT * FROM users WHERE id = ?', userId)
  if (!user) return res.json(err(`user ${userId} not found`))

  // 活跃度窗口:仅接受 7/14/30,非法值按默认 14 处理(向后兼容旧前端)
  const days = [7, 14, 30].includes(Number(req.query.days)) ? Number(req.query.days) : 14

  const now = new Date()

  const totalWords = (await db.get("SELECT COUNT(*) AS n FROM words WHERE family <> 'general'")).n
  const states = await db.all('SELECT * FROM user_words WHERE user_id = ?', userId)
  const learned = states.filter((s) => s.first_learned_at != null).length
  const strengths = new Map(states.map((s) => [s.word_id, wordStrength(s, now)]))
  const mastered = states.filter((s) => s.repetitions >= 3 && (strengths.get(s.word_id) ?? 0) > 0.8).length
  const dueToday = states.filter((s) => {
    if (s.due_at == null) return false
    return new Date(s.due_at + 'Z') <= now
  }).length

  // ---- 各模块正确率(ActivityEvent 流水聚合;speaking 用得分均值) ----
  const accuracyByModule = { vocab: 0.0, grammar: 0.0, listening: 0.0, speaking: 0.0, phonetics: 0.0, reading: 0.0 }
  const events = await db.all('SELECT * FROM activity_events WHERE user_id = ?', userId)
  const byModule = new Map()
  for (const e of events) {
    if (!byModule.has(e.module)) byModule.set(e.module, [])
    byModule.get(e.module).push(e)
  }
  for (const [module, rows] of byModule) {
    const total = rows.reduce((a, r) => a + r.total, 0)
    const correct = rows.reduce((a, r) => a + r.correct, 0)
    accuracyByModule[module] = total ? Math.round((correct / total) * 1000) / 1000 : 0.0
  }

  const speakingRows = await db.all('SELECT * FROM speaking_results WHERE user_id = ?', userId)
  if (speakingRows.length) {
    accuracyByModule.speaking =
      Math.round((speakingRows.reduce((a, r) => a + r.score, 0) / speakingRows.length) * 1000) / 1000
  }

  const totals = [...byModule.values()].reduce((a, rows) => a + rows.reduce((x, r) => x + r.total, 0), 0)
  const corrects = [...byModule.values()].reduce((a, rows) => a + rows.reduce((x, r) => x + r.correct, 0), 0)
  const avgAccuracy = totals ? Math.round((corrects / totals) * 1000) / 1000 : 0.0

  // 今日各模块题数(驱动前端每日任务):speaking 用真实句数(其它 module 是题数)
  const todayStr = utcDateStr(now)
  const byModuleToday = { vocab: 0, grammar: 0, listening: 0, speaking: 0, phonetics: 0, reading: 0, writing: 0 }
  for (const e of events) if (e.date === todayStr) byModuleToday[e.module] = (byModuleToday[e.module] || 0) + e.total
  const todaySpeakingRows = speakingRows.filter((r) => r.created_at && utcDateStr(new Date(r.created_at + 'Z')) === todayStr)
  byModuleToday.speaking = todaySpeakingRows.length

  // ---- 最弱词根(词汇答题按词根聚合,正确率升序,词数>=2;最多 8 个供 Dashboard 柱状图用) ----
  const wordRoot = new Map((await db.all("SELECT id, root, root_meaning FROM words WHERE family <> 'general'"))
    .map((w) => [w.id, { root: w.root, meaning: w.root_meaning }]))
  const rootStats = new Map()
  for (const e of events) {
    if (e.module !== 'vocab' || e.word_id == null) continue
    const info = wordRoot.get(e.word_id)
    if (!info) continue
    if (!rootStats.has(info.root)) rootStats.set(info.root, { meaning: info.meaning, correct: 0, total: 0, words: new Set() })
    const st = rootStats.get(info.root)
    st.correct += e.correct
    st.total += e.total
    st.words.add(e.word_id)
  }
  const ranked = [...rootStats.entries()]
    .filter(([, st]) => st.total > 0 && st.words.size >= 2)
    .sort((a, b) => (a[1].correct / a[1].total) - (b[1].correct / b[1].total) || b[1].words.size - a[1].words.size)
  const weakestRoots = ranked.slice(0, 8).map(([root, st]) => ({
    root,
    meaning: st.meaning,
    accuracy: Math.round((st.correct / st.total) * 1000) / 1000,
    word_count: st.words.size,
  }))

  // ---- daily_activity(近 days 天,默认 14;?days=7|14|30 控制) ----
  const dailyActivity = []
  const vocabEvents = events.filter((e) => e.module === 'vocab')
  const firstLearnedDates = new Set(states.filter((s) => s.first_learned_at).map((s) => utcDateStr(new Date(s.first_learned_at + 'Z'))))
  for (let i = days - 1; i >= 0; i--) {
    const d = utcDateStr(new Date(now.getTime() - i * 86400000))
    const reviews = vocabEvents.filter((e) => e.date === d).length
    const newWords = firstLearnedDates.has(d) ? [...firstLearnedDates].filter((x) => x === d).length : 0
    dailyActivity.push({ date: d, reviews, new_words: newWords })
  }
  const activeDates = new Set([...events.map((e) => e.date), ...firstLearnedDates])

  // ---- 词汇量增长曲线:首次学习时间累积(去重,按时间排,返回近 N 天每日总词数) ----
  const sortedLearns = [...states].filter((s) => s.first_learned_at).sort((a, b) => new Date(a.first_learned_at + 'Z') - new Date(b.first_learned_at + 'Z'))
  let cumulative = 0
  const cumulativeByDate = new Map()
  for (const s of sortedLearns) {
    cumulative++
    cumulativeByDate.set(utcDateStr(new Date(s.first_learned_at + 'Z')), cumulative)
  }
  const vocabGrowth = []
  for (let i = days - 1; i >= 0; i--) {
    const d = utcDateStr(new Date(now.getTime() - i * 86400000))
    vocabGrowth.push({ date: d, total: cumulativeByDate.get(d) ?? [...cumulativeByDate.values()].pop() ?? 0 })
  }
  // 第一段(total=0)的填充:累计从 0 起,但应让所有日期显示正确总数
  for (let i = 0; i < vocabGrowth.length; i++) {
    if (i === 0) {
      // 第一天用 0 或当天新学的累计,二选一:取 cumulativeByDate 中 ≤ 当日 的最近一个
      const d = vocabGrowth[i].date
      let last = 0
      for (const [k, v] of cumulativeByDate) { if (k <= d) last = v }
      vocabGrowth[i].total = last
    } else {
      // 后续:取前面 max + 当日增量
      const d = vocabGrowth[i].date
      const dayLearns = [...cumulativeByDate].filter(([k]) => k === d).reduce((a, [, v]) => Math.max(a, v), vocabGrowth[i - 1].total)
      vocabGrowth[i].total = Math.max(vocabGrowth[i - 1].total, dayLearns)
    }
  }

  // ---- 记忆强度分布:5 档桶(buckets)+ 待复习预警(due_today / critical) ----
  const strengthDist = { critical: 0, weak: 0, learning: 0, good: 0, mastered: 0, unknown: 0 }
  for (const s of states) {
    const w = strengths.get(s.word_id) ?? 0
    if (w < 0.3) strengthDist.critical++
    else if (w < 0.5) strengthDist.weak++
    else if (w < 0.75) strengthDist.learning++
    else strengthDist.mastered++
  }
  strengthDist.good = states.length - strengthDist.critical - strengthDist.weak - strengthDist.learning - strengthDist.mastered
  strengthDist.unknown = totalWords - states.length
  // due_today 复用前面;再加一个"7 天内到期"预警
  const dueWeek = states.filter((s) => {
    if (s.due_at == null) return false
    const t = new Date(s.due_at + 'Z').getTime()
    return t <= now.getTime() + 7 * 86400000
  }).length

  return res.json(ok({
    total_words: totalWords,
    learned,
    mastered,
    due_today: dueToday,
    due_week: dueWeek,
    streak_days: streakDays(activeDates),
    avg_accuracy: avgAccuracy,
    accuracy_by_module: accuracyByModule,
    weakest_roots: weakestRoots,
    daily_activity: dailyActivity,
    vocab_growth: vocabGrowth,
    strength_dist: strengthDist,
    by_module_today: byModuleToday,
  }))
})

// ---- 全年活跃度热力图(Phase 3) ----
// GET /api/users/:userId/activity?days=30|90|180|365 → { days, daily: [{date, reviews, new_words}] }
usersRouter.get('/users/:userId/activity', async (req, res) => {
  const userId = Number(req.params.userId)
  const user = await db.get('SELECT * FROM users WHERE id = ?', userId)
  if (!user) return res.json(err(`user ${userId} not found`))

  const days = [30, 90, 180, 365].includes(Number(req.query.days)) ? Number(req.query.days) : 365
  const since = utcDateStr(new Date(Date.now() - (days - 1) * 86400000))

  // 复习:activity_events.module='vocab' 按 date 聚合
  const reviewRows = await db.all(
    `SELECT date, COUNT(*) AS reviews FROM activity_events
       WHERE user_id = ? AND module = 'vocab' AND date >= ?
       GROUP BY date`,
    userId, since)
  // 新学:user_words.first_learned_at 按 date 聚合
  const newWordRows = await db.all(
    `SELECT DATE(first_learned_at) AS d, COUNT(*) AS n FROM user_words
       WHERE user_id = ? AND first_learned_at IS NOT NULL AND DATE(first_learned_at) >= ?
       GROUP BY d`,
    userId, since)

  const map = new Map()
  for (const r of reviewRows) map.set(r.date, { date: r.date, reviews: Number(r.reviews), new_words: 0 })
  for (const n of newWordRows) {
    const cur = map.get(n.d) || { date: n.d, reviews: 0, new_words: 0 }
    cur.new_words = Number(n.n)
    map.set(n.d, cur)
  }
  const daily = [...map.values()].sort((a, b) => a.date.localeCompare(b.date))
  return res.json(ok({ days, daily }))
})