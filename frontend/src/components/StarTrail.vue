<script setup>
// 星轨:终身学习里程碑(自设置页迁入观星台——天上「你的天空」星图,地上这条星轨,两幅都是你的数据)。
// 7 个里程碑沿一条轨道排开:达成点亮的星转金色,进行中的以刻度条逼近;点已达成未解锁的星当场庆祝。
// 解锁状态存 localStorage(wv_milestones,继承设置页时代的 key,老用户的金色不丢)。
// 自动达成即庆祝,但"首批"达成视为旧新闻静默入档——不把一个月前的成绩当新惊喜弹给你。
import { ref, computed, watch } from 'vue'
import { useUniverse } from '../stores/universe'
import { message } from '../ui'

const store = useUniverse()

// 7 个里程碑 + 仪器小标(天文仪器语言):日出 / 行星轨道 / 月相 / 星轨 / 三星小星座 / 星系盘 / 星座连线
const MILESTONES = [
  { key: 'first-day',    threshold: 1,    label: '第一天' },
  { key: 'streak-7',    threshold: 7,     label: '连学一周' },
  { key: 'streak-30',   threshold: 30,    label: '连学一月' },
  { key: 'mastered-50', threshold: 50,    label: '掌握 50 词' },
  { key: 'mastered-200', threshold: 200,  label: '掌握 200 词' },
  { key: 'mastered-500', threshold: 500,  label: '掌握 500 词' },
  { key: 'mastered-1000', threshold: 1000, label: '掌握 1000 词' },
]
const MS_GLYPHS = {
  'first-day': 'M2.5 16.5h19M8 16.5a4 4 0 0 1 8 0M12 10V6.5M6.8 11.8L4.5 9.5M17.2 11.8L19.5 9.5',
  'streak-7': 'M12 12m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0M4.5 14.5C7 17 17 17 19.5 9.5M18.5 9.2m-1.2 0a1.2 1.2 0 1 0 2.4 0a1.2 1.2 0 1 0-2.4 0',
  'streak-30': 'M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z',
  'mastered-50': 'M12 12m-8.2 0a8.2 8.2 0 1 0 16.4 0a8.2 8.2 0 1 0-16.4 0M12 8.2l1 2.8 2.8 1-2.8 1-1 2.8-1-2.8-2.8-1 2.8-1z',
  'mastered-200': 'M6.5 8.5l1 2.5 2.5 1-2.5 1-1 2.5-1-2.5-2.5-1 2.5-1zM17 5.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8zM13 15.5l.6 1.5 1.5.6-1.5.6-.6 1.5-.6-1.5-1.5-.6 1.5-.6z',
  'mastered-500': 'M12 12m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0M5 9.5c1.5 2.5 4 3.5 7 3s5-3 6.5-5.5M6 15.5c2.5-1 5-1 7 1s4 1.5 5-.5',
  'mastered-1000': 'M4.5 16.5L9 6l5.5 8.5L19 4.5M4.5 16.5m-1 0a1 1 0 1 0 2 0a1 1 0 1 0-2 0M9 6m-1 0a1 1 0 1 0 2 0a1 1 0 1 0-2 0M14.5 14.5m-1 0a1 1 0 1 0 2 0a1 1 0 1 0-2 0M19 4.5m-1 0a1 1 0 1 0 2 0a1 1 0 1 0-2 0',
}

function unlockedSet() {
  try { return new Set(JSON.parse(localStorage.getItem('wv_milestones') || '[]')) } catch { return new Set() }
}
const unlocked = ref(unlockedSet())
function persistUnlocked() {
  // 读-合并-写:该 key 还有另一个写入方(DailyQuests 成就墙,同数组共享)——
  // 不能拿挂载时的内存快照整组覆盖,否则会把对方刚解锁的成就悄悄抹掉
  try {
    const cur = unlockedSet()
    for (const k of unlocked.value) cur.add(k)
    localStorage.setItem('wv_milestones', JSON.stringify([...cur]))
  } catch {}
}

