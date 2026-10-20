// 装配轨道书库:校验 data/library-books/b*.json → 生成 data/library.json
// + 把章节并入 data/library-books/../passages.json(type='reading',标题「《书名》· 章节名」)
// 幂等:按 type|title 去重,内容变化时 UPDATE 既有条目(与 seed 的幂等键一致)。
// 词库命中校验:每章至少 ≥5 个不同的词库词(含屈折形态),阈值低于此报错退出。
// 用法:node scripts/library-build.mjs(从 backend-node/ 目录运行)
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA = path.join(__dirname, '..', 'data')
const BOOKS_DIR = path.join(DATA, 'library-books')

const words = JSON.parse(readFileSync(path.join(DATA, 'words.json'), 'utf8'))
const passages = JSON.parse(readFileSync(path.join(DATA, 'passages.json'), 'utf8'))

// ---- 词库命中:词形还原(与 ReadingView exactMap+lemmaMap 同源,双方向兜底) ----
function stem(w) {
  return w.toLowerCase().replace(/[^a-z']/g, '')
}
function lemma(w) {
  let v = stem(w)
  // 常见屈折后缀(从长到短;双写尾辅音如 omitted/committed 的 ed/ing 会留下双写,再去一层)
  v = v.replace(/(ies|ied)$/, 'y').replace(/(ing|ed|es|s)$/, '')
  // 双写尾辅音:ommit→omit(先去掉后缀,再折叠一次双辅音)
  v = v.replace(/([bcdfgmnpt])\1$/, '$1')
  return v
}
// 展开方向:每个词库词生成屈折变体表 → token 精确命中(避免 over-reduce 误伤)
const inflect = (w) => {
  const s = new Set([w])
  const lower = w.toLowerCase()
  s.add(lower + 's')
  s.add(lower + 'es')
  if (lower.endsWith('y')) { s.add(lower.slice(0, -1) + 'ies'); s.add(lower.slice(0, -1) + 'ied') }
  s.add(lower + 'ed'); s.add(lower + 'ing')
  if (lower.endsWith('e')) { // e 结尾动词:advise→advised(留 e 加 d)/advising(去 e 加 ing)
    s.add(lower + 'd'); s.add(lower.slice(0, -1) + 'ing')
  }
  if (/[bcdfgmnpt]$/.test(lower)) { s.add(lower + lower.slice(-1) + 'ed'); s.add(lower + lower.slice(-1) + 'ing') }
  return s
}
const tokenMap = new Map() // 屈折变体 → 词库词
for (const w of words) for (const f of inflect(w.word)) if (!tokenMap.has(f)) tokenMap.set(f, w.word)
const exactSet = new Set(words.map((w) => w.word.toLowerCase()))
const tokenize = (s) => String(s).split(/[^A-Za-z']+/).filter(Boolean)
function hits(text) {
  const found = new Set()
  for (const t of tokenize(text)) {
    const v = stem(t)
    if (exactSet.has(v) || tokenMap.has(v)) found.add(exactSet.has(v) ? v : tokenMap.get(v))
  }
  return found
}

// ---- 校验器 ----
const errors = []
const warns = []
function must(cond, msg) { if (!cond) errors.push(msg) }

const files = readdirSync(BOOKS_DIR).filter((f) => /^b\d+\.json$/.test(f)).sort((a, b) => {
  const na = Number(a.replace(/\D/g, '')); const nb = Number(b.replace(/\D/g, ''))
  return na - nb
})
must(files.length > 0, 'library-books 目录里没有 b*.json')

const books = []
const newPassages = []
for (const f of files) {
  let book
  try { book = JSON.parse(readFileSync(path.join(BOOKS_DIR, f), 'utf8')) } catch (e) { errors.push(`${f}: JSON 解析失败 ${e.message}`); continue }
  const tag = `${f}(${book.title || '?'})`
  for (const k of ['id', 'title', 'en_title', 'author', 'region', 'level', 'one_line', 'word_focus', 'chapters']) {
    must(book[k] != null && book[k] !== '', `${tag}: 缺字段 ${k}`)
  }
  must(['literary', 'science', 'classic'].includes(book.region), `${tag}: region 非法 ${book.region}`)
  must(Number(book.level) >= 1 && Number(book.level) <= 4, `${tag}: level 非法 ${book.level}`)
  must(Array.isArray(book.chapters) && book.chapters.length >= 3, `${tag}: 章节数 <3`)
  if (errors.length) continue

  const chapters = []
  for (const c of book.chapters) {
    const ctag = `${tag} 第${c.no}章(${c.title})`
    // 句数上限放宽到 40:A1 分级读本用大量短句自然成文(2026-10 扩写后正文 320-900 词/章),
    // 夜读舱已按真实书页自动分页,不再是微缩读物时代的 14 句封顶
    must(Array.isArray(c.sentences) && c.sentences.length >= 10 && c.sentences.length <= 40, `${ctag}: 句数 ${c.sentences?.length} 不在 10~40`)
    for (const s of c.sentences || []) {
      must(s && typeof s.en === 'string' && s.en.trim().length > 3, `${ctag}: 有句子缺 en`)
      must(s && typeof s.zh === 'string' && s.zh.trim().length > 1, `${ctag}: 有句子缺 zh`)
    }
    must(Array.isArray(c.questions) && c.questions.length >= 3 && c.questions.length <= 5, `${ctag}: 题数 ${c.questions?.length} 不在 3~5`)
    for (const q of c.questions || []) {
      must(q && typeof q.q === 'string' && q.q.trim(), `${ctag}: 有题缺 q`)
      must(Array.isArray(q.options) && q.options.length === 4, `${ctag}: 选项数 !=4`)
      must(Number.isInteger(q.answer) && q.answer >= 0 && q.answer <= 3, `${ctag}: answer 非法 ${q.answer}`)
      must(typeof q.explain === 'string' && q.explain.trim(), `${ctag}: 有题缺 explain`)
    }
    // 词库命中:章节所有英文句拼起来 ≥5 个不同词库词
    const found = hits((c.sentences || []).map((s) => s.en).join(' '))
    if (found.size < 5) warns.push(`${ctag}: 词库命中仅 ${found.size} 词(<5)`)
    if (errors.length) continue

    const passageTitle = `《${book.title}》· ${c.title}`
    must(!passages.some((p) => p.type !== 'reading' && p.title === passageTitle), `${ctag}: 标题与非阅读语料撞名`)
    chapters.push({ no: c.no, title: c.title, passage_title: passageTitle })
    newPassages.push({
      id: null, // 稍后统一分配
      type: 'reading',
      level: Number(book.level),
      title: passageTitle,
      sentences: c.sentences,
      questions: c.questions,
      _hits: found.size,
    })
  }
  if (errors.length) continue
  books.push({
    id: book.id, title: book.title, en_title: book.en_title, author: book.author,
    region: book.region, level: Number(book.level), one_line: book.one_line,
    word_focus: book.word_focus, chapters,
  })
}

if (errors.length) {
  console.error('✗ 校验失败:')
  for (const e of errors) console.error('  - ' + e)
  process.exit(1)
}

// ---- 并入 passages.json(幂等:按 type|title;内容变化即替换) ----
let nextId = Math.max(...passages.map((p) => p.id || 0)) + 1
let added = 0
let updated = 0
for (const np of newPassages) {
  const idx = passages.findIndex((p) => p.type === np.type && p.title === np.title)
  const clean = { id: 0, type: np.type, level: np.level, title: np.title, sentences: np.sentences, questions: np.questions }
  if (idx >= 0) {
    clean.id = passages[idx].id
    const old = JSON.stringify({ s: passages[idx].sentences, q: passages[idx].questions, l: passages[idx].level })
    const cur = JSON.stringify({ s: np.sentences, q: np.questions, l: np.level })
    if (old !== cur) { passages[idx] = clean; updated++ } // 内容迭代 → 覆盖(seed 会 UPDATE)
  } else {
    clean.id = nextId++
    passages.push(clean)
    added++
  }
}
writeFileSync(path.join(DATA, 'passages.json'), JSON.stringify(passages, null, 1) + '\n')

// ---- 生成 library.json ----
writeFileSync(path.join(DATA, 'library.json'), JSON.stringify({ books }, null, 1) + '\n')

console.log(`✓ 装配完成:${books.length} 本书 / ${newPassages.length} 章(passages.json +${added} 更新${updated})`)
console.log(`  词库命中:${newPassages.map((p) => p.title.slice(0, 12) + ':' + p._hits).join('  ')}`)
if (warns.length) { console.warn('⚠ 命中偏低(可放行,建议修):'); for (const w of warns) console.warn('  - ' + w) }
