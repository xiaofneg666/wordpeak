<script setup>
// 每日任务 + 成就墙
// 数据源全在 store.stats / 收藏夹 / writing_results(最近一次)/ store.states 中读,不增加数据库列
// 完成度递增持久化到 localStorage(wv_quests_<date>.stars),成就解锁存 wv_achievements
import { computed, watch } from 'vue'
import { useUniverse } from '../stores/universe'
import { message } from '../ui'
import AppGlyph from './AppGlyph.vue'

const store = useUniverse()
const today = () => new Date().toLocaleDateString('sv')

// 任务定义:check 走 store.stats.by_module_today + 收藏夹/写作/新学词
// 目标个性化:有今日航线(store.plan)时,新词/复习目标跟档案驱动的计划走,
// plan.focus 命中的模块标「今日重点」;后端不可达时全部回退固定值(不空卡)
const BASE_TASKS = [
  { key: 'learn-new',  icon: 'learn',   label: '学 3 个新词',   type: 'wordsNew', target: 3 },
  { key: 'review',     icon: 'review',  label: '复习 5 个旧词',  type: 'review', target: 5 },
  { key: 'listening',  icon: 'listening', label: '听力 1 篇',   type: 'module', mod: 'listening', target: 1 },
  { key: 'speaking',   icon: 'speaking',  label: '口语 5 句',   type: 'module', mod: 'speaking', target: 5 },
  { key: 'reading',    icon: 'reading',   label: '阅读 1 篇',   type: 'module', mod: 'reading', target: 1 },
  { key: 'writing',    icon: 'writing',   label: '写 1 篇短文',  type: 'writing', target: 1 },
  { key: 'pronounce',  icon: 'phonetics', label: '发音跟读 3 次', type: 'module', mod: 'phonetics', target: 3 },
]

function tasksDef() {
  const p = store.plan
  if (!p) return BASE_TASKS
  const out = []
  const newN = p.new_words?.count ?? 3
  const revN = p.reviews?.count ?? 5
  out.push({ ...BASE_TASKS[0], label: `学 ${newN} 个新词`, target: Math.max(1, newN) })
  if (revN > 0) out.push({ ...BASE_TASKS[1], label: `复习 ${revN} 个到期词`, target: revN })
  // plan.focus 命中的模块任务必留(标今日重点);其余模块任务保持默认
  const focusMod = p.focus?.module
  for (const t of BASE_TASKS.slice(2)) {
    if (t.mod === focusMod) out.push({ ...t, focus: true })
  }
  for (const t of BASE_TASKS.slice(2)) {
    if (t.mod !== focusMod) out.push({ ...t })
  }
  return out
}

function newWordsToday() {
  if (!store.states) return 0
  const t = today()
  return Object.values(store.states).filter((s) => s.first_learned_at
    && new Date(s.first_learned_at + 'Z').toLocaleDateString('sv') === t).length
}
function reviewsToday() {
  const a = store.stats?.daily_activity?.find?.((d) => d.date === today())
  return a ? a.reviews : 0
}
function moduleToday(mod) {
  return store.stats?.by_module_today?.[mod] || 0
}
function essaysToday() {
  return moduleToday('writing')
}

const tasks = computed(() => tasksDef().map((t) => {
  let progress = 0
  if (t.type === 'wordsNew') progress = newWordsToday()
  else if (t.type === 'review') progress = reviewsToday()
  else if (t.type === 'module') progress = moduleToday(t.mod)
  else if (t.type === 'writing') progress = essaysToday()
  return { ...t, progress, done: progress >= t.target }
}))

const doneCount = computed(() => tasks.value.filter((t) => t.done).length)
const totalCount = computed(() => tasks.value.length)
const tasksPct = computed(() => (doneCount.value / totalCount.value) * 100)

// ---- 持久化:今日星数 ----
const qKey = () => `wv_quests_${today()}`
const earnedStars = computed(() => {
  try { return JSON.parse(localStorage.getItem(qKey()) || '{}').stars || 0 } catch { return 0 }
})
function setEarnedStars(n) {
  try { localStorage.setItem(qKey(), JSON.stringify({ stars: n, date: today() })) } catch {}
}

