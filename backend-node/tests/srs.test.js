// srs.js 单元测试:SM-2 间隔计算与记忆强度模型的边界情况
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  gradeFor, nextEase, peakStrength, sm2Update, computeStrength, stateLabel,
  FAST_MS, VERY_SLOW_MS, MIN_EASE,
} from '../src/srs.js'

// ---- gradeFor:评分映射边界 ----
test('gradeFor:答错一律 grade 1', () => {
  assert.equal(gradeFor(false, 0), 1)
  assert.equal(gradeFor(false, 100000), 1)
})

test('gradeFor:答对按响应时间分档', () => {
  assert.equal(gradeFor(true, 1), 5)          // 快(< 4000)
  assert.equal(gradeFor(true, FAST_MS - 1), 5)
  assert.equal(gradeFor(true, FAST_MS), 4)    // 恰好 4000 属"偏慢"
  assert.equal(gradeFor(true, VERY_SLOW_MS), 4) // 恰好 10000 仍"偏慢"
  assert.equal(gradeFor(true, VERY_SLOW_MS + 1), 3) // 极慢
  assert.equal(gradeFor(true), 4)             // 缺省 response_ms 按 FAST_MS 处理
})

// ---- nextEase:SM-2 EF 公式与下限 ----
test('nextEase:标准公式', () => {
  assert.equal(nextEase(2.5, 5), 2.6) // q=5:+0.1
  assert.equal(nextEase(2.5, 4), 2.5) // q=4:+0.1-(0.08+0.02)=0
  assert.equal(nextEase(2.5, 3), 2.36) // q=3:+0.1-2*(0.08+2*0.02)
  assert.equal(nextEase(2.5, 1), 1.96) // q=1:+0.1-4*(0.08+4*0.02)
})

test('nextEase:ease 下限 1.3、grade 越界收敛', () => {
  assert.equal(nextEase(1.35, 1), MIN_EASE) // 公式值 0.81 → 钳到 1.3
  assert.equal(nextEase(2.5, 99), nextEase(2.5, 5)) // 越界按 5 处理
  assert.equal(nextEase(2.5, -3), nextEase(2.5, 0))
})

// ---- peakStrength:强度峰值边界 ----
test('peakStrength:基础分 + 档位加成 - 遗忘惩罚', () => {
  assert.equal(peakStrength(0, 5, 0), 0.7) // 0.65 + 0.05
  assert.equal(peakStrength(0, 4, 0), 0.67) // 0.65 + 0.02
  assert.equal(peakStrength(0, 3, 0), 0.65) // 无加成
  assert.equal(peakStrength(2, 4, 1), 0.82) // 0.85 + 0.02 - 0.05
})

test('peakStrength:repetitions 封顶 3、结果钳制 [0.1, 0.98]', () => {
  assert.equal(peakStrength(10, 5, 0), 0.98) // 1.0 → 上限 0.98
  assert.equal(peakStrength(0, 1, 20), 0.1)  // 负值 → 下限 0.1
  assert.equal(peakStrength(3, 5, 0), peakStrength(99, 5, 0))
})

// ---- sm2Update:间隔序列与答错重置 ----
test('sm2Update:连续答对 0 → 1 天 → 3 天 → 旧间隔 × ease', () => {
  const now = new Date('2026-01-01T00:00:00Z')
  const first = sm2Update({ repetitions: 0, ease: 2.5, intervalDays: 0, lapses: 0, grade: 5, now })
  assert.equal(first.repetitions, 1)
  assert.equal(first.intervalDays, 1.0)
  assert.equal(first.ease, 2.6)
  assert.equal(first.peakStrength, 0.8)
  assert.equal(first.dueAt.getTime(), now.getTime() + 1 * 86400000)

  const second = sm2Update({ ...first, intervalDays: first.intervalDays, grade: 5, now })
  assert.equal(second.repetitions, 2)
  assert.equal(second.intervalDays, 3.0)

  const third = sm2Update({ ...second, intervalDays: second.intervalDays, grade: 5, now })
  assert.equal(third.repetitions, 3)
  assert.equal(third.intervalDays, Math.round(3.0 * second.ease * 100) / 100) // 旧 interval × ease
})

test('sm2Update:答错重置计数、间隔归零、立即到期', () => {
  const now = new Date('2026-01-01T00:00:00Z')
  const r = sm2Update({ repetitions: 5, ease: 2.5, intervalDays: 30, lapses: 2, grade: 1, now })
  assert.equal(r.repetitions, 0)
  assert.equal(r.intervalDays, 0)
  assert.equal(r.lapses, 3)
  assert.equal(r.ease, 1.96)
  assert.equal(r.dueAt.getTime(), now.getTime()) // 间隔 0 → 马上复习
  assert.equal(r.peakStrength, 0.5) // peakStrength(0,1,3) = 0.65 - 0.05×3
})

