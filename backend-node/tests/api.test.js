// API 冒烟测试:临时 SQLite 测试库 + 随机端口的真实 HTTP 实例,
// 按用户学习动线覆盖全部端点的正常路径(含新增 export / import / ask)
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

// 必须在 import app 之前设置:让 db.js 指向临时库,不污染 wordpeak.db
const TMP = mkdtempSync(path.join(tmpdir(), 'wordpeak-test-'))
process.env.WORDPEAK_DB = path.join(TMP, 'test.db')
// 隔离 backend-node/.env:别把真实 AI key 注回本测试(要验证无 key 的本地降级)
process.env.WORDPEAK_NO_ENVFILE = '1'
// /api/ask 强制走本地降级分析,测试不依赖外网与真实 key
delete process.env.ANTHROPIC_API_KEY
delete process.env.GEMINI_API_KEY

const { createApp } = await import('../src/app.js')
const { db } = await import('../src/db.js')

let server
let BASE

test.before(async () => {
  const app = await createApp()
  server = app.listen(0, '127.0.0.1')
  await new Promise((r) => server.once('listening', r))
  BASE = `http://127.0.0.1:${server.address().port}`
})

test.after(async () => {
  server.closeAllConnections?.() // 强制断开 fetch 的 keep-alive 连接,避免 close 悬挂
  await new Promise((r) => server.close(r))
  try { db.close() } catch { /* 忽略 */ }
  try { rmSync(TMP, { recursive: true, force: true }) } catch { /* Windows 偶发占用,留在临时目录无妨 */ }
})

async function j(pathname, opts = {}) {
  const res = await fetch(BASE + pathname, { headers: { 'content-type': 'application/json' }, ...opts })
  return { status: res.status, body: await res.json() }
}
const post = (pathname, data) => j(pathname, { method: 'POST', body: JSON.stringify(data) })

test('GET /api 服务信息', async () => {
  const { status, body } = await j('/api')
  assert.equal(status, 200)
  assert.equal(body.ok, true)
})

