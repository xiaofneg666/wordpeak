// SRS 记忆五态统一分类（全站唯一真源）
//   new       未学（is_new；state 缺失也按未学）
//   critical  到期且强度 < 0.45 —— 快忘了，红色求救光
//   due       到期待复习
//   mastered  强度 > 0.75 —— 稳稳记住
//   learning  学过但还没稳
// 此前同一条规则在 Dashboard/Learn/Family/Collections 各写一份，阈值靠手工对齐，
// 改一处必漏三处（Collections 还自造了一份 due_at 重算，语义等价却多一处实现）。
// 新视图一律 import 这里，别再复制分支表。
export const STRENGTH_LEARN = 0.45   // 低于此档 = 告急/褪色
export const STRENGTH_MASTER = 0.75 // 高于此档 = 掌握

export function classifyWordState(s) {
  if (!s || s.is_new) return 'new'
  if (s.due && (s.strength ?? 0) < STRENGTH_LEARN) return 'critical'
  if (s.due) return 'due'
  if ((s.strength ?? 0) > STRENGTH_MASTER) return 'mastered'
  return 'learning'
}

// 各视图通用的展示元数据（cls 与 label；颜色 chip 类名）
export const WORD_STATE_META = {
  new:      { label: '还没学', color: 'dim' },
  critical: { label: '快忘了', color: 'red' },
  due:      { label: '待复习', color: 'amber' },
  mastered: { label: '已掌握', color: 'green' },
  learning: { label: '学习中', color: 'cyan' },
}