// ---- computeStrength:指数遗忘衰减 ----
test('computeStrength:刚复习完等于峰值、半衰期处减半', () => {
  const now = new Date('2026-01-10T00:00:00Z')
  assert.equal(computeStrength({ peak: 0.8, intervalDays: 1, ease: 2.5, lastReviewAt: now, now }), 0.8)
  // half_life = 1 × 2.5 / 2.5 = 1 天,过了 1 天 → 0.8 × 0.5
  const after1d = new Date(now.getTime() + 86400000)
  assert.equal(computeStrength({ peak: 0.8, intervalDays: 1, ease: 2.5, lastReviewAt: now, now: after1d }), 0.4)
})

test('computeStrength:长期遗忘趋近 0、结果钳制 [0,1]', () => {
  const now = new Date('2026-01-10T00:00:00Z')
  const far = new Date(now.getTime() + 100 * 86400000)
  const s = computeStrength({ peak: 0.9, intervalDays: 1, ease: 2.5, lastReviewAt: now, now: far })
  assert.ok(s >= 0 && s < 0.001)
  // 未来时间(时钟偏差)钳为 0 天 → 不放大
  assert.equal(computeStrength({ peak: 0.8, intervalDays: 1, ease: 2.5, lastReviewAt: far, now }), 0.8)
  // 结果上限 1
  assert.ok(computeStrength({ peak: 1.5, intervalDays: 1, ease: 2.5, lastReviewAt: now, now }) <= 1)
})

// ---- stateLabel:阶段判定边界 ----
test('stateLabel:mastered / learning / review', () => {
  assert.equal(stateLabel(3, 10, 0.81), 'mastered')
  assert.equal(stateLabel(3, 10, 0.8), 'review')   // 恰好 0.8 不算掌握(需 > 0.8)
  assert.equal(stateLabel(0, 0, 0), 'learning')     // 新词
  assert.equal(stateLabel(2, 3, 0.5), 'learning')   // 间隔 ≤ 3 天仍在学
  assert.equal(stateLabel(2, 10, 0.5), 'review')
})

// ====================================================================
// FSRS-4.5(简化移植):记忆概率 / 调度 / 迁移 / 自评映射
// ====================================================================
import {
  fsrsRetrievability, fsrsInitStability, fsrsInitDifficulty, fsrsNextDifficulty,
  fsrsNextStability, fsrsNextInterval, fsrsUpdate, migrateSm2ToFsrs,
  gradeForSelf, resolveGrade, FSRS_W, FSRS_DEFAULT_RETENTION,
} from '../src/srs.js'

// ---- fsrsRetrievability:幂律遗忘 ----
test('fsrsRetrievability:刚复习 R=1、随时间单调下降、无状态返回 null', () => {
  const now = new Date('2026-01-10T00:00:00Z')
  assert.equal(fsrsRetrievability({ stability: 3, lastReviewAt: now, now }), 1)
  const d1 = fsrsRetrievability({ stability: 3, lastReviewAt: now, now: new Date(now.getTime() + 86400000) })
  const d3 = fsrsRetrievability({ stability: 3, lastReviewAt: now, now: new Date(now.getTime() + 3 * 86400000) })
  assert.ok(d1 < 1 && d1 > d3)
  assert.equal(fsrsRetrievability({ stability: null, lastReviewAt: now, now }), null)
  assert.equal(fsrsRetrievability({ stability: 3, lastReviewAt: null, now }), null)
})

test('fsrsRetrievability:稳定度越大忘得越慢', () => {
  const now = new Date('2026-01-10T00:00:00Z')
  const later = new Date(now.getTime() + 7 * 86400000)
  const rSmall = fsrsRetrievability({ stability: 1, lastReviewAt: now, now: later })
  const rBig = fsrsRetrievability({ stability: 20, lastReviewAt: now, now: later })
  assert.ok(rBig > rSmall)
})

// ---- fsrsUpdate:首评初始化与方向正确性 ----
test('fsrsUpdate:首评按等级初始化,认识撑得久、不认识马上再见', () => {
  const now = new Date('2026-01-10T00:00:00Z')
  const known = fsrsUpdate({ stability: null, difficulty: null, grade: 4, desiredRetention: 0.9, now })
  const fuzzy = fsrsUpdate({ stability: null, difficulty: null, grade: 2, desiredRetention: 0.9, now })
  const unknown = fsrsUpdate({ stability: null, difficulty: null, grade: 1, desiredRetention: 0.9, now })
  assert.ok(known.stability > fuzzy.stability && fuzzy.stability > unknown.stability)
  assert.ok(unknown.intervalDays < 1 && fuzzy.intervalDays < 3 && known.intervalDays > 5)
  assert.ok(known.difficulty < fuzzy.difficulty && fuzzy.difficulty < unknown.difficulty)
})