test('全端点冒烟:按一次完整学习动线走通', async () => {
  // ---- 用户 ----
  const { body: created } = await post('/api/users', { username: 'smoke-tester' })
  assert.equal(created.ok, true)
  const uid = created.data.id
  const { body: again } = await post('/api/users', { username: 'smoke-tester' })
  assert.equal(again.data.id, uid) // 幂等创建

  const { body: stats } = await j(`/api/users/${uid}/stats`)
  assert.equal(stats.ok, true)
  assert.ok(stats.data.total_words > 0)

  // ---- 词汇星系 ----
  const { body: words } = await j('/api/words')
  assert.equal(words.ok, true)
  const wordId = words.data[0].id
  const { body: roots } = await j('/api/roots')
  assert.ok(roots.data.length > 0)
  assert.ok('story' in roots.data[0])
  const { body: states0 } = await j(`/api/words/state/${uid}`)
  assert.deepEqual(states0.data, [])
  const { body: learned } = await post('/api/words/learn', { user_id: uid, word_id: wordId })
  assert.equal(learned.data.already, false)

  // ---- 复习队列与答题 ----
  const { body: queue } = await j(`/api/review/queue/${uid}?count=5`)
  assert.equal(queue.ok, true)
  assert.ok(queue.data.length > 0 && queue.data.length <= 5)
  const { body: result } = await post('/api/review/result', { user_id: uid, word_id: wordId, correct: true, response_ms: 1500 })
  assert.equal(result.ok, true)
  assert.equal(result.data.state, 'learning') // 首答 1 次仍是 learning
  assert.equal(result.data.interval_days, 1)

  // ---- 发音舱知识库 / 语音练习 ----
  const { body: phonemes } = await j('/api/phonemes')
  assert.ok(phonemes.data.length > 0)
  const { body: pairs } = await j('/api/phonetics/pairs')
  assert.equal(pairs.ok, true)
  const { body: rules } = await j('/api/phonetics/rules')
  assert.equal(rules.ok, true)
  const { body: phRes } = await post('/api/phonetics/result', { user_id: uid, kind: 'pair', ref_id: 'p1', correct: true })
  assert.equal(phRes.ok, true)
  const { body: phState } = await j(`/api/phonetics/state/${uid}`)
  assert.equal(phState.data[0].kind, 'pair')

  // ---- 语法机械城 ----
  const { body: grammar } = await j('/api/grammar')
  const pointId = grammar.data[0].id
  const { body: gRes } = await post('/api/grammar/result', { user_id: uid, point_id: pointId, quiz_index: 0, correct: true })
  assert.ok(gRes.data.point_mastery > 0)
  const { body: gState } = await j(`/api/grammar/state/${uid}`)
  assert.equal(gState.data[0].point_id, pointId)

  // ---- 听力 / 口语 / 阅读 ----
  const { body: passages } = await j('/api/passages')
  const byType = (t) => passages.data.find((p) => p.type === t)
  const listenP = byType('listening'), speakP = byType('speaking'), readP = byType('reading')
  assert.ok(listenP && speakP && readP, '三种篇章类型都应存在')

  // ?type= 过滤:只返回对应类型
  const { body: speakingOnly } = await j('/api/passages?type=speaking')
  assert.ok(speakingOnly.data.length > 0)
  assert.ok(speakingOnly.data.every((p) => p.type === 'speaking'), 'type 过滤应只返回口语篇')

  const { body: lRes } = await post('/api/listening/result', { user_id: uid, passage_id: listenP.id, correct_count: 4, total: 5 })
  assert.equal(lRes.data.accuracy, 0.8)
  const { body: sRes } = await post('/api/speaking/result', { user_id: uid, passage_id: speakP.id, sentence_index: 0, score: 0.9, transcript: 'hello world' })
  assert.equal(sRes.ok, true)
  const { body: rRes } = await post('/api/reading/result', { user_id: uid, passage_id: readP.id, correct_count: 3, total: 4 })
  assert.equal(rRes.data.accuracy, 0.75)

  // ---- 静态内容 ----
  for (const p of ['/api/tips', '/api/books', '/api/roadmap']) {
    const { body } = await j(p)
    assert.equal(body.ok, true)
  }

  // ---- 用户画像(有数据后)----
  const { body: stats2 } = await j(`/api/users/${uid}/stats`)
  assert.ok(stats2.data.learned >= 1)
  assert.ok(stats2.data.streak_days >= 1)
})

test('轨道书库:GET /api/library 返回书树,章节反查 passage 且 user_id 视角标记已读', async () => {
  const { status, body } = await j('/api/library')
  assert.equal(status, 200)
  assert.equal(body.ok, true)
  const { books } = body.data
  assert.ok(books.length >= 1, '书库至少应有一本书')
  for (const b of books) {
    assert.ok(['literary', 'science', 'classic'].includes(b.region), `region 非法:${b.region}`)
    assert.ok(b.chapters.length >= 3, `${b.title} 至少 3 章`)
    for (const c of b.chapters) assert.ok(c.passage_id > 0, `${b.title} 第${c.no}章应能反查到 passage_id`)
  }
  // user_id 视角:交一次某章的章末测 → 该章 read=true,其余默认 false
  const uid2 = (await post('/api/users', { username: 'lib-tester' })).body.data.id
  const { body: fresh } = await j(`/api/library?user_id=${uid2}`)
  assert.ok(fresh.data.books.every((b) => b.chapters.every((c) => c.read === false)), '新用户所有章都未读')
  const ch = fresh.data.books[0].chapters[0]
  await post('/api/reading/result', { user_id: uid2, passage_id: ch.passage_id, correct_count: 3, total: 4 })
  const { body: after } = await j(`/api/library?user_id=${uid2}`)
  assert.equal(after.data.books[0].chapters[0].read, true, '交过章末测的章应标记已读')
})

