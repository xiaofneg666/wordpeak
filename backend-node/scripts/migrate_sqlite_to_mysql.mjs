// 一次性迁移:SQLite(backend-node/wordpeak.db) → MySQL(.env 里 WORDPEAK_MYSQL_* 指向的库)
// 用法:cd backend-node && node scripts/migrate_sqlite_to_mysql.mjs
// - 知识库(words/phonemes/grammar/passages)由 initDb() 按同一份 data/*.json 播种
// - 用户数据(users/user_words/成绩表)从 SQLite 逐表拷贝;word_id/point_id/passage_id
//   两库自增顺序未必一致,一律按业务键(词串/标题/类型+标题)重映射,不赌顺序
// - 幂等:目标 users 表已有数据时跳过用户段(重跑不翻倍)
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// 驱动在 import 期绑定;.env(WORDPEAK_DB=mysql 等)由 db.js 顶部加载
const { db, initDb } = await import('../src/db.js')

const SRC = new DatabaseSync(path.join(__dirname, '..', 'wordpeak.db'), { readOnly: true })
const dt = (v) => (v == null ? v : v.replace('T', ' ')) // 'YYYY-MM-DDTHH:MM:SS' → DATETIME 写入格式
const srcAll = (sql) => SRC.prepare(sql).all()

console.log('== initDb:建表 + 种子(幂等)')
const stats = await initDb()
console.log(`   driver=${db.driver} words=+${stats.words} phonemes=+${stats.phonemes} grammar=+${stats.grammar} passages=+${stats.passages}`)

// ---- 知识库外键映射:老 id → 新 id ----
const srcWordId = new Map(srcAll('SELECT id, word FROM words').map((r) => [r.id, r.word]))
const dstWordId = new Map((await db.all('SELECT id, word FROM words')).map((r) => [r.word, r.id]))
const mapWord = (old) => {
  const n = dstWordId.get(srcWordId.get(old))
  if (n == null) throw new Error(`目标库缺词: ${srcWordId.get(old)}`)
  return n
}
const srcG = new Map(srcAll('SELECT id, title FROM grammar_points').map((r) => [r.id, r.title]))
const dstG = new Map((await db.all('SELECT id, title FROM grammar_points')).map((r) => [r.title, r.id]))
const mapPoint = (old) => dstG.get(srcG.get(old))
const srcP = new Map(srcAll('SELECT id, type, title FROM passages').map((r) => [r.id, `${r.type}|${r.title}`]))
const dstP = new Map((await db.all('SELECT id, type, title FROM passages')).map((r) => [`${r.type}|${r.title}`, r.id]))
const mapPassage = (old) => dstP.get(srcP.get(old))
for (const [name, fn] of [['words', mapWord], ['grammar', mapPoint], ['passages', mapPassage]]) {
  if (!srcP.size && name === 'passages') continue // 空源表映射为空 Map 属正常
}
const mapOrNull = (fn, v) => (v == null ? null : fn(v))

// ---- 用户数据逐表拷贝(空表也走一遍,保证幂等语义一致) ----
const TABLES = [
  { t: 'users', cols: ['id', 'username', 'created_at', 'goal', 'self_level', 'prefs'], dtCols: ['created_at'] },
  { t: 'user_words', cols: ['id', 'user_id', 'word_id', 'repetitions', 'ease', 'interval_days', 'lapses', 'peak_strength', 'stability', 'difficulty', 'first_learned_at', 'last_review_at', 'due_at'], dtCols: ['first_learned_at', 'last_review_at', 'due_at'], maps: { word_id: mapWord } },
  { t: 'grammar_results', cols: ['id', 'user_id', 'point_id', 'quiz_index', 'correct', 'created_at'], dtCols: ['created_at'], maps: { point_id: mapPoint } },
  { t: 'listening_results', cols: ['id', 'user_id', 'passage_id', 'correct_count', 'total', 'created_at'], dtCols: ['created_at'], maps: { passage_id: mapPassage } },
  { t: 'speaking_results', cols: ['id', 'user_id', 'passage_id', 'sentence_index', 'score', 'transcript', 'created_at'], dtCols: ['created_at'], maps: { passage_id: mapPassage } },
  { t: 'reading_results', cols: ['id', 'user_id', 'passage_id', 'correct_count', 'total', 'created_at'], dtCols: ['created_at'], maps: { passage_id: mapPassage } },
  { t: 'writing_results', cols: ['id', 'user_id', 'stage', 'word_id', 'score', 'text', 'feedback', 'created_at'], dtCols: ['created_at'], maps: { word_id: (v) => mapOrNull(mapWord, v) } },
  { t: 'activity_events', cols: ['id', 'user_id', 'date', 'module', 'correct', 'total', 'word_id', 'created_at'], dtCols: ['created_at'], maps: { word_id: (v) => mapOrNull(mapWord, v) } },
  { t: 'phonetic_results', cols: ['id', 'user_id', 'kind', 'ref_id', 'correct', 'created_at'], dtCols: ['created_at'] },
  { t: 'collections', cols: ['id', 'user_id', 'name', 'color', 'created_at'], dtCols: ['created_at'] },
  { t: 'collection_words', cols: ['collection_id', 'word_id', 'added_at'], dtCols: ['added_at'], maps: { word_id: mapWord } },
  { t: 'diary_entries', cols: ['id', 'user_id', 'zh_text', 'en_text', 'created_at'], dtCols: ['created_at'] },
]

const guard = await db.get('SELECT COUNT(*) c FROM users')
if (guard.c > 0) {
  console.log(`目标库 users 已有 ${guard.c} 行,用户数据跳过(防重跑翻倍);知识库已对齐`)
} else {
  console.log('== 用户数据迁移')
  for (const { t, cols, dtCols = [], maps = {} } of TABLES) {
    const rows = srcAll(`SELECT ${cols.join(', ')} FROM ${t}`)
    if (!rows.length) { console.log(`   ${t}: 源 0 行,跳过`); continue }
    const ph = cols.map(() => '?').join(', ')
    for (const r of rows) {
      const vals = cols.map((c) => {
        let v = r[c]
        if (dtCols.includes(c)) v = dt(v)
        if (maps[c]) v = maps[c](v)
        return v
      })
      await db.insertIgnore(`INSERT INTO ${t} (${cols.join(', ')}) VALUES (${ph})`, ...vals)
    }
    const dst = (await db.get(`SELECT COUNT(*) c FROM ${t}`)).c
    console.log(`   ${t}: ${rows.length} 行 → 目标 ${dst} 行 ${dst === rows.length ? '✓' : '!! 数量不符'}`)
  }
}

// ---- 终检:两库行数对照 ----
console.log('== 行数对照(源 SQLite / 目标 MySQL)')
for (const t of ['users', 'words', 'phonemes', 'grammar_points', 'passages', 'user_words',
  'grammar_results', 'listening_results', 'speaking_results', 'reading_results', 'writing_results',
  'activity_events', 'phonetic_results', 'collections', 'collection_words', 'diary_entries']) {
  const s = srcAll(`SELECT COUNT(*) c FROM ${t}`)[0].c
  const d = (await db.get(`SELECT COUNT(*) c FROM ${t}`)).c
  const ok = s === d ? '✓' : '!! 不一致'
  if (s || d) console.log(`   ${t}: ${s} / ${d} ${ok}`)
}
SRC.close()
await db.close()
console.log('迁移完成')
