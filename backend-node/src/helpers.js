// 共享工具:响应包络、时间格式化、UserWord -> 记忆概率/强度
import { computeStrength, fsrsRetrievability } from './srs.js'

export const ok = (data) => ({ ok: true, data })
export const err = (message) => ({ ok: false, error: message })

// UTC ISO8601(秒级精度,无 Z 后缀,与旧 Python 后端一致),null 透传
export function iso(dt) {
  if (dt == null) return null
  if (typeof dt === 'string') return dt.slice(0, 19)
  return new Date(dt).toISOString().slice(0, 19)
}

// 当前记忆概率(FSRS retrievability:现在还能想起来的概率 0-1)
// 优先走 FSRS stability;老数据(未回填)降级旧 SM-2 强度;从未学过返回 null(契约规定)
export function wordRetrievability(state, now) {
  if (state == null || state.first_learned_at == null || state.last_review_at == null) return null
  if (state.stability != null) {
    return fsrsRetrievability({ stability: state.stability, lastReviewAt: new Date(state.last_review_at + 'Z'), now })
  }
  return computeStrength({
    peak: state.peak_strength,
    intervalDays: state.interval_days,
    ease: state.ease,
    lastReviewAt: new Date(state.last_review_at + 'Z'),
    now,
  })
}

// 旧名兼容:全站(stats/recommend/queue)的"强度"概念统一升级为记忆概率
export const wordStrength = wordRetrievability

// SQLite 里存的是无 Z 的 UTC 秒级字符串,补 Z 还原成 Date
export const parseDbDate = (s) => (s == null ? null : new Date(s + 'Z'))
export const utcDateStr = (d) => d.toISOString().slice(0, 10)