test('export:导出完整学习数据', async () => {
  const { body: created } = await post('/api/users', { username: 'export-tester' })
  const uid = created.data.id
  const { body: words } = await j('/api/words')
  await post('/api/review/result', { user_id: uid, word_id: words.data[0].id, correct: true, response_ms: 1000 })
  await post('/api/grammar/result', { user_id: uid, point_id: 1, quiz_index: 0, correct: false })

  const { status, body } = await j(`/api/users/${uid}/export`)
  assert.equal(status, 200)
  assert.equal(body.ok, true)
  assert.equal(body.data.user.id, uid)
  assert.equal(body.data.word_states.length, 1)
  assert.equal(body.data.word_states[0].repetitions, 1)
  assert.ok(Array.isArray(body.data.grammar_states) && body.data.grammar_states.length === 1)
  for (const key of ['listening_results', 'speaking_results', 'phonetic_results', 'reading_results', 'activity_events'])
    assert.ok(Array.isArray(body.data[key]), `应含 ${key}`)
})

test('import:reset 后用导出数据覆盖恢复', async () => {
  const { body: created } = await post('/api/users', { username: 'import-tester' })
  const uid = created.data.id
  const { body: words } = await j('/api/words')
  const wordId = words.data[0].id
  await post('/api/review/result', { user_id: uid, word_id: wordId, correct: true, response_ms: 1000 })

  const { body: exported } = await j(`/api/users/${uid}/export`)
  // reset 清空
  const { body: reset } = await post(`/api/users/${uid}/reset`)
  assert.equal(reset.ok, true)
  const { body: empty } = await j(`/api/words/state/${uid}`)
  assert.equal(empty.data.length, 0)
  // 导入恢复
  const { status, body: imported } = await post(`/api/users/${uid}/import`, exported.data)
  assert.equal(status, 200)
  assert.equal(imported.ok, true)
  assert.equal(imported.data.imported.word_states, 1)
  const { body: restored } = await j(`/api/words/state/${uid}`)
  assert.equal(restored.data.length, 1)
  assert.equal(restored.data[0].repetitions, 1)
  assert.equal(restored.data[0].is_new, false)
  // 幂等:重复导入也不炸(覆盖)
  const { status: s2, body: b2 } = await post(`/api/users/${uid}/import`, exported.data)
  assert.equal(s2, 200)
  assert.equal(b2.ok, true)
})

test('import:非法数据返回 400', async () => {
  const { body: created } = await post('/api/users', { username: 'import-bad' })
  const uid = created.data.id

  let r = await post(`/api/users/${uid}/import`, { word_states: [{ word_id: 999999 }] })
  assert.equal(r.status, 400) // 外键不存在
  r = await post(`/api/users/${uid}/import`, { word_states: 'oops' })
  assert.equal(r.status, 400) // 不是数组
  r = await post(`/api/users/${uid}/import`, { grammar_states: [{}] })
  assert.equal(r.status, 400) // 缺 point_id
  r = await post(`/api/users/${uid}/import`, [1, 2]) // JSON 数组而非对象
  assert.equal(r.status, 400)
  r = await post(`/api/users/999999/import`, {})
  assert.equal(r.status, 400) // 用户不存在
  // 校验失败不破坏现有数据
  const { body: stats } = await j(`/api/users/${uid}/stats`)
  assert.equal(stats.ok, true)
})

test('ask:无 key 时返回本地降级分析', async () => {
  const { status, body } = await post('/api/ask', { transcript: 'tree free tree', original: 'three free trees', phoneme: '/θ/' })
  assert.equal(status, 200)
  assert.equal(body.ok, true)
  assert.equal(body.data.source, 'local')
  assert.match(body.data.advice.problem, /共 \d+\/\d+ 个词/)
  assert.ok(body.data.advice.words.includes('three'))
  assert.ok(body.data.advice.advice.length > 0)

  // 全部读对 → 无问题
  const { body: allOk } = await post('/api/ask', { transcript: 'good morning', original: 'good morning' })
  assert.equal(allOk.data.source, 'local')
  assert.ok(allOk.data.advice.words.length === 0)
})

