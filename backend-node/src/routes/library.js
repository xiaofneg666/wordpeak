// 轨道书库:GET /api/library(?user_id= 可选,附每章是否已读)
// 书树元数据来自 data/library.json(由 scripts/library-build.mjs 从 data/library-books/ 装配);
// 章节 passage_id 运行时按 (type='reading', title) 反查——标题即 seed 幂等键,不硬编码 id。
import { Router } from 'express'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { db } from '../db.js'
import { err, ok } from '../helpers.js'

export const libraryRouter = Router()

const __dirname = dirname(fileURLToPath(import.meta.url))
const LIBRARY_PATH = join(__dirname, '..', '..', 'data', 'library.json')

function loadLibrary() {
  try {
    return JSON.parse(readFileSync(LIBRARY_PATH, 'utf8'))
  } catch {
    return null
  }
}

libraryRouter.get('/library', async (req, res) => {
  const lib = loadLibrary()
  if (!lib) return res.json(err('library.json not built; run scripts/library-build.mjs'))

  // 反查章节 passage_id(标题约定「《书名》· 章节名」是全局唯一 seed 键)
  const rows = await db.all("SELECT id, title FROM passages WHERE type = 'reading'")
  const byTitle = new Map(rows.map((r) => [r.title, r.id]))

  // 可选:用户视角的已读章(该章在 reading_results 里出现过即算读过一次)
  let readIds = new Set()
  const userId = Number(req.query.user_id) || 0
  if (userId > 0) {
    const rr = await db.all('SELECT DISTINCT passage_id FROM reading_results WHERE user_id = ?', userId)
    readIds = new Set(rr.map((r) => r.passage_id))
  }

  const books = (lib.books || []).map((b) => ({
    id: b.id,
    title: b.title,
    en_title: b.en_title,
    author: b.author,
    region: b.region,
    level: b.level,
    one_line: b.one_line,
    word_focus: b.word_focus || [],
    chapters: (b.chapters || []).map((c) => {
      const pid = byTitle.get(c.passage_title) || null
      return { no: c.no, title: c.title, passage_id: pid, read: pid != null && readIds.has(pid) }
    }),
  }))

  return res.json(ok({ books }))
})