// 完成度递增时累计星,避免刷新页面后星数被重算
watch(doneCount, (n) => {
  const cur = JSON.parse(localStorage.getItem(qKey()) || '{}').stars || 0
  if (n > cur) {
    setEarnedStars(n)
    if (n > cur) message.success(`今日任务 +${n - cur} 星 · 当前 ${n}/${totalCount.value}`)
  }
})

// ---- 成就墙(7 个里程碑) ----
const ACH = [
  { key: 'first-word',  label: '第一步',         desc: '学第一个词',           icon: 'node', cond: () => newWordsTotal() >= 1 },
  { key: 'words-50',     label: '50 词',          desc: '已学 50 词',           icon: 'constellation', cond: () => newWordsTotal() >= 50 },
  { key: 'words-200',    label: '200 词',         desc: '已学 200 词',          icon: 'constellation-full', cond: () => newWordsTotal() >= 200 },
  { key: 'streak-7',     label: '一周节拍',       desc: '连续学习 7 天',         icon: 'streak', cond: () => (store.stats?.streak_days || 0) >= 7 },
  { key: 'mastered-50',  label: '半个掌握',       desc: '掌握 50 词',           icon: 'spark', cond: () => (store.stats?.mastered || 0) >= 50 },
  { key: 'first-essay',  label: '第一次写作',     desc: '提交第一篇成文',       icon: 'pen', cond: () => moduleToday('writing') > 0 || localStorage.getItem('wv_first_essay') === '1' },
  { key: 'challenge-1',  label: '挑战者',         desc: '拿到第一颗挑战星',     icon: 'challenge', cond: () => (store.challengeStars || 0) >= 1 },
]
function newWordsTotal() {
  return store.stats?.learned || 0
}

// 成就统一收口:全站只有一份 wv_milestones(与 StarTrail 星轨共享数组,同 key 同义天然兼容)。
// 挂载时把旧 wv_achievements / 死 key wv_milestone_n 一次性并掉,老用户进度不丢
const aKey = 'wv_milestones'
try {
  const legacy = JSON.parse(localStorage.getItem('wv_achievements') || '[]')
  if (Array.isArray(legacy) && legacy.length) {
    const cur = new Set([...legacy, ...JSON.parse(localStorage.getItem(aKey) || '[]')])
    localStorage.setItem(aKey, JSON.stringify([...cur]))
  }
  localStorage.removeItem('wv_achievements')
  localStorage.removeItem('wv_milestone_n')
} catch { /* 脏数据,清完就走 */ }
const unlocked = computed(() => {
  try { return new Set(JSON.parse(localStorage.getItem(aKey) || '[]')) } catch { return new Set() }
})
function ack(key) {
  try {
    const cur = new Set(JSON.parse(localStorage.getItem(aKey) || '[]'))
    if (cur.has(key)) return false
    cur.add(key); localStorage.setItem(aKey, JSON.stringify([...cur])); return true
  } catch { return false }
}

// 监控每个成就条件;首次达成 toast
watch(() => ACH.map((a) => a.cond()), () => {
  for (const a of ACH) if (a.cond() && ack(a.key)) message.success(`成就解锁:${a.label} · ${a.desc}`)
}, { immediate: true })
</script>

<template>
  <div v-if="store.user" class="card glow quests-card">
    <div class="card-head">
      <div class="h-section">今日任务</div>
      <span class="chip dim">{{ doneCount }}/{{ totalCount }} 完成 · {{ earnedStars }} 星</span>
    </div>
    <p class="card-sub">完成任意项就 +1 星,明天清零。今天写 1 篇、或学 3 个词,都算正经学了一轮。</p>

    <div class="quest-progress" :style="{ '--pct': tasksPct + '%' }"><div class="qp-fill" /></div>

    <div class="quest-list">
      <div v-for="t in tasks" :key="t.key" class="quest-row" :class="{ done: t.done }">
        <span class="quest-mark">
          <svg v-if="t.done" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M3 8l4 4 6-8" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" /></svg>
        </span>
        <span class="quest-icon"><AppGlyph :name="t.icon" :size="15" /></span>
        <span class="quest-label">{{ t.label }}<i v-if="t.focus" class="quest-focus-tag">今日重点</i></span>
        <span class="quest-progress-text">
          <span v-if="t.done">完成</span>
          <span v-else>{{ t.progress }}/{{ t.target }}</span>
        </span>
      </div>
    </div>

    <div class="ach-divider"><span>成就墙</span></div>

    <div class="ach-grid">
      <div v-for="a in ACH" :key="a.key" class="ach-cell" :class="{ got: unlocked.has(a.key) }">
        <span class="ach-icon"><AppGlyph :name="a.icon" :size="14" /></span>
        <div class="ach-text">
          <div class="ach-label">{{ a.label }}</div>
          <div class="ach-desc">{{ a.desc }}</div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.quests-card { padding: 24px; }