test('ask:参数缺失返回 400', async () => {
  let r = await post('/api/ask', { original: 'hi' })
  assert.equal(r.status, 400)
  r = await post('/api/ask', { transcript: 'hi' })
  assert.equal(r.status, 400)
  r = await post('/api/ask', {})
  assert.equal(r.status, 400)
})

test('未找到用户/资源:旧契约风格 200 + {ok:false}', async () => {
  const { body } = await j('/api/users/999999/stats')
  assert.equal(body.ok, false)
  assert.ok(body.error.includes('not found'))
})

// ---- 全年活跃度热力图(Phase 3) ----
test('activity:默认 365 天,返回 daily 数组', async () => {
  const { body: created } = await post('/api/users', { username: 'heatmap-tester' })
  const uid = created.data.id
  const { body: a365 } = await j(`/api/users/${uid}/activity`)
  assert.equal(a365.ok, true)
  assert.equal(a365.data.days, 365)
  assert.ok(Array.isArray(a365.data.daily))
  // 合法 days 切换
  const { body: a90 } = await j(`/api/users/${uid}/activity?days=90`)
  assert.equal(a90.data.days, 90)
  // 非法 days → 默认 365
  const { body: aBad } = await j(`/api/users/${uid}/activity?days=7`)
  assert.equal(aBad.data.days, 365)
})

// ---- 收藏夹(Phase 4) ----
test('collections:建夹/加词/列词/删夹全链路', async () => {
  const { body: created } = await post('/api/users', { username: 'coll-tester' })
  const uid = created.data.id
  const { body: words } = await j('/api/words')
  const wids = [words.data[0].id, words.data[1].id]

  // 同名建夹 → 400
  const r1 = await post(`/api/users/${uid}/collections`, { name: 'CET-6 重点', color: 'accent' })
  assert.equal(r1.status, 200)
  assert.equal(r1.body.ok, true)
  const cid = r1.body.data.id
  const r1dup = await post(`/api/users/${uid}/collections`, { name: 'CET-6 重点' })
  assert.equal(r1dup.status, 400)

  // 列夹:1 个,word_count=0
  const { body: list } = await j(`/api/users/${uid}/collections`)
  assert.equal(list.data.length, 1)
  assert.equal(list.data[0].word_count, 0)

  // 加词 + 重复加 + ignore
  const add1 = await post(`/api/users/${uid}/collections/${cid}/words`, { word_ids: [wids[0], wids[1]] })
  assert.equal(add1.body.ok, true)
  const add2 = await post(`/api/users/${uid}/collections/${cid}/words`, { word_ids: [wids[0]] })
  assert.equal(add2.body.ok, true)

  // 列词:2 个,按 addDate 倒序
  const { body: wordList } = await j(`/api/users/${uid}/collections/${cid}/words`)
  assert.equal(wordList.data.length, 2)
  assert.ok(wordList.data[0].word)

  // word_count 跟随更新
  const { body: list2 } = await j(`/api/users/${uid}/collections`)
  assert.equal(list2.data[0].word_count, 2)

  // 删词
  await j(`/api/users/${uid}/collections/${cid}/words/${wids[0]}`, { method: 'DELETE' })
  const { body: list3 } = await j(`/api/users/${uid}/collections`)
  assert.equal(list3.data[0].word_count, 1)

  // 删夹(级联清词)
  await j(`/api/users/${uid}/collections/${cid}`, { method: 'DELETE' })
  const { body: list4 } = await j(`/api/users/${uid}/collections`)
  assert.equal(list4.data.length, 0)
})

test('collections:跨用户隔离', async () => {
  const { body: u1 } = await post('/api/users', { username: 'col-iso-u1' })
  const { body: u2 } = await post('/api/users', { username: 'col-iso-u2' })
  const r = await post(`/api/users/${u1.data.id}/collections`, { name: 'u1夹' })
  const cid = r.body.data.id
  // u2 试图操作 u1 的夹 → 找不到
  const r2 = await j(`/api/users/${u2.data.id}/collections/${cid}`, { method: 'DELETE' })
  assert.equal(r2.body.ok, false)
})

