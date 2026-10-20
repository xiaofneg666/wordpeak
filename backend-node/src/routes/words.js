// 词汇星系:GET /api/words、GET /api/roots、GET /api/words/state/:uid、GET /api/words/network
import { Router } from 'express'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { db, DATA_DIR, J } from '../db.js'
import { err, ok, iso, wordRetrievability } from '../helpers.js'

export const wordsRouter = Router()

const ROOT_STORIES = JSON.parse(
  readFileSync(path.join(DATA_DIR, 'root_stories.json'), 'utf-8'))

function rootStory(root, meaning) {
  const origin = ROOT_STORIES[root]
  // 三段式:{ story, branches, confuse };老格式是纯字符串,降级只当 story
  const entry = typeof origin === 'string' ? { story: origin } : origin
  if (entry) return entry
  return { story: `词根 ${root}（${meaning}）家族：记住了词根义，一串单词都能猜个八九不离十。` }
}

wordsRouter.get('/words', async (req, res) => {
  // 星系只取 40 词根词;五源全量扩展词(family='general')走 /lexicon,避免 3.6 万节点压垮力导向
  const rows = await db.all("SELECT * FROM words WHERE family <> 'general' ORDER BY id")
  return res.json(ok(rows.map((w) => ({
    id: w.id,
    word: w.word,
    ipa: w.ipa,
    pos: w.pos,
    meaning: w.meaning,
    root: w.root,
    root_meaning: w.root_meaning,
    etymology: w.etymology,
    mnemonic: w.mnemonic ?? null,
    collocations: J.parse(w.collocations),
    examples: J.parse(w.examples),
    family: w.family,
    level: w.level,
  }))))
})

// 全量词库检索:只查 family='general' 的扩展词;q 同时匹配英文词形与中文释义
wordsRouter.get('/lexicon', async (req, res) => {
  const q = String(req.query.q || '').trim()
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1)
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(req.query.pageSize, 10) || 30))
  const where = q
    ? "family = 'general' AND (LOWER(word) LIKE LOWER(?) OR meaning LIKE ?)"
    : "family = 'general'"
  const params = q ? [`%${q}%`, `%${q}%`] : []
  const total = (await db.get(`SELECT COUNT(*) AS n FROM words WHERE ${where}`, ...params)).n
  const rows = await db.all(
    `SELECT * FROM words WHERE ${where} ORDER BY word LIMIT ? OFFSET ?`,
    ...params, pageSize, (page - 1) * pageSize)
  return res.json(ok({
    total, page, pageSize,
    items: rows.map((w) => ({
      id: w.id, word: w.word, ipa: w.ipa, pos: w.pos, meaning: w.meaning,
      collocations: J.parse(w.collocations), examples: J.parse(w.examples),
      family: w.family, level: w.level,
    })),
  }))
})

wordsRouter.get('/roots', async (req, res) => {
  const rows = await db.all("SELECT root, root_meaning, word FROM words WHERE family <> 'general'")
  const grouped = new Map()
  for (const w of rows) {
    if (!grouped.has(w.root)) grouped.set(w.root, { meaning: w.root_meaning, words: [] })
    grouped.get(w.root).words.push(w.word)
  }
  const roots = [...grouped.entries()]
    .sort((a, b) => b[1].words.length - a[1].words.length || a[0].localeCompare(b[0]))
    .map(([root, g]) => ({
      root,
      meaning: g.meaning,
      ...rootStory(root, g.meaning),
      word_count: g.words.length,
    }))
  return res.json(ok(roots))
})