.quest-progress { height: 6px; border-radius: 3px; background: var(--surface-sunken); overflow: hidden; margin-bottom: 14px; }
.quest-progress .qp-fill { display: block; height: 100%; border-radius: 3px; width: var(--pct, 0); background: var(--grad-accent); transition: width 0.5s var(--ease); }
.quest-list { display: flex; flex-direction: column; gap: 6px; }
.quest-row {
  display: flex; align-items: center; gap: 10px;
  padding: 9px 12px; border-radius: 9px;
  background: var(--surface-sunken); border: 1px solid var(--line);
  transition: all 0.2s var(--ease);
}
.quest-row.done {
  background: color-mix(in srgb, var(--success) 10%, transparent);
  border-color: color-mix(in srgb, var(--success) 30%, transparent);
}
.quest-row.done .quest-label, .quest-row.done .quest-progress-text { color: var(--success); }
.quest-mark {
  width: 22px; height: 22px; border-radius: 50%; flex-shrink: 0;
  border: 1.5px solid var(--line-strong);
  display: flex; align-items: center; justify-content: center;
  transition: background 0.3s var(--ease), border-color 0.3s var(--ease),
    box-shadow 0.3s var(--ease), color 0.3s var(--ease);
}
/* 完成态 = 对勾星点亮:文字色走 --on-success(暖夜粉彩底自动换深字,白字过亮不可读) */
.quest-row.done .quest-mark {
  background: var(--success); border-color: var(--success); color: var(--on-success);
  box-shadow: 0 0 10px color-mix(in srgb, var(--success) 40%, transparent);
}
.quest-icon { width: 18px; text-align: center; color: var(--text-3); flex-shrink: 0; }
.quest-row.done .quest-icon { color: var(--text-2); }
.quest-label { flex: 1; font-size: var(--fs-sm); }
.quest-focus-tag {
  font-style: normal; font-size: var(--fs-2xs); letter-spacing: 0.14em; color: var(--accent);
  border: 1px solid color-mix(in srgb, var(--accent) 45%, transparent);
  border-radius: 999px; padding: 0 7px; margin-left: 8px; vertical-align: 1px;
}
.quest-progress-text { font-family: var(--mono); font-size: var(--fs-xs); color: var(--text-2); }

.ach-divider {
  display: flex; align-items: center; gap: 10px;
  margin: 18px 0 12px; color: var(--text-3); font-size: var(--fs-xs); font-weight: 600;
  letter-spacing: 0.06em; text-transform: uppercase;
}
.ach-divider::before, .ach-divider::after { content: ''; flex: 1; height: 1px; background: var(--line); }
.ach-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 8px; }
.ach-cell {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 12px; border-radius: 9px;
  background: var(--surface-sunken); border: 1px dashed var(--line);
  color: var(--text-3); transition: all 0.2s var(--ease);
}
.ach-cell.got {
  background: color-mix(in srgb, var(--accent) 8%, var(--surface-sunken));
  border: 1px solid var(--line-accent); color: var(--text);
}
.ach-icon {
  width: 30px; height: 30px; border-radius: 50%;
  background: var(--surface-active); border: 1px solid var(--line);
  display: flex; align-items: center; justify-content: center; font-size: var(--fs-base); flex-shrink: 0;
}
.ach-cell.got .ach-icon { background: var(--accent-soft); color: var(--accent); border-color: var(--line-accent); }
.ach-label { font-size: var(--fs-sm); font-weight: 600; }
.ach-desc { font-size: var(--fs-2xs); color: var(--text-3); margin-top: 2px; }
.ach-cell.got .ach-desc { color: var(--text-2); }
</style>