// 校验 words.json 全部 461 词的 mnemonic 字段:覆盖/长度/无 emoji/不与 etymology 重复/批间去重
// 用法:node scripts/check-mnemonic.mjs(从 backend-node/ 目录运行)
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA = path.join(__dirname, '..', 'data')
const words = JSON.parse(readFileSync(path.join(DATA, 'words.json'), 'utf8'))

const errors = []
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u
const count = { total: words.length, withMn: 0, noMn: 0 }

const norm = (s) => String(s || '').replace(/[\s,，。、.：:?？;；·\-—]/g, '').slice(0, 6)
const seenNorm = new Map()
const dupReport = new Map()

for (const w of words) {
  if (w.mnemonic) {
    count.withMn++
    if (w.mnemonic.length > 80) errors.push(`过长(${w.mnemonic.length}字) ${w.word}: ${w.mnemonic}`)
    if (EMOJI.test(w.mnemonic)) errors.push(`含 emoji ${w.word}: ${w.mnemonic}`)
    if (w.mnemonic === w.etymology) errors.push(`与 etymology 重复 ${w.word}`)
    const n = norm(w.mnemonic)
    if (n.length >= 6) {
      if (seenNorm.has(n)) dupReport.set(n, (dupReport.get(n) || [seenNorm.get(n)]).concat(w.word))
      else seenNorm.set(n, w.word)
    }
  } else {
    count.noMn++
  }
}

// 去重(只报 ≥3 个词复用的可疑模板)
const suspectDup = [...dupReport.entries()].filter(([, w]) => w.length >= 3)
console.log('总词数', count.total, '· 有 mnemonic', count.withMn, '· 缺失', count.noMn)
if (errors.length) { console.log('\n问题:', errors.length); for (const e of errors.slice(0, 10)) console.log(' ·', e) }
if (suspectDup.length) { console.log('\n可疑复用模板(≥3 词):', suspectDup.length); for (const [k, w] of suspectDup.slice(0, 5)) console.log(' ·', w.slice(0, 4).join(' / '), '→ 相同句式 "' + k + '..."') }
if (!errors.length && !suspectDup.length) console.log('\n✓ 全部合格')
process.exit(errors.length || suspectDup.length ? 1 : 0)