// ---- 词汇网络(共现图谱 + 词际关系)----
// 节点 461 个 + 跨族共现边(同族不算边——同族靠 family 弹簧自然成团,画边会糊成团块)。
// 例句共现的"语义"是朴素的:一句英文里同时出现两个词 → 它们在语料层面就该相邻。
// 60s 进程内 cache:词库静态(共现边)60s 才重算;用户态(R)实时注入,只改节点字段、不动布局。
// 阈值 weight>=2:过滤掉"碰巧同句"的弱共现("a"/"the"这种通用词不算—— lemma 还原后也不太会命中)。
// 词际关系(syn/ant/co)来自 data/relations.json(60s cache),作为 type-tagged 边注入网络,
// 前端 ForceGraph 按 type 给边换颜色(同义金虚线/反义暖琥珀虚线/共现灰实线)。
const NETWORK_CACHE_TTL = 60_000
const networkCache = { at: 0, payload: null }
const relationsCache = { at: 0, map: null }
function loadRelations() {
  const now = Date.now()
  if (relationsCache.map && now - relationsCache.at < NETWORK_CACHE_TTL) return relationsCache.map
  const out = new Map() // word(lc) -> [{ type, target }]
  try {
    const raw = JSON.parse(readFileSync(path.join(DATA_DIR, 'relations.json'), 'utf8'))
    for (const r of raw) {
      if (!r || !r.a || !r.b) continue
      if (!out.has(r.a)) out.set(r.a, [])
      if (!out.has(r.b)) out.set(r.b, [])
      out.get(r.a).push({ type: r.type, target: r.b })
      out.get(r.b).push({ type: r.type, target: r.a })
    }
  } catch { /* 文件缺失静默 — 网络图只显示共现边 */ }
  // 用解构赋值替换字段(原 const 不可重新赋值,改用 Object.assign 改写键)
  Object.assign(relationsCache, { at: now, map: out })
  return out
}

