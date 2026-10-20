// SM-2 间隔重复引擎 + 记忆强度(星球光照)模型 —— srs.py 的 1:1 移植
//
// 评分映射(与 API 契约一致):
//   - 答错                        -> grade 1
//   - 答对但极慢 (response_ms > 10000) -> grade 3
//   - 答对但偏慢 (4000 <= response_ms <= 10000) -> grade 4
//   - 答对且快   (response_ms < 4000) -> grade 5
// SM-2 核心规则:
//   - grade >= 3(答对):repetitions+1;interval: 0 -> 1 天 -> 3 天 -> 旧 interval × ease
//   - grade <  3(答错):repetitions=0, interval=0(下次马上出现), lapses+1, ease 略降
//   - ease 按 SM-2 公式调整:EF' = EF + (0.1 - (5-q)*(0.08 + (5-q)*0.02)),下限 1.3
//
// strength(0~1 记忆强度) = 峰值强度 × 指数遗忘衰减
//   peak: repetitions/grade 决定;base = 0.65 + 0.10×min(reps,3),grade 5 +0.05 / 4 +0.02,lapse -0.05
//   half_life = max(1, interval_days) × ease / 2.5 天
//   strength = peak × 0.5^(elapsed_days / half_life)

export const FAST_MS = 4000
export const VERY_SLOW_MS = 10000
export const MIN_EASE = 1.3

export function gradeFor(correct, responseMs) {
  const ms = responseMs ?? FAST_MS
  if (!correct) return 1
  if (ms < FAST_MS) return 5
  if (ms <= VERY_SLOW_MS) return 4
  return 3
}

export function nextEase(ease, grade) {
  const q = Math.max(0, Math.min(5, grade))
  const value = ease + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02))
  return Math.round(Math.max(MIN_EASE, value) * 1000) / 1000
}

export function peakStrength(repetitions, grade, lapses) {
  const base = 0.65 + 0.10 * Math.min(repetitions, 3)
  const bonus = grade === 5 ? 0.05 : grade === 4 ? 0.02 : 0.0
  const value = base + bonus - 0.05 * lapses
  return Math.round(Math.max(0.1, Math.min(0.98, value)) * 1000) / 1000
}

export function sm2Update({ repetitions, ease, intervalDays, lapses, grade, now }) {
  // 对一次答题执行 SM-2,返回新的记忆状态
  let newReps, newInterval, newLapses
  if (grade >= 3) {
    newReps = repetitions + 1
    if (newReps === 1) newInterval = 1.0
    else if (newReps === 2) newInterval = 3.0
    else newInterval = Math.round(Math.max(intervalDays, 1.0) * ease * 100) / 100
    newLapses = lapses
  } else {
    newReps = 0
    newInterval = 0.0
    newLapses = lapses + 1
  }
  const newEase = nextEase(ease, grade)
  const peak = peakStrength(newReps, grade, newLapses)
  const dueAt = newInterval <= 0 ? new Date(now) : new Date(now.getTime() + newInterval * 86400000)
  return { repetitions: newReps, ease: newEase, intervalDays: newInterval, lapses: newLapses, peakStrength: peak, dueAt }
}

export function computeStrength({ peak, intervalDays, ease, lastReviewAt, now }) {
  // strength = peak × 0.5^(elapsed / half_life)
  const halfLifeDays = Math.max(1.0, intervalDays) * Math.max(ease, MIN_EASE) / 2.5
  const elapsedDays = (now.getTime() - lastReviewAt.getTime()) / 86400000.0
  const strength = peak * Math.pow(0.5, Math.max(0.0, elapsedDays) / halfLifeDays)
  return Math.round(Math.max(0.0, Math.min(1.0, strength)) * 1000) / 1000
}

export function stateLabel(repetitions, intervalDays, strength) {
  if (repetitions >= 3 && strength > 0.8) return 'mastered'
  if (intervalDays <= 3) return 'learning'
  return 'review'
}

