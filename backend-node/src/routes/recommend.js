// 智能推荐:GET /api/recommend/:userId → 结合学习画像(最弱模块 + 距上次练该模块的间隔)
// 从 tips.json 挑 1 条最对症的技巧,附中文 reason(为什么推荐给你)
import { Router } from 'express'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { db, DATA_DIR } from '../db.js'
import { err, ok, utcDateStr, wordStrength } from '../helpers.js'

export const recommendRouter = Router()

// dev 每次读文件:与 content.js 一致,内容迭代后刷新即生效,无需重启
const loadTips = () => JSON.parse(readFileSync(path.join(DATA_DIR, 'tips.json'), 'utf-8'))

const MODULE_NAMES = { vocab: '词汇', grammar: '语法', listening: '听力', speaking: '口语', phonetics: '发音', reading: '阅读' }
// tips.json 的 related_modules key → 六大模块 key(galaxy/review 都归 vocab,与 TipsView 的口径一致)
const TIP_MODULE_KEYS = {
  galaxy: 'vocab', review: 'vocab', vocab: 'vocab',
  grammar: 'grammar', listening: 'listening', speaking: 'speaking',
  phonetics: 'phonetics', reading: 'reading',
}

recommendRouter.get('/recommend/:userId', async (req, res) => {
  const userId = Number(req.params.userId)
  const user = await db.get('SELECT * FROM users WHERE id = ?', userId)
  if (!user) return res.json(err(`user ${userId} not found`))

  const tips = loadTips()
  // 以"当天序号"做确定性轮换:同一天刷新结果不变,过一天自动换一条
  const daySeq = Math.floor(Date.now() / 86400000)

  // ---- 模块画像:从答题流水聚合正确率 + 最近一次练习日期 ----
  const events = await db.all('SELECT * FROM activity_events WHERE user_id = ?', userId)
  const profile = new Map()
  for (const e of events) {
    if (!profile.has(e.module)) profile.set(e.module, { correct: 0, total: 0, last: '' })
    const p = profile.get(e.module)
    p.correct += e.correct
    p.total += e.total
    if (e.date > p.last) p.last = e.date
  }

  // ---- 增强信号:最薄弱词根 + 词库快忘了词数(决定"应复习"提醒) ----
  const wordRoot = new Map((await db.all("SELECT id, root, root_meaning FROM words WHERE family <> 'general'"))
    .map((w) => [w.id, { root: w.root, meaning: w.root_meaning }]))
  const rootStats = new Map()
  for (const e of events) {
    if (e.module !== 'vocab' || e.word_id == null) continue
    const info = wordRoot.get(e.word_id); if (!info) continue
    if (!rootStats.has(info.root)) rootStats.set(info.root, { meaning: info.meaning, correct: 0, total: 0, words: new Set() })
    const r = rootStats.get(info.root)
    r.correct += e.correct; r.total += e.total; r.words.add(e.word_id)
  }
  const weakestRoots = [...rootStats.entries()]
    .filter(([, r]) => r.total > 0 && r.words.size >= 2)
    .sort((a, b) => (a[1].correct / a[1].total) - (b[1].correct / b[1].total) || b[1].words.size - a[1].words.size)
    .slice(0, 3)
    .map(([root, r]) => ({ root, meaning: r.meaning, accuracy: Math.round((r.correct / r.total) * 1000) / 1000, word_count: r.words.size }))

  // 词库快忘了:states 里有 first_learned 且 due 且 记忆概率<0.45
  // (修复:user_words 表没有 strength 列,历史版本 SELECT strength 直接抛错 → 端点永远 500)
  const now = new Date()
  const states = await db.all('SELECT * FROM user_words WHERE user_id = ?', userId)
  const critCount = states.filter((s) => s.first_learned_at != null && s.due_at && new Date(s.due_at + 'Z') <= now && (wordStrength(s, now) ?? 0) < 0.45).length
  const dueWeek = states.filter((s) => s.due_at && new Date(s.due_at + 'Z') <= new Date(now.getTime() + 7 * 86400000)).length

  // ---- 无任何答题记录:推通用方法论,降级不空手 ----
  const practiced = [...profile.entries()].filter(([, p]) => p.total > 0)
  if (!practiced.length && !critCount && !dueWeek) {
    const pool = tips.filter((t) => t.category === '学习方法')
    const tip = pool[daySeq % pool.length] || tips[0]
    return res.json(ok({
      tip,
      reason: `你还没有留下答题记录,系统暂时无法精准画像——先从这条通用方法开始,去任意模块练几题,之后的「今日一策」会越来越懂你。`,
      module: null, module_name: null, accuracy: null, gap_days: null,
      due_week: 0, critical_count: 0, weakest_roots: [],
    }))
  }

  // ---- 优先级 1:词库大量快忘了 → 推"复习"技巧 ----
  if (critCount >= 5) {
    const candidates = tips.filter((t) => t.category === '词汇记忆' || t.category === '学习方法')
    const tip = candidates.length ? candidates[daySeq % candidates.length] : tips[0]
    return res.json(ok({
      tip,
      reason: `你的「词汇」模块有 ${critCount} 个词强度跌到了 < 45%(快忘了),还有 ${dueWeek} 个词一周内到期——这条「${tip.title}」谈的就是如何在遗忘发生前把它按住,先花 2 分钟读,再去做词汇复习。`,
      module: 'vocab', module_name: '词汇',
      accuracy: null, gap_days: 0,
      due_week: dueWeek, critical_count: critCount,
      weakest_roots,
    }))
  }

  // ---- 优先级 2:最弱模块 ----
  practiced.sort((a, b) =>
    (a[1].correct / a[1].total) - (b[1].correct / b[1].total) || b[1].total - a[1].total)
  const [mod, p] = practiced[0]
  const accPct = Math.round((p.correct / p.total) * 100)

  // 距上次练该模块的天数
  const gapDays = Math.max(0, Math.round((Date.parse(utcDateStr(new Date())) - Date.parse(p.last)) / 86400000))
  const gapText = gapDays === 0 ? '今天刚练过,趁热打铁再巩固一轮' :
    gapDays >= 7 ? `而你已经有 ${gapDays} 天没碰它了,手感正在流失` :
      `距上次练它已隔 ${gapDays} 天`

  // ---- 候选技巧:related_modules 命中最弱模块的;没有再退回学习方法类 ----
  const candidates = tips.filter((t) => (t.related_modules || []).some((m) => TIP_MODULE_KEYS[m] === mod))
  const pool = candidates.length ? candidates : tips.filter((t) => t.category === '学习方法')
  const tip = pool[daySeq % pool.length]

  // 增强 reason:把最弱词根附上
  const rootHint = weakestRoots.length
    ? `尤其在「${weakestRoots[0].root}-(${weakestRoots[0].meaning})」家族(正确率 ${Math.round(weakestRoots[0].accuracy * 100)}%)弱得明显`
    : ''
  const reason = `你的「${MODULE_NAMES[mod] || mod}」模块正确率只有 ${accPct}%,是六大模块里最薄弱的一环,${rootHint};${gapText}——这条「${tip.title}」正好对症:它出自《${tip.source_book}》,先花 2 分钟读完,再去${MODULE_NAMES[mod] || mod}模块练 10 题验证效果。`

  return res.json(ok({
    tip,
    reason,
    module: mod,
    module_name: MODULE_NAMES[mod] || mod,
    accuracy: Math.round((p.correct / p.total) * 1000) / 1000,
    gap_days: gapDays,
    due_week: dueWeek,
    critical_count: critCount,
    weakest_roots: weakestRoots,
  }))
})