// 校验 passages.json 每篇对 461 词库的命中占比(exact + 简单词形还原)
// 准入门槛:每篇 ≥60% 的句子里至少含 2 个词库词
// 用法:node scripts/passage-coverage.mjs(从 backend-node/ 目录运行)
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA = path.join(__dirname, '..', 'data')
const words = JSON.parse(readFileSync(path.join(DATA, 'words.json'), 'utf8'))
const passages = JSON.parse(readFileSync(path.join(DATA, 'passages.json'), 'utf8'))

// 词形还原:去掉常见后缀(避免 over-reduce)
function lemma(w) {
  return w.toLowerCase().replace(/[^a-z']/g, '').replace(/(iness|fully|edness|ously|ing|edly|ies|ied|es|ed|er|est|ly|s|ness|ment|tion|ous|ful|less)$/i, '')
}
// 直接按非字母切分(与 ReadingView 的 exactMap/lemmaMap 同源)
const tokenize = (s) => String(s).split(/[^A-Za-z']+/).filter(Boolean)
const exact = new Map(words.map((w) => [w.word.toLowerCase(), w]))
const lm = new Map(words.map((w) => [lemma(w.word), w]))
function match(t) {
  if (!t) return null
  const v = lemma(t)
  if (!v) return null
  return exact.get(v) || lm.get(v) || null
}

const THRESHOLD = 0.6
let bad = 0
for (const p of passages) {
  const sents = p.sentences || []
  const hit = sents.map((s) => {
    const found = []
    for (const tok of tokenize(s.en || '')) { const w = match(tok); if (w) found.push(w.word) }
    return { hits: new Set(found).size, words: [...new Set(found)] }
  })
  const ok = hit.filter((x) => x.hits >= 2).length
  const pct = (ok / Math.max(1, sents.length) * 100).toFixed(0)
  const status = ok / Math.max(1, sents.length) >= THRESHOLD ? '✓' : '✗'
  if (status === '✗') bad++
  console.log(`${status} ${p.type.padEnd(8)} Lv${p.level} id${String(p.id).padStart(2)} ${pct}% (${ok}/${sents.length})  ${p.title}`)
  if (status === '✗') console.log(`   命中词:${[...new Set(hit.flatMap((x) => x.words))].slice(0, 8).join(' / ')}`)
}
console.log(`\n${bad === 0 ? '✓ 全部合格' : '✗ ' + bad + ' 篇未达标'} (门槛 ${THRESHOLD * 100}% 句含 ≥2 词)`)
process.exit(bad ? 1 : 0)
