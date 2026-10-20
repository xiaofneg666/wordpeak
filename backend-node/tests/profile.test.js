// 用户档案端点冒烟:GET/POST /api/users/:id/profile + 老 wordpeak.db 无档案列时的 ALTER 迁移
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

// 必须在 import app 之前设置:让 db.js 指向临时库,不污染 wordpeak.db
const TMP = mkdtempSync(path.join(tmpdir(), 'wordpeak-profile-test-'))
process.env.WORDPEAK_DB = path.join(TMP, 'test.db')
// 隔离 backend-node/.env:别把真实 AI key 注回本测试(要验证无 key 的本地降级)
process.env.WORDPEAK_NO_ENVFILE = '1'

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
  server.closeAllConnections?.()
  await new Promise((r) => server.close(r))
  try { db.close() } catch { /* 忽略 */ }
  try { rmSync(TMP, { recursive: true, force: true }) } catch { /* Windows 偶发占用 */ }
})

async function j(pathname, opts = {}) {
  const res = await fetch(BASE + pathname, { headers: { 'content-type': 'application/json' }, ...opts })
  return { status: res.status, body: await res.json() }
}
const post = (pathname, data) => j(pathname, { method: 'POST', body: JSON.stringify(data) })

async function newUser(name) {
  const { body } = await post('/api/users', { username: name })
  assert.equal(body.ok, true)
  return body.data.id
}

test('profile:新用户默认空档案', async () => {
  const uid = await newUser('profile-default')
  const { status, body } = await j(`/api/users/${uid}/profile`)
  assert.equal(status, 200)
  assert.equal(body.ok, true)
  assert.deepEqual(body.data, { goal: null, self_level: null, prefs: {} })
})

test('profile:全量写入后 GET 读回一致(含 prefs 对象)', async () => {
  const uid = await newUser('profile-full')
  const { status, body } = await post(`/api/users/${uid}/profile`, {
    goal: 'exam',
    self_level: 'intermediate',
    prefs: { speechRate: 0.9, listenLevel: 2, tipCategory: 'listening' },
  })
  assert.equal(status, 200)
  assert.equal(body.ok, true)
  assert.equal(body.data.goal, 'exam')
  assert.equal(body.data.self_level, 'intermediate')
  assert.deepEqual(body.data.prefs, { speechRate: 0.9, listenLevel: 2, tipCategory: 'listening' })

  // GET 独立读回一致(证明持久化到库而非只回显)
  const { body: got } = await j(`/api/users/${uid}/profile`)
  assert.deepEqual(got.data, body.data)
})

test('profile:部分更新只动传入字段,清空传 null', async () => {
  const uid = await newUser('profile-patch')
  await post(`/api/users/${uid}/profile`, { goal: 'work', prefs: { speechRate: 1.2 } })

  const { body: p1 } = await post(`/api/users/${uid}/profile`, { self_level: 'beginner' })
  assert.equal(p1.data.goal, 'work')            // 未传不动
  assert.deepEqual(p1.data.prefs, { speechRate: 1.2 })
  assert.equal(p1.data.self_level, 'beginner')

  const { body: p2 } = await post(`/api/users/${uid}/profile`, { goal: null })
  assert.equal(p2.data.goal, null)             // null 清空
  assert.equal(p2.data.self_level, 'beginner')

  const { body: p3 } = await post(`/api/users/${uid}/profile`, { prefs: null })
  assert.deepEqual(p3.data.prefs, {})
})

test('profile:非法值返回 400 且不落库', async () => {
  const uid = await newUser('profile-bad')
  const cases = [
    { goal: 'exammmm' },            // 非法枚举
    { goal: 42 },
    { self_level: 'expert' },       // 非法枚举
    { self_level: ['beginner'] },
    { prefs: 'fast' },              // prefs 必须是对象
    { prefs: [{ a: 1 }] },          // 数组也不行
    {},                             // 空更新
  ]
  for (const c of cases) {
    const { status } = await post(`/api/users/${uid}/profile`, c)
    assert.equal(status, 400, JSON.stringify(c))
  }
  const { body: got } = await j(`/api/users/${uid}/profile`)
  assert.deepEqual(got.data, { goal: null, self_level: null, prefs: {} }) // 坏请求不污染

  // 不存在的用户:GET 走旧契约 200+ok:false,POST 400(与 import 一致)
  const { body: g } = await j('/api/users/999999/profile')
  assert.equal(g.ok, false)
  const { status: s2 } = await post('/api/users/999999/profile', { goal: 'exam' })
  assert.equal(s2, 400)
})

test('profile:坏 JSON 的 prefs 存量不炸,退回空对象', async () => {
  const uid = await newUser('profile-legacy-bad')
  // 直接往库里塞一段非法 JSON,模拟历史脏数据
  await db.run('UPDATE users SET prefs = ? WHERE id = ?', '{oops', uid)
  const { status, body } = await j(`/api/users/${uid}/profile`)
  assert.equal(status, 200)
  assert.deepEqual(body.data.prefs, {})
})

test('迁移:无档案列的老库 initDb 补列且不丢数据', async () => {
  // 1) 手工造一个只有老 schema 的库
  const oldPath = path.join(TMP, 'legacy.db')
  const raw = new DatabaseSync(oldPath)
  raw.exec(`CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%S','now'))
  )`)
  raw.prepare('INSERT INTO users (username) VALUES (?)').run('legacy-user')
  raw.close()

  // 2) 子进程里跑 initDb(db.js 的连接在 import 时绑定,必须隔进程才能换 WORDPEAK_DB)
  const dbJsUrl = pathToFileURL(fileURLToPath(new URL('../src/db.js', import.meta.url))).href
  const code = `const { initDb } = await import(process.env.WV_DBJS_URL); await initDb()`
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
    env: { ...process.env, WORDPEAK_DB: oldPath, WV_DBJS_URL: dbJsUrl },
    encoding: 'utf8',
  })
  assert.equal(r.status, 0, `stderr: ${r.stderr}`)

  // 3) 老数据还在,新列可用
  const check = new DatabaseSync(oldPath)
  const cols = check.prepare('PRAGMA table_info(users)').all().map((c) => c.name)
  for (const col of ['goal', 'self_level', 'prefs']) assert.ok(cols.includes(col), `缺列 ${col}`)
  const row = check.prepare('SELECT * FROM users WHERE username = ?').get('legacy-user')
  assert.ok(row.id, '老用户数据保留')
  check.prepare('UPDATE users SET goal = ?, prefs = ? WHERE id = ?').run('exam', '{"speechRate":1}', row.id)
  const row2 = check.prepare('SELECT goal, prefs FROM users WHERE id = ?').get(row.id)
  assert.equal(row2.goal, 'exam')
  check.close()
  rmSync(oldPath, { force: true })
})
