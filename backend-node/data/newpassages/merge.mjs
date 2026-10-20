// 合并 data/newpassages/p1-p8.json 到 data/passages.json（追加到数组末尾，幂等：按 type|title 去重）
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dataDir = path.join(__dirname, '..')
const fragments = readdirSync(__dirname)
  .filter((f) => /^p[1-8]\.json$/.test(f))
  .sort()

const passages = JSON.parse(readFileSync(path.join(dataDir, 'passages.json'), 'utf-8'))
const existing = new Set(passages.map((p) => `${p.type}|${p.title}`))

let added = 0
for (const f of fragments) {
  const p = JSON.parse(readFileSync(path.join(__dirname, f), 'utf-8'))
  if (existing.has(`${p.type}|${p.title}`)) continue
  passages.push(p)
  existing.add(`${p.type}|${p.title}`)
  added++
}

writeFileSync(path.join(dataDir, 'passages.json'), JSON.stringify(passages, null, 1) + '\n')
console.log(`added ${added} passages; passages.json now has ${passages.length} entries`)