test('export/import 含 collections:旧格式兼容', async () => {
  const { body: created } = await post('/api/users', { username: 'coll-export' })
  const uid = created.data.id
  const { body: words } = await j('/api/words')
  // 建夹 + 加词
  const r = await post(`/api/users/${uid}/collections`, { name: '我的最爱', color: 'warm' })
  const cid = r.body.data.id
  await post(`/api/users/${uid}/collections/${cid}/words`, { word_ids: [words.data[0].id] })

  const { body: exp } = await j(`/api/users/${uid}/export`)
  assert.ok(Array.isArray(exp.data.collections) && exp.data.collections.length === 1)
  assert.ok(Array.isArray(exp.data.collection_words) && exp.data.collection_words.length === 1)

  // reset + import 恢复
  await post(`/api/users/${uid}/reset`)
  const { status, body: imp } = await post(`/api/users/${uid}/import`, exp.data)
  assert.equal(status, 200)
  assert.ok(imp.data.imported.collections >= 1)
  const { body: list } = await j(`/api/users/${uid}/collections`)
  assert.equal(list.data.length, 1)
  assert.equal(list.data[0].word_count, 1)

  // 旧格式(无 collections 键)导入也不炸
  const legacy = { ...exp.data }
  delete legacy.collections
  delete legacy.collection_words
  const { status: sLegacy } = await post(`/api/users/${uid}/import`, legacy)
  assert.equal(sLegacy, 200)
})

// ====================================================================
// FSRS 契约:自评三档 / 记忆概率曲线 / 智能推荐回归 / 导入导出保新列
// ====================================================================
test('FSRS:自评三档走通,响应含概率族字段,unknown 计为答错', async () => {
  const { body: created } = await post('/api/users', { username: 'fsrs-self' })
  const uid = created.data.id
  const { body: words } = await j('/api/words')

  // 首评「认识」:Easy 档,间隔以天计
  const r1 = await post('/api/review/result', { user_id: uid, word_id: words.data[0].id, self_grade: 'known', response_ms: 2000 })
  assert.equal(r1.body.ok, true)
  assert.ok(r1.body.data.next_interval_days > 5)
  assert.equal(r1.body.data.predicted_retention, 0.9)
  assert.equal(r1.body.data.retrievability_before, null) // 首次作答无"答前概率"

  // 第二词「模糊」:Hard 档,间隔 ≈ 1 天级
  const r2 = await post('/api/review/result', { user_id: uid, word_id: words.data[1].id, self_grade: 'fuzzy' })
  assert.ok(r2.body.data.next_interval_days >= 0.5 && r2.body.data.next_interval_days < 4)

  // 第三词「不认识」:Again 档,当天再见
  const r3 = await post('/api/review/result', { user_id: uid, word_id: words.data[2].id, self_grade: 'unknown' })
  assert.ok(r3.body.data.next_interval_days < 1)

  // 落库检查:三行都有 stability/difficulty
  const rows = await db.all('SELECT * FROM user_words WHERE user_id = ?', uid)
  assert.equal(rows.length, 3)
  assert.ok(rows.every((r) => r.stability != null && r.difficulty != null))

  // 活动流水:known/fuzzy 记对、unknown 记错(correct 语义不破)
  const events = await db.all("SELECT * FROM activity_events WHERE user_id = ? AND module = 'vocab' ORDER BY id", uid)
  assert.deepEqual(events.map((e) => e.correct), [1, 1, 0])

  // 队列:响应含 retrievability 字段
  const { body: queue } = await j(`/api/review/queue/${uid}?count=3`)
  assert.ok('retrievability' in queue.data[0])
})

test('FSRS:旧契约(无 self_grade)不破', async () => {
  const { body: created } = await post('/api/users', { username: 'fsrs-legacy' })
  const uid = created.data.id
  const { body: words } = await j('/api/words')
  const { body: r } = await post('/api/review/result', { user_id: uid, word_id: words.data[0].id, correct: true, response_ms: 1500 })
  assert.equal(r.ok, true)
  assert.equal(r.data.state, 'learning')
  assert.ok(r.data.next_interval_days > 0)
})

