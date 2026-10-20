// 收藏夹:多收藏夹 + 词组管理(Phase 4)
//   GET    /api/users/:userId/collections                      → 列表 + 每夹词数
//   POST   /api/users/:userId/collections {name, color}         → 新建
//   DELETE /api/users/:userId/collections/:cid                  → 删夹(级联清词)
//   POST   /api/users/:userId/collections/:cid/words {word_ids[]} → 加词(重复忽略)
//   DELETE /api/users/:userId/collections/:cid/words/:wordId  → 移除
//   GET    /api/users/:userId/collections/:cid/words           → 列词(JOIN words,含 collocations/examples)
import { Router } from 'express'
import { db, J } from '../db.js'
import { err, ok } from '../helpers.js'

export const collectionsRouter = Router()

// 校验收藏夹归属(返回 collection 行 / undefined)
async function fetchOwnedCid(userId, cid) {
  return db.get('SELECT * FROM collections WHERE id = ? AND user_id = ?', Number(cid), userId)
}

// GET /api/users/:userId/collections → 列表 + word_count
collectionsRouter.get('/users/:userId/collections', async (req, res) => {
  const userId = Number(req.params.userId)
  const user = await db.get('SELECT * FROM users WHERE id = ?', userId)
  if (!user) return res.json(err(`user ${userId} not found`))
  const rows = await db.all(
    `SELECT c.*, COUNT(cw.word_id) AS word_count
       FROM collections c
       LEFT JOIN collection_words cw ON cw.collection_id = c.id
       WHERE c.user_id = ?
       GROUP BY c.id
       ORDER BY c.id DESC`, userId)
  return res.json(ok(rows.map((c) => ({
    id: c.id, name: c.name, color: c.color ?? 'accent', created_at: c.created_at, word_count: Number(c.word_count),
  }))))
})

// POST /api/users/:userId/collections {name, color} → 新建
collectionsRouter.post('/users/:userId/collections', async (req, res) => {
  const userId = Number(req.params.userId)
  const user = await db.get('SELECT * FROM users WHERE id = ?', userId)
  if (!user) return res.status(400).json(err(`user ${userId} not found`))

  const name = String(req.body?.name ?? '').trim()
  const color = String(req.body?.color ?? 'accent').trim() || 'accent'
  if (!name) return res.status(400).json(err('name 不能为空'))
  if (name.length > 64) return res.status(400).json(err('name 长度不能超过 64'))

  // 同名查重(同 user 下唯一)
  const exist = await db.get('SELECT id FROM collections WHERE user_id = ? AND name = ?', userId, name)
  if (exist) return res.status(400).json(err(`已存在同名收藏夹: ${name}`))

  const r = await db.run('INSERT INTO collections (user_id, name, color) VALUES (?, ?, ?)', userId, name, color)
  const fresh = await db.get('SELECT * FROM collections WHERE id = ?', Number(r.lastInsertRowid))
  return res.json(ok({ id: fresh.id, name: fresh.name, color: fresh.color, created_at: fresh.created_at, word_count: 0 }))
})

// DELETE /api/users/:userId/collections/:cid → 删夹(级联清词)
collectionsRouter.delete('/users/:userId/collections/:cid', async (req, res) => {
  const userId = Number(req.params.userId)
  const cid = Number(req.params.cid)
  const col = await fetchOwnedCid(userId, cid)
  if (!col) return res.json(err(`收藏夹 ${cid} not found`))
  await db.run('DELETE FROM collections WHERE id = ?', cid)
  return res.json(ok({ ok: true }))
})

// POST /api/users/:userId/collections/:cid/words {word_ids:[]} → 加词
collectionsRouter.post('/users/:userId/collections/:cid/words', async (req, res) => {
  const userId = Number(req.params.userId)
  const cid = Number(req.params.cid)
  const col = await fetchOwnedCid(userId, cid)
  if (!col) return res.json(err(`收藏夹 ${cid} not found`))

  const wordIds = Array.isArray(req.body?.word_ids) ? [...new Set(req.body.word_ids.map(Number).filter((n) => Number.isFinite(n) && n > 0))] : []
  if (!wordIds.length) return res.status(400).json(err('word_ids 必须是非空数组'))

  // 校验 word 真实存在(否则 INSERT 会被 FK 阻挡,但前置校验可给更友好错误)
  let added = 0
  for (const wid of wordIds) {
    const w = await db.get('SELECT id FROM words WHERE id = ?', wid)
    if (!w) continue
    // INSERT OR IGNORE / INSERT IGNORE(由 DAO insertIgnore 收敛方言)
    const r = await db.insertIgnore(
      'INSERT INTO collection_words (collection_id, word_id) VALUES (?, ?)', cid, wid)
    added += Number(r.changes) || 0
  }
  return res.json(ok({ ok: true, added }))
})

// DELETE /api/users/:userId/collections/:cid/words/:wordId → 移除
collectionsRouter.delete('/users/:userId/collections/:cid/words/:wordId', async (req, res) => {
  const userId = Number(req.params.userId)
  const cid = Number(req.params.cid)
  const wid = Number(req.params.wordId)
  const col = await fetchOwnedCid(userId, cid)
  if (!col) return res.json(err(`收藏夹 ${cid} not found`))
  await db.run('DELETE FROM collection_words WHERE collection_id = ? AND word_id = ?', cid, wid)
  return res.json(ok({ ok: true }))
})

// GET /api/users/:userId/collections/:cid/words → 列词(含 word 全字段,按 addDate 倒序)
collectionsRouter.get('/users/:userId/collections/:cid/words', async (req, res) => {
  const userId = Number(req.params.userId)
  const cid = Number(req.params.cid)
  const col = await fetchOwnedCid(userId, cid)
  if (!col) return res.json(err(`收藏夹 ${cid} not found`))
  const rows = await db.all(
    `SELECT w.*, cw.added_at FROM collection_words cw
       JOIN words w ON w.id = cw.word_id
       WHERE cw.collection_id = ?
       ORDER BY cw.added_at DESC`, cid)
  return res.json(ok(rows.map((w) => ({
    id: w.id,
    word: w.word,
    ipa: w.ipa,
    pos: w.pos,
    meaning: w.meaning,
    root: w.root,
    root_meaning: w.root_meaning,
    etymology: w.etymology,
    collocations: J.parse(w.collocations),
    examples: J.parse(w.examples),
    family: w.family,
    level: w.level,
    added_at: w.added_at,
  }))))
})