// ====================================================================
// FSRS-4.5(简化移植):Difficulty / Stability / Retrievability 三量记忆模型
//
// 为什么升级(认知科学依据):
//   - SM-2 只有一个 ease 因子,反复答"难"会陷入 ease hell(间隔越压越短);
//     FSRS 的难度带均值回归,结构上免疫
//   - FSRS 输出的是"记忆概率 R"(你现在有多大把握记得),而不是模糊强度,
//     让遗忘变得可见、可讲、可画曲线 —— 3D 星球亮度和 UI 概率全部由它驱动
//   - 目标保持率(desired retention)可配:85% 省时间 / 90% 默认 / 95% 备考
//
// 等级(FSRS 惯例 1-4):
//   1 = Again(不认识/答错)  2 = Hard(模糊/慢答对)  3 = Good(正常答对)  4 = Easy(认识/秒答)
// ====================================================================

export const FSRS_DECAY = -0.5          // 幂律遗忘曲线指数(与 SM-2 指数衰减不同,幂律更贴合真实记忆数据)
export const FSRS_FACTOR = 19 / 81     // 使 R(0.9 与 S 同天衰减到 90%)的自洽系数
export const FSRS_DEFAULT_RETENTION = 0.9

// FSRS-4.5 默认参数集(17 个,取自 open-spaced-repetition 社区基准;不做逐用户拟合)
//   w0-w3  : 首次按 Again/Hard/Good/Easy 评分的初始稳定性(天)
//   w4-w5  : 初始难度 D0(G) = w4 - (G-3)*w5
//   w6-w7  : 难度更新幅度与均值回归系数
//   w8-w10 : 答对时稳定性增长
//   w11-14 : 答错时稳定性衰减(post-lapse stability)
//   w15-16 : FSRS-4.5 中留作短时记忆项,本简化版不消费
export const FSRS_W = [
  0.40255, 1.18385, 3.173, 15.69105,
  7.1949, 0.5345,
  1.4604, 0.0046,
  1.54575, 0.1192, 1.01925,
  1.9395, 0.11, 0.29605, 2.2698,
  0.2315, 2.9898,
]

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
const round3 = (v) => Math.round(v * 1000) / 1000

// 记忆概率 R:距上次复习 t 天、稳定度 S 天 → 现在还能想起来的概率(幂律衰减)
export function fsrsRetrievability({ stability, lastReviewAt, now }) {
  if (stability == null || lastReviewAt == null) return null
  const elapsedDays = Math.max(0, (now.getTime() - lastReviewAt.getTime()) / 86400000.0)
  const r = Math.pow(1 + (FSRS_FACTOR * elapsedDays) / Math.max(stability, 0.1), FSRS_DECAY)
  return round3(clamp(r, 0, 1))
}

// 首次学习:按评分给初始稳定性(Again 半天内再见到,Easy 可撑两周+)
export function fsrsInitStability(grade) {
  const g = clamp(Math.round(grade), 1, 4)
  return round3(clamp(FSRS_W[g - 1], 0.1, 365))
}

// 首次学习:按评分给初始难度(1-10,越大越难)
export function fsrsInitDifficulty(grade) {
  const g = clamp(Math.round(grade), 1, 4)
  return round3(clamp(FSRS_W[4] - (g - 3) * FSRS_W[5], 1, 10))
}

// 后续复习:难度更新(带均值回归,防 ease hell)
export function fsrsNextDifficulty(difficulty, grade) {
  const g = clamp(Math.round(grade), 1, 4)
  const d0 = difficulty == null ? FSRS_W[4] : difficulty
  const delta = -FSRS_W[6] * (g - 3)
  const d = d0 + delta + FSRS_W[7] * (FSRS_W[4] - (d0 + delta)) // 回归中心 w4
  return round3(clamp(d, 1, 10))
}

// 后续复习:稳定性更新
//   G>=2(答对,含 Hard):S' = S * (1 + e^w8*(11-D)*S^(-w9)*(e^(w10*(1-R))-1))
//   G==1(答错)        :S' = w11 * D^(-w12) * ((S+1)^w13 - 1) * e^(w14*(1-R)),且不超过原 S
export function fsrsNextStability({ stability, difficulty, grade, retrievability }) {
  const g = clamp(Math.round(grade), 1, 4)
  const D = clamp(difficulty == null ? FSRS_W[4] : difficulty, 1, 10)
  const S = Math.max(stability == null ? 0.1 : stability, 0.1)
  const R = clamp(retrievability == null ? FSRS_DEFAULT_RETENTION : retrievability, 0.02, 0.99)
  if (g >= 2) {
    const inc = Math.exp(FSRS_W[8]) * (11 - D) * Math.pow(S, -FSRS_W[9]) * (Math.exp(FSRS_W[10] * (1 - R)) - 1)
    return round3(clamp(S * (1 + Math.max(inc, 0)), 0.1, 365))
  }
  const post = FSRS_W[11] * Math.pow(D, -FSRS_W[12]) * (Math.pow(S + 1, FSRS_W[13]) - 1) * Math.exp(FSRS_W[14] * (1 - R))
  return round3(clamp(Math.min(post, S), 0.1, 365))
}