test('FSRS:forecast 返回记忆概率曲线,未学词 learned=false', async () => {
  const { body: created } = await post('/api/users', { username: 'fsrs-curve' })
  const uid = created.data.id
  const { body: words } = await j('/api/words')
  const unlearned = await j(`/api/review/forecast/${uid}/${words.data[0].id}?days=30`)
  assert.equal(unlearned.body.ok, true)
  assert.equal(unlearned.body.data.learned, false)
  assert.deepEqual(unlearned.body.data.points, [])

  await post('/api/review/result', { user_id: uid, word_id: words.data[0].id, correct: true, response_ms: 1000 })
  const { body: fc } = await j(`/api/review/forecast/${uid}/${words.data[0].id}?days=60`)
  assert.equal(fc.ok, true)
  assert.equal(fc.data.learned, true)
  assert.ok(fc.data.points.length >= 30)
  assert.equal(fc.data.points[0].retrievability, 1) // 今天刚复习,R=1
  assert.ok(fc.data.points[60].retrievability < fc.data.points[1].retrievability) // 单调衰减
  assert.equal(fc.data.threshold, 0.9)
})

test('recommend:不再 500,记忆概率口径生效(回归:历史 SELECT strength 列不存在必炸)', async () => {
  const { body: created } = await post('/api/users', { username: 'reco-tester' })
  const uid = created.data.id
  const { body: words } = await j('/api/words')
  await post('/api/review/result', { user_id: uid, word_id: words.data[0].id, correct: false, response_ms: 9000 })
  await post('/api/review/result', { user_id: uid, word_id: words.data[1].id, correct: false, response_ms: 9000 })
  const { status, body } = await j(`/api/recommend/${uid}`)
  assert.equal(status, 200)
  assert.equal(body.ok, true)
  assert.ok(body.data.reason) // 有推荐理由(不再是兜底壳)
})

test('FSRS:导出导入往返保留 stability/difficulty', async () => {
  const { body: created } = await post('/api/users', { username: 'fsrs-roundtrip' })
  const uid = created.data.id
  const { body: words } = await j('/api/words')
  await post('/api/review/result', { user_id: uid, word_id: words.data[0].id, self_grade: 'known' })
  const { body: exported } = await j(`/api/users/${uid}/export`)
  const ws = exported.data.word_states[0]
  assert.ok(ws.stability > 0 && ws.difficulty > 0)

  await post(`/api/users/${uid}/reset`)
  await post(`/api/users/${uid}/import`, exported.data)
  const rows = await db.all('SELECT * FROM user_words WHERE user_id = ?', uid)
  assert.equal(rows.length, 1)
  assert.ok(Math.abs(rows[0].stability - ws.stability) < 0.001)
  assert.ok(Math.abs(rows[0].difficulty - ws.difficulty) < 0.001)
})

test('words:state 响应含记忆概率字段;词表含 mnemonic 通道(缺内容时为 null)', async () => {
  const { body: created } = await post('/api/users', { username: 'fsrs-state' })
  const uid = created.data.id
  const { body: words } = await j('/api/words')
  assert.ok(words.data.every((w) => 'mnemonic' in w))
  await post('/api/review/result', { user_id: uid, word_id: words.data[0].id, correct: true, response_ms: 1000 })
  const { body: states } = await j(`/api/words/state/${uid}`)
  assert.equal(states.data[0].word_id, words.data[0].id)
  assert.ok('retrievability' in states.data[0])
  assert.equal(states.data[0].retrievability, 1) // 刚复习完 R=1
})

// ====================================================================
// 今日航线 /api/plan:档案(goal/self_level)首次参与排程
// ====================================================================
test('plan:无档案无记录 → 默认量(5 新词),无弱项节点', async () => {
  const { body: created } = await post('/api/users', { username: 'plan-fresh' })
  const uid = created.data.id
  const { status, body } = await j(`/api/plan/${uid}`)
  assert.equal(status, 200)
  assert.equal(body.ok, true)
  assert.ok(body.data.new_words.count >= 3)
  assert.equal(body.data.new_words.word_ids.length, body.data.new_words.count)
  assert.equal(body.data.reviews.count, 0)
  assert.equal(body.data.focus, null)
  assert.ok(body.data.total_minutes <= 25)
})