function lemma(t) {
  return String(t).toLowerCase().replace(/[^a-z']/g, '').replace(/(iness|fully|edness|ously|ing|edly|ies|ied|es|ed|er|est|ly|s|ness|ment|tion|ous|ful|less)$/i, '')
}
function tokenize(s) { return String(s).split(/[^A-Za-z']+/).filter(Boolean) }

async function buildNetworkBase() {
  // 跨族共现:文档级(passages)粒度。
  //   词库(461 词)和语料库(36 篇 passages)的句子级跨族 token 共现太稀(0 对);
  //   改为**文档级**共现:同一 passages 出现两个跨族词 = 共现 1 次;
  //   多次出现于多篇 = 累加。weight 是更稳定的"语义邻居"信号。
  //   同族不画边(弹簧天然成团;画边会糊成团块)。
  // 必须从 db 读(带 id 字段),words.json 文件本身没 id。
  const dbWords = await db.all("SELECT id, word, root, meaning, mnemonic, ipa, level FROM words WHERE family <> 'general'")
  const byId = new Map(dbWords.map((w) => [w.id, w]))
  const byLemma = new Map()
  for (const w of dbWords) {
    const l = lemma(w.word)
    if (l && !byLemma.has(l)) byLemma.set(l, w)
  }
  let passages = []
  try { passages = JSON.parse(readFileSync(path.join(DATA_DIR, 'passages.json'), 'utf8')) } catch { /* passages 缺失时退化为空 */ }
  const co = new Map()
  for (const p of passages) {
    const ids = new Set()
    for (const s of p.sentences || []) {
      for (const tk of tokenize(s.en || '')) {
        const m = byLemma.get(lemma(tk))
        if (m) ids.add(m.id)
      }
    }
    const arr = [...ids]
    for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j++) {
      const a = byId.get(arr[i]), b = byId.get(arr[j])
      if (!a || !b || a.root === b.root) continue
      const k = Math.min(arr[i], arr[j]) + ':' + Math.max(arr[i], arr[j])
      co.set(k, (co.get(k) || 0) + 1)
    }
  }
  const edges = []
  for (const [key, w] of co) {
    if (w < 2) continue
    const [a, b] = key.split(':').map(Number)
    const wa = byId.get(a), wb = byId.get(b)
    if (!wa || !wb) continue
    edges.push({ source: a, target: b, weight: w, source_root: wa.root, target_root: wb.root })
  }
  // 关系边注入后一并参与 sort(关系边 weight=10 强过 co-occurrence 通常 ≤6)
  const relMap = loadRelations()
  for (const w of dbWords) {
    const rels = relMap.get(w.word.toLowerCase()) || []
    for (const r of rels) {
      const tw = byLemma.get(r.target.toLowerCase()) || byLemma.get(r.target)
      if (!tw || tw.id === w.id) continue
      if (w.root === tw.root) continue
      edges.push({
        source: w.id, target: tw.id, weight: 10,
        type: r.type, source_root: w.root, target_root: tw.root,
      })
    }
  }
  edges.sort((x, y) => y.weight - x.weight)
  const roots = [...new Set(dbWords.map((w) => w.root))]
  return { edges, roots, words: dbWords }
}

wordsRouter.get('/words/network', async (req, res) => {
  const now = Date.now()
  const userId = Number(req.query.user_id) || 0
  // 边/词表 cache(60s)
  let base = networkCache.payload
  if (!base || now - networkCache.at > NETWORK_CACHE_TTL) {
    base = await buildNetworkBase()
    networkCache.payload = base
    networkCache.at = now
  }
  // 节点:从 base.words 派生,retrievability 来自该用户 user_words(未学=null)
  const states = userId
    ? new Map((await db.all('SELECT * FROM user_words WHERE user_id = ?', userId)).map((s) => [s.word_id, s]))
    : new Map()
  const nowDt = new Date()
  const nodes = base.words.map((w) => {
    const st = states.get(w.id)
    return {
      id: w.id, word: w.word, root: w.root, family: w.root, level: w.level,
      meaning: w.meaning, mnemonic: w.mnemonic ?? null, ipa: w.ipa,
      retrievability: st ? wordRetrievability(st, nowDt) : null,
    }
  })
  return res.json(ok({
    nodes, edges: base.edges,
    meta: {
      totalNodes: nodes.length, totalEdges: base.edges.length,
      familyCount: base.roots.length, computedAt: new Date(networkCache.at).toISOString(),
    },
  }))
})

wordsRouter.get('/words/state/:userId', async (req, res) => {
  const userId = Number(req.params.userId)
  const user = await db.get('SELECT * FROM users WHERE id = ?', userId)
  if (!user) return res.json(err(`user ${userId} not found`))
  const now = new Date()
  const states = await db.all('SELECT * FROM user_words WHERE user_id = ? ORDER BY word_id', userId)
  return res.json(ok(states.map((s) => ({
    word_id: s.word_id,
    strength: wordRetrievability(s, now),
    retrievability: wordRetrievability(s, now),
    due: s.due_at != null && new Date(s.due_at + 'Z') <= now,
    due_at: iso(s.due_at),
    repetitions: s.repetitions,
    lapses: s.lapses,
    is_new: s.first_learned_at == null,
    first_learned_at: iso(s.first_learned_at), // DailyQuests/今日航线判"今天学的词"用
  }))))
})

// 阅读号列车"标记生词":新建 user_word,立即进入复习队列
wordsRouter.post('/words/learn', async (req, res) => {
  const { user_id: userId, word_id: wordId } = req.body ?? {}
  const user = await db.get('SELECT * FROM users WHERE id = ?', userId)
  if (!user) return res.json(err(`user ${userId} not found`))
  const word = await db.get('SELECT * FROM words WHERE id = ?', wordId)
  if (!word) return res.json(err(`word ${wordId} not found`))
  const exist = await db.get('SELECT * FROM user_words WHERE user_id = ? AND word_id = ?', userId, wordId)
  if (exist) return res.json(ok({ ok: true, already: true }))
  const now = new Date()
  // 标记为生词后,首次出现于立即复习队列(due_at=now),强度给个起点值
  await db.run(`INSERT INTO user_words (user_id, word_id, repetitions, ease, interval_days, lapses, peak_strength, first_learned_at, last_review_at, due_at)
          VALUES (?, ?, 0, 2.5, 0, 0, 0.5, ?, ?, ?)`,
    userId, wordId, iso(now), iso(now), iso(now))
  return res.json(ok({ ok: true, already: false }))
})