// 由稳定度与目标保持率算下次间隔:retention=0.9 时间隔 ≈ S 天(数学自洽)
export function fsrsNextInterval({ stability, desiredRetention }) {
  const r = clamp(desiredRetention == null ? FSRS_DEFAULT_RETENTION : desiredRetention, 0.7, 0.99)
  const s = Math.max(stability == null ? 0.1 : stability, 0.1)
  const days = (s / FSRS_FACTOR) * (Math.pow(r, 1 / FSRS_DECAY) - 1)
  return round3(clamp(days, 0.007, 365))
}

// 对一次评分执行完整 FSRS 调度 → 新的 {stability, difficulty, intervalDays, dueAt}
//   stability == null 表示首次(新词首见):走初始化分支
export function fsrsUpdate({ stability, difficulty, grade, lastReviewAt, desiredRetention, now }) {
  const g = clamp(Math.round(grade), 1, 4)
  const first = stability == null
  const nextD = first ? fsrsInitDifficulty(g) : fsrsNextDifficulty(difficulty, g)
  let nextS
  if (first) {
    nextS = fsrsInitStability(g)
  } else {
    const r = fsrsRetrievability({ stability, lastReviewAt, now })
    nextS = fsrsNextStability({ stability, difficulty, grade: g, retrievability: r })
  }
  const intervalDays = fsrsNextInterval({ stability: nextS, desiredRetention })
  // grade 1(不认识/Again)= 重学态:立即重排(与旧 SM-2「答错马上再见到」一致),
  // 错词当场/当天会再次出现;Hard 及以上按 FSRS 正常调度
  const dueAt = grade === 1 ? new Date(now.getTime()) : new Date(now.getTime() + intervalDays * 86400000)
  return { stability: nextS, difficulty: nextD, intervalDays: grade === 1 ? 0.0 : intervalDays, dueAt }
}

// SM-2 旧数据 → FSRS 初值映射(一次性回填用;只写新列,不动旧列,可回滚)
//   stability:间隔越大越稳;不足 3 次答对的记忆还没立住,按 0.6 折
//   difficulty:ease 越低越难,lapses 加难
export function migrateSm2ToFsrs({ ease, intervalDays, lapses, repetitions }) {
  const e = Math.max(ease == null ? 2.5 : ease, MIN_EASE)
  const i = Math.max(intervalDays == null ? 0 : intervalDays, 0.5)
  const reps = repetitions == null ? 0 : repetitions
  const laps = lapses == null ? 0 : lapses
  return {
    stability: round3(clamp(i * (reps >= 3 ? 1 : 0.6), 0.4, 365)),
    difficulty: round3(clamp(5.5 + (2.5 - e) * 2 - laps * 0.3, 1, 10)),
  }
}

// 学习舱三档自评 → FSRS 等级
//   known(认识)→ 4 Easy / fuzzy(模糊)→ 2 Hard(明天再见的档) / unknown(不认识)→ 1 Again
export function gradeForSelf(selfGrade) {
  if (selfGrade === 'known') return 4
  if (selfGrade === 'fuzzy') return 2
  if (selfGrade === 'unknown') return 1
  return null
}

// 统一评分入口:有自评优先自评(元认知比选择题更能校准);
// 否则按答题表现映射 FSRS 等级:秒答对 4 / 正常 3 / 慢答对 2 / 答错 1
export function resolveGrade({ correct, responseMs, selfGrade }) {
  const self = gradeForSelf(selfGrade)
  if (self != null) return self
  const ms = responseMs ?? FAST_MS
  if (!correct) return 1
  if (ms < FAST_MS) return 4
  if (ms <= VERY_SLOW_MS) return 3
  return 2
}