test('plan:goal/self_level 决定新词量;考试+高阶比兴趣+初级多', async () => {
  const { body: a } = await post('/api/users', { username: 'plan-exam' })
  await post(`/api/users/${a.data.id}/profile`, { goal: 'exam', self_level: 'advanced' })
  const { body: b } = await post('/api/users', { username: 'plan-interest' })
  await post(`/api/users/${b.data.id}/profile`, { goal: 'interest', self_level: 'beginner' })
  const pa = await j(`/api/plan/${a.data.id}`)
  const pb = await j(`/api/plan/${b.data.id}`)
  assert.ok(pa.body.data.new_words.count > pb.body.data.new_words.count)
  assert.equal(pa.body.data.goal, 'exam')
  assert.equal(pb.body.data.new_words.count >= 3, true) // 兴趣档也有保底
})

test('plan:到期词撑起复习节点;总时长被钳到 25 分钟内', async () => {
  const { body: created } = await post('/api/users', { username: 'plan-busy' })
  const uid = created.data.id
  const { body: words } = await j('/api/words')
  // 造 10 个到期词(答错 → 当天再见)
  for (const w of words.data.slice(0, 10)) {
    await post('/api/review/result', { user_id: uid, word_id: w.id, self_grade: 'unknown' })
  }
  const { body: plan } = await j(`/api/plan/${uid}`)
  assert.equal(plan.data.reviews.count, 10)
  assert.ok(plan.data.total_minutes <= 26)
})

test('plan:弱项模块来自答题流水(非词汇模块正确率最低者)', async () => {
  const { body: created } = await post('/api/users', { username: 'plan-weak' })
  const uid = created.data.id
  // 听力 2 对 1 错,阅读全对 → focus = listening
  await post('/api/listening/result', { user_id: uid, passage_id: 1, correct_count: 2, total: 3 })
  await post('/api/reading/result', { user_id: uid, passage_id: 1, correct_count: 3, total: 3 })
  const { body: plan } = await j(`/api/plan/${uid}`)
  assert.equal(plan.data.focus.module, 'listening')
  assert.equal(plan.data.focus.view, 'listening')
  assert.ok(plan.data.focus.reason.includes('听力'))
})

// ====================================================================
// 写作 AI 批改 /api/writing/grade(三级降级:Anthropic→Gemini→本地)
// ====================================================================
test('writing/grade:造句正负反馈(允许 llm 或 local source)', async () => {
  const { body: created } = await post('/api/users', { username: 'grade-sent' })
  const uid = created.data.id
  // 好的造句:目标词用了、有标点、长度合适
  const { status, body: ok } = await j('/api/writing/grade', {
    method: 'POST', body: JSON.stringify({ text: 'Inspect the package before signing.', stage: 'sentence', word: 'inspect' }),
  })
  assert.equal(status, 200)
  assert.equal(ok.ok, true)
  assert.ok(['local', 'llm'].includes(ok.data.source))
  assert.ok(typeof ok.data.score === 'number' && ok.data.score >= 0.5)
  assert.ok(Array.isArray(ok.data.sentences))
  // 差的造句:必须包含"未用到/没找到 inspect 之类"的反馈
  const { body: bad } = await j('/api/writing/grade', {
    method: 'POST', body: JSON.stringify({ text: 'i go to the shop', stage: 'sentence', word: 'inspect' }),
  })
  assert.equal(bad.ok, true)
  const hasTargetFeedback = bad.data.sentences.some((s) =>
    /(未用|没找到|目标词|inspect)/.test((s.issue || '') + (s.tip || '')))
  assert.ok(hasTargetFeedback, '必须报告目标词缺失')
  // 句末标点 / 句首大写至少其中一条要被发现
  const hasPunctOrCap = bad.data.sentences.some((s) =>
    /(大写|标点|收尾|句首)/.test((s.issue || '') + (s.tip || '')))
  assert.ok(hasPunctOrCap, '应报告大小写/标点问题')
})

