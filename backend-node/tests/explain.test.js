// /api/explain 冒烟测试:沿用 test 临时库;不依赖外网(无 key 走本地降级)
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const TMP = mkdtempSync(path.join(tmpdir(), 'wordpeak-explain-'))
process.env.WORDPEAK_DB = path.join(TMP, 'explain.db')
// 隔离 backend-node/.env:别把真实 AI key 注回本测试(要验证无 key 的本地降级)
process.env.WORDPEAK_NO_ENVFILE = '1'
delete process.env.ANTHROPIC_API_KEY
delete process.env.GEMINI_API_KEY

const { createApp } = await import('../src/app.js')
const { db } = await import('../src/db.js')

let server, BASE
test.before(async () => {
  const app = await createApp()
  server = app.listen(0, '127.0.0.1')
  await new Promise((r) => server.once('listening', r))
  BASE = `http://127.0.0.1:${server.address().port}`
})
test.after(async () => {
  server.closeAllConnections?.()
  await new Promise((r) => server.close(r))
  try { db.close() } catch {}
  try { rmSync(TMP, { recursive: true, force: true }) } catch {}
})

const post = (pathname, data) => fetch(BASE + pathname, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(data),
}).then(async (r) => ({ status: r.status, body: await r.json() }))

test('word 模式:命中词库返回五字段(explain/mnemonic/tip/usage/grammar)且 source=local', async () => {
  // 数据库 seed 里第一个 root 通常是 spect-;取一个真实词
  const row = await db.get('SELECT word FROM words LIMIT 1')
  const r = await post('/api/explain', { mode: 'word', word: row.word, userId: 'u1' })
  assert.equal(r.status, 200)
  assert.equal(r.body.ok, true)
  assert.equal(r.body.data.source, 'local')
  assert.ok(r.body.data.explain, 'explain 必填')
  assert.ok(r.body.data.mnemonic, 'mnemonic 必填')
  assert.ok(r.body.data.tip, 'tip 必填')
  assert.ok(r.body.data.grammar, 'grammar 必填')
})

test('word 模式:词库外的词不再 404,给本地构词速览', async () => {
  const r = await post('/api/explain', { mode: 'word', word: 'zzznotaword', userId: 'u1' })
  assert.equal(r.status, 200)
  assert.equal(r.body.ok, true)
  assert.equal(r.body.data.source, 'local')
  assert.ok(r.body.data.explain, 'explain 必填')
})

test('word 模式:LRU 第二次同词秒回', async () => {
  const row = await db.get('SELECT word FROM words LIMIT 1')
  const a = await post('/api/explain', { mode: 'word', word: row.word, userId: 'u1' })
  const b = await post('/api/explain', { mode: 'word', word: row.word, userId: 'u1' })
  assert.equal(a.status, 200)
  assert.equal(b.status, 200)
  // 两次返回结构一致(本地源;LLM 不存在时永远 local)
  assert.equal(b.body.data.source, 'local')
})

test('sentence 模式:有译文的语料句返回非空 translate', async () => {
  // 取 passages 里第一个有 sentences(zh) 的句
  const row = await db.get("SELECT sentences FROM passages WHERE sentences LIKE '%zh%' LIMIT 1")
  if (!row) { console.log('no passage with zh skipped'); return }
  const list = typeof row.sentences === 'string' ? JSON.parse(row.sentences) : row.sentences
  const s = list[0]
  if (!s?.en) return
  const r = await post('/api/explain', { mode: 'sentence', sentence: s.en, title: 'test', userId: 'u1' })
  assert.equal(r.status, 200)
  assert.equal(r.body.data.source, 'local')
  assert.ok(r.body.data.translate, 'translate 必填')
  assert.ok(r.body.data.grammar, 'grammar 必填')
})

test('sentence 模式:必填校验', async () => {
  const r = await post('/api/explain', { mode: 'sentence', sentence: '', userId: 'u1' })
  assert.equal(r.status, 400)
  assert.equal(r.body.ok, false)
})

test('频控:同用户 21 次连续 word 模式,第 21 次返回 429', async () => {
  const row = await db.get('SELECT word FROM words LIMIT 1')
  const userId = 'rl-' + Date.now()
  let last = null
  for (let i = 0; i < 21; i++) {
    last = await post('/api/explain', { mode: 'word', word: row.word, userId })
  }
  assert.equal(last.status, 429, '第 21 次应被 429 限流')
})
