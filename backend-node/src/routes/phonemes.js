// 发音舱知识库:GET /api/phonemes
import { Router } from 'express'
import { db, J } from '../db.js'
import { ok } from '../helpers.js'

export const phonemesRouter = Router()

phonemesRouter.get('/phonemes', async (req, res) => {
  const rows = await db.all('SELECT * FROM phonemes ORDER BY id')
  return res.json(ok(rows.map((p) => ({
    id: p.id,
    symbol: p.symbol,
    type: p.type,
    name: p.name,
    voiced: !!p.voiced,
    tip: p.tip,
    similar: J.parse(p.similar),
    example_words: J.parse(p.example_words),
    level: p.level,
  }))))
})