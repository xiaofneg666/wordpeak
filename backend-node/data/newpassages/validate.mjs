// 校验 data/newpassages/p1-p8.json：JSON 可解析、字段结构与现有条目一致、词数 500-1000、题目 3-5 道
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dir = path.join(__dirname)
const files = readdirSync(dir).filter((f) => /^p[1-8]\.json$/.test(f)).sort()

const newTitles = new Set()
let fail = 0

console.log('title | level | words | sentences | questions | check')
console.log('--- | --- | --- | --- | --- | ---')
for (const f of files) {
  const errs = []
  let p
  try {
    p = JSON.parse(readFileSync(path.join(dir, f), 'utf-8'))
  } catch (e) {
    console.log(`${f} | JSON PARSE FAIL: ${e.message}`)
    fail++
    continue
  }
  // 字段结构与现有条目一致：title/level/type/sentences/questions（id 由 DB 自增，不写）
  if (typeof p.title !== 'string' || !p.title) errs.push('title missing/not string')
  if (![1, 2, 3].includes(p.level)) errs.push('level invalid')
  if (p.type !== 'reading') errs.push('type != reading')
  if (!Array.isArray(p.sentences) || p.sentences.length === 0) errs.push('sentences missing')
  else {
    for (const [i, s] of p.sentences.entries()) {
      if (typeof s.en !== 'string' || !s.en) errs.push(`sentences[${i}].en bad`)
      if (typeof s.zh !== 'string' || !s.zh) errs.push(`sentences[${i}].zh bad`)
    }
  }
  if (!Array.isArray(p.questions) || p.questions.length < 3 || p.questions.length > 5) errs.push('questions count not 3-5')
  else {
    for (const [i, q] of p.questions.entries()) {
      if (typeof q.q !== 'string' || !q.q) errs.push(`questions[${i}].q bad`)
      if (!Array.isArray(q.options) || q.options.length !== 4) errs.push(`questions[${i}].options not 4`)
      if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer >= q.options.length) errs.push(`questions[${i}].answer out of range`)
      if (typeof q.explain !== 'string' || !q.explain) errs.push(`questions[${i}].explain bad`)
    }
  }
  const words = p.sentences.reduce((n, s) => n + s.en.trim().split(/\s+/).filter(Boolean).length, 0)
  if (words < 500 || words > 1000) errs.push(`word count ${words} out of 500-1000`)
  if (newTitles.has(p.title)) errs.push('duplicate title')
  newTitles.add(p.title)

  const status = errs.length ? 'FAIL: ' + errs.join('; ') : 'OK'
  if (errs.length) fail++
  console.log(`${p.title} | ${p.level} | ${words} | ${p.sentences.length} | ${p.questions.length} | ${status}`)
}

// 与现有 passages.json 全量合并校验 + 与既有条目标题查重
try {
  const all = JSON.parse(readFileSync(path.join(dir, '..', 'passages.json'), 'utf-8'))
  console.log(`\npassages.json parses OK: ${all.length} entries total`)
  const dup = all.map((x) => `${x.type}|${x.title}`).filter((v, i, a) => a.indexOf(v) !== i)
  console.log(dup.length ? `DUPLICATE type|title: ${dup}` : 'no duplicate type|title entries')
} catch (e) {
  console.log(`passages.json PARSE FAIL: ${e.message}`)
  fail++
}

console.log(fail === 0 ? '\nALL CHECKS PASSED' : `\n${fail} FILE(S) FAILED`)
process.exit(fail === 0 ? 0 : 1)
