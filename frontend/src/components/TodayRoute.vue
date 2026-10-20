<script setup>
// 今日航线:后端 /api/plan 产出的当日学习计划(档案 goal/self_level + due 队列 + 弱项),
// 以「星轨刻线」语言呈现:一条轨道三个节点(01 学新词 / 02 复习 / 03 弱项加练),
// 完成的节点实心点亮,未完成的空心等待。每节点可点,直达对应模块。
// 依据:每日 10-25 分钟短 session 优于长突击;计划随档案伸缩,总时长被钳制。
import { computed } from 'vue'
import { useUniverse } from '../stores/universe'

const store = useUniverse()
const today = () => new Date().toLocaleDateString('sv')

// 各节点今日进度
function newWordsToday() {
  return Object.values(store.states || {}).filter((s) => s.first_learned_at
    && new Date(s.first_learned_at + 'Z').toLocaleDateString('sv') === today()).length
}
function reviewsToday() {
  const a = store.stats?.daily_activity?.find?.((d) => d.date === today())
  return a ? a.reviews : 0
}
function focusToday() {
  const mod = store.plan?.focus?.module
  return mod ? (store.stats?.by_module_today?.[mod] || 0) : 0
}

const nodes = computed(() => {
  const p = store.plan
  if (!p) return []
  const list = [
    {
      no: '01', kind: 'learn', label: `学 ${p.new_words?.count ?? 0} 个新词`,
      meta: `约 ${p.new_words?.minutes ?? 0} 分钟 · 三幕流`,
      done: p.new_words?.count > 0 && newWordsToday() >= (p.new_words?.count ?? 1),
      run: () => store.openLearn(),
    },
    {
      no: '02', kind: 'review', label: `复习 ${p.reviews?.count ?? 0} 个到期词`,
      meta: `约 ${p.reviews?.minutes ?? 0} 分钟 · 记忆掉到 90% 的那批`,
      done: (p.reviews?.count ?? 0) > 0 && reviewsToday() >= Math.max(1, Math.min(p.reviews.count, 5)),
      run: () => store.openReview(),
    },
  ]
  if (p.focus) {
    list.push({
      no: '03', kind: 'focus', label: `${p.focus.name}加练`,
      meta: `${p.focus.minutes} 分钟 · 正确率 ${Math.round(p.focus.accuracy * 100)}%`,
      reason: p.focus.reason,
      done: focusToday() > 0,
      run: () => store.setView(p.focus.view || p.focus.module),
    })
  }
  return list
})

const totalMinutes = computed(() => store.plan?.total_minutes ?? null)
const doneCount = computed(() => nodes.value.filter((n) => n.done).length)
const allDone = computed(() => nodes.value.length > 0 && doneCount.value === nodes.value.length)
</script>

<template>
  <div class="tr-card card" v-if="store.user">
    <template v-if="nodes.length">
      <div class="tr-head">
        <div class="tr-kicker">TODAY'S ROUTE</div>
        <div class="tr-title">今日航线<span class="tr-total">全程约 {{ totalMinutes }} 分钟</span></div>
      </div>
      <div class="tr-track" role="list">
        <div
          v-for="n in nodes" :key="n.no"
          class="tr-node" :class="{ done: n.done }" role="listitem"
          @click="n.run()"
        >
          <div class="tr-node-head">
            <span class="tr-no">{{ n.no }}</span>
            <span class="tr-star" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M12 3 13.4 10.6 21 12 13.4 13.4 12 21 10.6 13.4 3 12 10.6 10.6Z" /></svg>
            </span>
          </div>
          <div class="tr-label">{{ n.label }}</div>
          <div class="tr-meta">{{ n.meta }}</div>
          <div v-if="n.reason" class="tr-reason">{{ n.reason }}</div>
          <div class="tr-go">进入</div>
        </div>
      </div>
      <p v-if="store.plan.sleep_hint && !allDone" class="tr-sleep">睡前一小时是记忆巩固的黄金档——今天学的新词,睡前再过一遍,巩固效率更高</p>
      <p v-else-if="allDone" class="tr-allclear">航线已走完——今天到这里就很好,别贪多。明天 FSRS 会把今天学过的词再排给你。</p>
    </template>
    <template v-else>
      <div class="tr-head">
        <div class="tr-kicker">TODAY'S ROUTE</div>
        <div class="tr-title">今日航线</div>
      </div>
      <p class="tr-fallback">航线还没排出来——先去<span class="tr-link" @click="store.openReview()">复习一轮</span>,或进<span class="tr-link" @click="store.openLearn()">学习舱</span>学几个新词。</p>
    </template>
  </div>