const trail = computed(() => {
  const s = store.stats
  const streak = s?.streak_days ?? 0
  const mastered = s?.mastered ?? 0
  return MILESTONES.map((m) => {
    let progress = 0
    let target = m.threshold
    if (m.key.startsWith('streak')) progress = Math.min(streak, target)
    else if (m.key.startsWith('mastered')) progress = Math.min(mastered, target)
    else if (m.key === 'first-day') {
      const today = (s?.daily_activity || []).at(-1)
      progress = ((today?.reviews || 0) + (today?.new_words || 0)) > 0 ? 1 : 0
      target = 1
    }
    const achieved = progress >= target
    return { ...m, progress, target, achieved, unlocked: unlocked.value.has(m.key) || achieved }
  })
})

// 解锁一个里程碑(写入 localStorage;解锁过的星一直保持金色)
function celebrate(key) {
  const m = trail.value.find((x) => x.key === key)
  if (!m || !m.achieved || unlocked.value.has(key)) return
  unlocked.value = new Set([...unlocked.value, key])
  persistUnlocked()
  message.success(`解锁：${m.label}`)
}

// 自动达成即庆祝;首批达成为旧新闻,静默入档(第一次看到有效数据时把既有成绩直接标金,不刷屏)
let firstSeeded = false
watch(() => trail.value.filter((m) => m.achieved).map((m) => m.key), (keys, prev) => {
  if (!keys.length) return
  if (!firstSeeded) {
    firstSeeded = true
    const adds = keys.filter((k) => !unlocked.value.has(k))
    if (adds.length) {
      unlocked.value = new Set([...unlocked.value, ...adds])
      persistUnlocked()
    }
    return
  }
  for (const k of keys) if (!prev?.includes(k)) celebrate(k)
}, { immediate: true })

// 最近 7 天答题分布柱图(星轨下方:轨道是天,柱图是路)
const weekBars = computed(() => {
  const arr = store.stats?.daily_activity || []
  const out = arr.slice(-7).map((d) => ({
    label: d.date.slice(5),
    value: (d.reviews || 0) + (d.new_words || 0),
  }))
  while (out.length < 7) out.unshift({ label: '—', value: 0 })
  return out
})
const weekPeak = computed(() => Math.max(1, ...weekBars.value.map((d) => d.value)))
const litCount = computed(() => trail.value.filter((m) => m.unlocked).length)
</script>

