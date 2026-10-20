// 今日航线:GET /api/plan/:userId → 结合用户档案(goal/self_level)+ 到期复习量 + 最弱模块,
// 产出一份 15~25 分钟的当日学习计划(学几个新词 / 复习几个 / 补哪个弱项)。
// 设计依据:每日 10-25 分钟短 session 优于长突击(Cepeda et al. 分布练习元分析);
// 新词量随目标与自评水平伸缩;复习量由 FSRS due 队列决定;弱项从答题流水聚合。
import { Router } from 'express'
import { db } from '../db.js'
import { err, ok, utcDateStr } from '../helpers.js'

export const planRouter = Router()

// goal → 每日新词基表(考试要量,兴趣随缘);self_level → 基表加成(底子好吸收快)
const GOAL_BASE_NEW = { exam: 8, study: 6, work: 5, interest: 3 }
const LEVEL_BONUS = { beginner: 0, intermediate: 1, advanced: 2 }
const MODULE_NAMES = { vocab: '词汇', grammar: '语法', listening: '听力', speaking: '口语', phonetics: '发音', reading: '阅读', writing: '写作' }
// 模块 key → 前端视图 key(点节点深链用)
const MODULE_VIEWS = { vocab: 'galaxy', grammar: 'grammar', listening: 'listening', speaking: 'speaking', phonetics: 'phonetics', reading: 'reading', writing: 'writing' }

const MIN_NEW = 3        // 再忙也保底 3 个新词
const MAX_REVIEW = 15    // 复习队列单日封顶,避免堆积日压垮节奏
const MIN_PER_NEW = 1.5  // 学习舱三幕流一个新词约 1.5 分钟
const MIN_PER_REVIEW = 0.5
const MAX_TOTAL_MIN = 25 // 每日总时长上限(短 session 原则)
const FOCUS_MIN = 8      // 弱项加练

planRouter.get('/plan/:userId', async (req, res) => {
  const userId = Number(req.params.userId)
  const user = await db.get('SELECT * FROM users WHERE id = ?', userId)
  if (!user) return res.json(err(`user ${userId} not found`))

  const now = new Date()

  // ---- 复习量:FSRS 到期词(与 review queue 同口径) ----
  const states = await db.all('SELECT * FROM user_words WHERE user_id = ?', userId)
  const dueCount = states.filter((s) => s.due_at != null && new Date(s.due_at + 'Z') <= now).length
  const reviewCount = Math.min(dueCount, MAX_REVIEW)

  // ---- 新词量:档案第一次真正参与排程 ----
  const baseNew = GOAL_BASE_NEW[user.goal] ?? 5
  const bonus = LEVEL_BONUS[user.self_level] ?? 0
  let newCount = Math.max(MIN_NEW, baseNew + bonus)

  // ---- 弱项:从答题流水聚合正确率,取最弱的非词汇模块(词汇弱项由复习节点覆盖) ----
  const events = await db.all('SELECT * FROM activity_events WHERE user_id = ?', userId)
  const profile = new Map()
  for (const e of events) {
    if (!profile.has(e.module)) profile.set(e.module, { correct: 0, total: 0 })
    const p = profile.get(e.module)
    p.correct += e.correct
    p.total += e.total
  }
  const practiced = [...profile.entries()].filter(([, p]) => p.total > 0 && p.correct / p.total < 0.85)
  const weakest = practiced
    .filter(([m]) => m !== 'vocab')
    .sort((a, b) => (a[1].correct / a[1].total) - (b[1].correct / b[1].total) || b[1].total - a[1].total)[0]
  const focus = weakest
    ? {
      module: weakest[0],
      name: MODULE_NAMES[weakest[0]] || weakest[0],
      minutes: FOCUS_MIN,
      accuracy: Math.round((weakest[1].correct / weakest[1].total) * 1000) / 1000,
      view: MODULE_VIEWS[weakest[0]] || null,
      reason: `你的「${MODULE_NAMES[weakest[0]] || weakest[0]}」正确率 ${Math.round((weakest[1].correct / weakest[1].total) * 100)}%,是练习过的模块里最薄弱的一环,今天花 ${FOCUS_MIN} 分钟补一补`,
    }
    : null

  // ---- 总时长钳制:超 25 分钟先砍新词(复习和弱项不能砍),新词保底 3 ----
  const totalMin = (n) => n * MIN_PER_NEW + reviewCount * MIN_PER_REVIEW + (focus ? FOCUS_MIN : 0)
  while (newCount > MIN_NEW && totalMin(newCount) > MAX_TOTAL_MIN) newCount--
  newCount = Math.min(newCount, Math.max(MIN_NEW, Math.floor((MAX_TOTAL_MIN - reviewCount * MIN_PER_REVIEW - (focus ? FOCUS_MIN : 0)) / MIN_PER_NEW)))

  // ---- 新词选词:未学过的按难度与 id 先易后难(与 review queue 补位同源) ----
  const learnedIds = new Set(states.map((s) => s.word_id))
  const candidates = await db.all("SELECT id FROM words WHERE family <> 'general' ORDER BY level, id")
  const wordIds = candidates.filter((w) => !learnedIds.has(w.id)).slice(0, newCount).map((w) => w.id)

  // ---- 睡前提示:本地 21 点后,复习效率借睡眠巩固提升(记忆巩固研究:+20~30%) ----
  const hour = now.getHours()
  const sleepHint = hour >= 21 || hour < 5

  return res.json(ok({
    date: utcDateStr(now),
    goal: user.goal ?? null,
    self_level: user.self_level ?? null,
    total_minutes: Math.round(totalMin(wordIds.length)),
    new_words: { count: wordIds.length, word_ids: wordIds, minutes: Math.round(wordIds.length * MIN_PER_NEW) },
    reviews: { count: reviewCount, due_total: dueCount, minutes: Math.round(reviewCount * MIN_PER_REVIEW) },
    focus,
    sleep_hint: sleepHint,
  }))
})