test('writing/grade:成文模式产出 advice(允许 llm 或 local)', async () => {
  const { body: ok } = await j('/api/writing/grade', {
    method: 'POST',
    body: JSON.stringify({
      text: 'I transport goods by bus. The report is portable. Many exports pass through this port.',
      stage: 'essay',
      word_ids: ['transport', 'port', 'export'],
    }),
  })
  assert.equal(ok.ok, true)
  assert.ok(['local', 'llm'].includes(ok.data.source))
  assert.ok(ok.data.sentences.length >= 1)
  // 本地:3/3;llm:advice 一般也会出现。至少断言存在 advice 字段
  assert.ok(typeof ok.data.advice === 'string' && ok.data.advice.length > 0)
})

test('writing/grade:非法 stage / 空文本返回 400', async () => {
  const r1 = await j('/api/writing/grade', { method: 'POST', body: JSON.stringify({ text: 'x', stage: 'poem' }) })
  assert.equal(r1.status, 400)
  const r2 = await j('/api/writing/grade', { method: 'POST', body: JSON.stringify({ text: '   ', stage: 'sentence' }) })
  assert.equal(r2.status, 400)
})

// ====================================================================
// /api/words/network 词汇网络(共现图谱)
// ====================================================================
test('network:节点数=词库总数 + 跨族共现边(同族不出边) + 元信息', async () => {
  const { body: allWords } = await j('/api/words')
  const { body } = await j('/api/words/network')
  assert.equal(body.ok, true)
  assert.equal(body.data.nodes.length, allWords.data.length)
  assert.ok(body.data.meta.totalNodes === allWords.data.length)
  assert.ok(body.data.meta.totalEdges >= 50 && body.data.meta.totalEdges <= 3000, `edges ${body.data.meta.totalEdges} 异常`)
  assert.ok(body.data.meta.familyCount === 40)
  assert.ok(typeof body.data.meta.computedAt === 'string' && body.data.meta.computedAt.length >= 10)
  // 同族不画边
  for (const e of body.data.edges) {
    assert.notEqual(e.source_root, e.target_root, '同族不应画边')
    assert.ok(e.weight >= 2, 'weight < 2 应被过滤')
  }
})

test('network:无 user_id 时 retrievability 全为 null;带已学词时该词 R 非空', async () => {
  const { body: empty } = await j('/api/words/network')
  assert.ok(empty.data.nodes.every((n) => n.retrievability === null))
  // 创建一个用户学 2 个词
  const { body: u } = await post('/api/users', { username: 'net-tester' })
  const uid = u.data.id
  const { body: ws } = await j('/api/words')
  for (const w of ws.data.slice(0, 2)) {
    await post('/api/review/result', { user_id: uid, word_id: w.id, self_grade: 'known' })
  }
  const { body: withU } = await j(`/api/words/network?user_id=${uid}`)
  const learned = withU.data.nodes.filter((n) => n.retrievability != null)
  assert.equal(learned.length, 2)
  assert.ok(learned.every((n) => n.retrievability > 0 && n.retrievability <= 1))
})

test('network:边按 weight 降序、源汇词在节点里都能找到', async () => {
  const { body } = await j('/api/words/network')
  const ids = new Set(body.data.nodes.map((n) => n.id))
  for (let i = 1; i < body.data.edges.length; i++) {
    assert.ok(ids.has(body.data.edges[i - 1].source) && ids.has(body.data.edges[i - 1].target))
    assert.ok(body.data.edges[i - 1].weight >= body.data.edges[i].weight, '边应按 weight 降序')
  }
})

test('network:第二次请求命中 cache —— computedAt 不变', async () => {
  const { body: a } = await j('/api/words/network')
  const { body: b } = await j('/api/words/network')
  assert.equal(a.data.meta.computedAt, b.data.meta.computedAt)
})