test('fsrsUpdate:复习后答对稳定性上升、答错下降且不超过原值', () => {
  const now = new Date('2026-01-10T00:00:00Z')
  const last = new Date(now.getTime() - 86400000) // 一天前复习的
  const good = fsrsUpdate({ stability: 3, difficulty: 6, grade: 3, lastReviewAt: last, desiredRetention: 0.9, now })
  const fail = fsrsUpdate({ stability: 3, difficulty: 6, grade: 1, lastReviewAt: last, desiredRetention: 0.9, now })
  assert.ok(good.stability > 3)
  assert.ok(fail.stability < 3)
})

test('fsrsUpdate:目标保持率越高,下次间隔越近', () => {
  const now = new Date('2026-01-10T00:00:00Z')
  const relaxed = fsrsUpdate({ stability: null, difficulty: null, grade: 3, desiredRetention: 0.8, now })
  const strict = fsrsUpdate({ stability: null, difficulty: null, grade: 3, desiredRetention: 0.95, now })
  assert.ok(strict.intervalDays < relaxed.intervalDays)
})

// ---- fsrsNextInterval / fsrsNextStability 边界 ----
test('fsrsNextInterval:retention=0.9 时间隔约等于稳定度天数(数学自洽)', () => {
  assert.ok(Math.abs(fsrsNextInterval({ stability: 10, desiredRetention: 0.9 }) - 10) < 0.01)
  assert.ok(Math.abs(fsrsNextInterval({ stability: 3.173, desiredRetention: 0.9 }) - 3.173) < 0.01)
  // retention 提高会提前复习
  assert.ok(fsrsNextInterval({ stability: 10, desiredRetention: 0.95 }) < 10)
})

test('fsrsNextStability:稳定性钳制 [0.1, 365]、答错必降', () => {
  const fail = fsrsNextStability({ stability: 300, difficulty: 10, grade: 1, retrievability: 0.9 })
  assert.ok(fail <= 300)
  const grow = fsrsNextStability({ stability: 300, difficulty: 1, grade: 4, retrievability: 0.02 })
  assert.ok(grow <= 365)
  assert.ok(fsrsNextStability({ stability: 0.05, difficulty: 5, grade: 3, retrievability: 0.9 }) >= 0.1)
})

test('fsrsNextDifficulty:范围 [1,10],反复答不认识也不会爆炸(均值回归)', () => {
  let d = fsrsInitDifficulty(3)
  for (let i = 0; i < 50; i++) d = fsrsNextDifficulty(d, 1)
  assert.ok(d <= 10 && d >= 1)
  let d2 = fsrsInitDifficulty(3)
  for (let i = 0; i < 50; i++) d2 = fsrsNextDifficulty(d2, 4)
  assert.ok(d2 >= 1 && d2 <= 10)
})

// ---- migrateSm2ToFsrs:旧数据回填 ----
test('migrateSm2ToFsrs:间隔大更稳、lapses 更难、字段缺失有默认', () => {
  const strong = migrateSm2ToFsrs({ ease: 2.5, intervalDays: 30, lapses: 0, repetitions: 5 })
  const weak = migrateSm2ToFsrs({ ease: 1.5, intervalDays: 1, lapses: 4, repetitions: 1 })
  assert.ok(strong.stability > weak.stability)
  assert.ok(weak.difficulty > strong.difficulty)
  // reps<3 的旧记忆打 0.6 折
  const short = migrateSm2ToFsrs({ ease: 2.5, intervalDays: 10, lapses: 0, repetitions: 1 })
  assert.ok(Math.abs(short.stability - 10 * 0.6) < 0.01)
})

// ---- 自评映射与统一评分 ----
test('gradeForSelf:认识/模糊/不认识 → 4/2/1,非法值 null', () => {
  assert.equal(gradeForSelf('known'), 4)
  assert.equal(gradeForSelf('fuzzy'), 2)
  assert.equal(gradeForSelf('unknown'), 1)
  assert.equal(gradeForSelf('whatever'), null)
})

test('resolveGrade:自评优先于答题表现;无自评按速度分档', () => {
  assert.equal(resolveGrade({ correct: false, responseMs: 500, selfGrade: 'known' }), 4)
  assert.equal(resolveGrade({ correct: true, responseMs: 100, selfGrade: 'unknown' }), 1)
  assert.equal(resolveGrade({ correct: true, responseMs: 1000 }), 4)   // 秒答对
  assert.equal(resolveGrade({ correct: true, responseMs: 6000 }), 3)   // 正常
  assert.equal(resolveGrade({ correct: true, responseMs: 20000 }), 2) // 慢答对=Hard
  assert.equal(resolveGrade({ correct: false, responseMs: 1000 }), 1)
})

test('FSRS_W:默认参数集完整(17 个)且初始稳定性有序', () => {
  assert.equal(FSRS_W.length, 17)
  assert.ok(FSRS_W[0] < FSRS_W[1] && FSRS_W[1] < FSRS_W[2] && FSRS_W[2] < FSRS_W[3])
  assert.equal(FSRS_DEFAULT_RETENTION, 0.9)
})