</template>

<style scoped>
.tr-card { padding: 20px 24px 18px; }

/* 卡头:mono 刻字 kicker 垫在衬线大字上方 —— 与观星台英雄区/天空卡同一「星图命名式」 */
.tr-head { display: flex; flex-direction: column; gap: 7px; margin-bottom: 18px; }
.tr-kicker {
  font-family: var(--mono, monospace); font-size: var(--fs-2xs); font-weight: 600;
  letter-spacing: 0.34em; color: var(--accent); opacity: 0.85;
}
.tr-title {
  font-family: var(--serif);
  font-size: var(--fs-xl); font-weight: 600; letter-spacing: 0.1em; color: var(--text);
}
.tr-total { font-size: var(--fs-xs); color: var(--text-3); margin-left: 10px; font-weight: 400; letter-spacing: 0.02em; }

.tr-track {
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px;
  position: relative; padding-top: 12px;
}
/* 轨道刻线:两端渐隐的一道信号轨,高度精确穿过三站星环的中心 */
.tr-track::before {
  content: ''; position: absolute; top: 21.5px; left: 6%; right: 6%;
  height: 1px;
  background: linear-gradient(90deg, transparent,
    color-mix(in srgb, var(--text-3) 34%, transparent) 14%,
    color-mix(in srgb, var(--text-3) 34%, transparent) 86%, transparent);
}
.tr-node { position: relative; cursor: pointer; transition: transform 0.25s var(--ease); }
/* hover 反馈与全站同语言:上浮 + 强调色渐进(站环/标签/进入一并亮起) */
.tr-node:hover { transform: translateY(-2px); }
.tr-node:active { transform: translateY(0) scale(0.99); }
.tr-node-head { display: flex; align-items: center; gap: 9px; margin-bottom: 10px; }
.tr-no {
  font-size: var(--fs-2xs); font-family: var(--mono, monospace); color: var(--text-3);
  letter-spacing: 0.08em; padding-top: 1px; transition: color 0.25s var(--ease);
}
/* 星站环:轨道上的站点标记,环里住一颗星;完成 = 环亮星点(亮度预算只给"星") */
.tr-star {
  width: 20px; height: 20px; border-radius: 50%; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  background: var(--surface);
  border: 1px solid var(--line-strong);
  color: var(--text-4);
  transition: border-color 0.3s var(--ease), background 0.3s var(--ease), box-shadow 0.3s var(--ease);
}
.tr-star svg { display: block; width: 11px; height: 11px; transition: color 0.3s var(--ease); }
.tr-node:hover .tr-star { border-color: color-mix(in srgb, var(--accent) 55%, transparent); }
.tr-node.done .tr-no { color: var(--accent); }
.tr-node.done .tr-star {
  background: var(--accent-soft);
  border-color: color-mix(in srgb, var(--accent) 45%, transparent);
  box-shadow: 0 0 10px color-mix(in srgb, var(--accent) 35%, transparent);
}
.tr-node.done .tr-star svg { color: var(--accent); }

.tr-label { font-size: var(--fs-md); font-weight: 600; color: var(--text); line-height: 1.4; transition: color 0.25s var(--ease); }
.tr-node:hover .tr-label { color: var(--accent); }
.tr-node.done .tr-label { color: var(--text-2); }
.tr-meta { font-size: var(--fs-xs); color: var(--text-3); margin-top: 4px; line-height: 1.6; }
.tr-reason { font-size: var(--fs-2xs); color: var(--text-3); margin-top: 6px; line-height: 1.7; opacity: 0.85; }
.tr-go {
  font-size: var(--fs-2xs); letter-spacing: 0.18em; color: var(--accent);
  margin-top: 9px; opacity: 0; transform: translateY(2px);
  transition: opacity .2s ease, transform .2s ease;
}
.tr-node:hover .tr-go { opacity: 1; transform: none; }
.tr-node.done .tr-go { opacity: 0.6; }

.tr-sleep { font-size: var(--fs-xs); color: var(--accent-3, #f472b6); margin-top: 16px; line-height: 1.7; }
.tr-allclear { font-size: var(--fs-xs); color: var(--text-3); margin-top: 16px; line-height: 1.7; }
.tr-fallback { font-size: var(--fs-base); color: var(--text-2); line-height: 1.9; }
.tr-link { color: var(--accent); cursor: pointer; text-decoration: underline; text-underline-offset: 4px; }

@media (max-width: 640px) {
  .tr-track { grid-template-columns: 1fr; gap: 14px; }
  .tr-track::before { display: none; }
}
</style>