<template>
  <div class="star-trail">
    <div class="st-head">
      <div class="st-title">星轨</div>
      <span class="st-kick">STAR TRAIL · 终身里程碑 · {{ litCount }}/{{ trail.length }} 点亮</span>
    </div>

    <!-- 轨道:7 站沿一条线排开,达成=金星,进行中=刻度逼近 -->
    <div class="st-track" role="list">
      <button
        v-for="m in trail" :key="m.key"
        class="st-node" :class="{ lit: m.unlocked }"
        role="listitem"
        :title="`${m.label}(${m.progress}/${m.target})`"
        @click="celebrate(m.key)"
      >
        <span class="st-glyph" aria-hidden="true">
          <svg viewBox="0 0 24 24"><path :d="MS_GLYPHS[m.key]" /></svg>
        </span>
        <span class="st-label">{{ m.label }}</span>
        <span class="st-num">{{ m.progress }}/{{ m.target }}</span>
        <span class="st-bar" aria-hidden="true"><i :style="{ width: `${(m.progress / m.target) * 100}%` }" /></span>
      </button>
    </div>

    <!-- 最近 7 天答题分布 -->
    <div class="st-week">
      <div class="st-week-head">
        <span>最近 7 天</span>
        <span class="st-week-peak">高峰 {{ weekPeak }} 题/天</span>
      </div>
      <div class="st-week-grid">
        <div v-for="(b, i) in weekBars" :key="i" class="st-wcol" :title="`${b.label}: ${b.value} 题`">
          <div class="st-wbar" :style="{ height: `${(b.value / weekPeak) * 100}%` }" />
          <span class="st-wval">{{ b.value || '' }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.star-trail { display: flex; flex-direction: column; height: 100%; }
.st-head { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; margin-bottom: 14px; }
.st-title { font-size: var(--fs-lg); font-weight: 600; color: var(--text); }
.st-kick { font-family: var(--mono, monospace); font-size: var(--fs-2xs); letter-spacing: 0.14em; color: var(--text-3); }

/* 轨道:节点下一条横贯的刻线,像航线的一站站 */
.st-track {
  position: relative;
  display: grid; grid-template-columns: repeat(7, 1fr); gap: 8px;
  padding-top: 6px;
}
.st-track::before {
  content: ''; position: absolute; top: 20px; left: 4%; right: 4%;
  height: 1px; background: var(--line);
}
.st-node {
  position: relative;
  display: flex; flex-direction: column; align-items: center; gap: 5px;
  background: none; border: none; padding: 6px 2px 4px;
  cursor: pointer; font-family: inherit;
  transition: transform 0.25s var(--ease);
}
.st-node:hover { transform: translateY(-2px); }
.st-glyph {
  width: 28px; height: 28px; border-radius: 9px;
  display: flex; align-items: center; justify-content: center;
  background: var(--surface-sunken);
  border: 1px solid var(--line);
  transition: border-color 0.3s var(--ease), background 0.3s var(--ease), box-shadow 0.3s var(--ease);
}
.st-glyph svg { width: 16px; height: 16px; color: var(--text-3); transition: color 0.3s var(--ease); }
.st-glyph path {
  fill: none; stroke: currentColor; stroke-width: 1.4;
  stroke-linecap: round; stroke-linejoin: round;
}
/* 点亮=金星(终幕星座同源暖金在暗主题;晴空用琥珀,白底上金白不可见) */
.st-node.lit .st-glyph {
  border-color: color-mix(in srgb, var(--warn) 40%, var(--line));
  background: color-mix(in srgb, var(--warn) 10%, var(--surface));
  box-shadow: 0 0 14px color-mix(in srgb, var(--warn) 14%, transparent);
}
.st-node.lit .st-glyph svg { color: var(--warn); }
.st-node:not(.lit):hover .st-glyph { border-color: var(--line-accent); }
.st-label { font-size: var(--fs-2xs); color: var(--text-2); white-space: nowrap; }
.st-node.lit .st-label { color: var(--text); font-weight: 600; }
.st-num {
  font-family: var(--mono, monospace); font-size: var(--fs-2xs); color: var(--text-3);
  font-variant-numeric: tabular-nums;
}
.st-bar {
  width: 70%; height: 3px; border-radius: 2px;
  background: var(--surface-active); overflow: hidden;
}
.st-bar i {
  display: block; height: 100%;
  background: var(--grad-accent); border-radius: 2px;
  transition: width 0.5s var(--ease);
}
.st-node.lit .st-bar i { background: var(--grad-warm); }

/* 最近 7 天柱图 */
.st-week { margin-top: auto; padding-top: 16px; }
.st-week-head {
  display: flex; justify-content: space-between; align-items: baseline;
  font-size: var(--fs-xs); color: var(--text-3); margin-bottom: 8px;
}
.st-week-peak { font-family: var(--mono, monospace); font-size: var(--fs-2xs); }
.st-week-grid {
  display: grid; grid-template-columns: repeat(7, 1fr); gap: 6px;
  height: 64px; align-items: end;
}
.st-wcol { display: flex; flex-direction: column; align-items: center; justify-content: flex-end; gap: 3px; height: 100%; }
.st-wbar {
  width: 100%; max-width: 20px; min-height: 2px;
  background: var(--grad-accent); border-radius: 3px 3px 0 0;
  transition: height 0.6s var(--ease), filter 0.2s ease;
}
.st-wcol:hover .st-wbar { filter: brightness(1.2); }
.st-wval { font-family: var(--mono, monospace); font-size: var(--fs-2xs); color: var(--text-3); min-height: 12px; }

/* 窄屏:轨道 7 站换两行(4+3),刻线退场 */
@media (max-width: 1080px) {
  .st-track { grid-template-columns: repeat(4, 1fr); row-gap: 14px; }
  .st-track::before { display: none; }
}
@media (max-width: 640px) {
  .st-track { grid-template-columns: repeat(3, 1fr); }
}
</style>
