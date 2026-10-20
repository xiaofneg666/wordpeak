<script setup>
// 结算仪式卡:听说读三视图共用的「这一篇成绩落定」时刻
// 视觉语汇与圣殿 mastery-ring 同源(SVG 环 + mono tabular-nums 大数字),但去 conic-gradient
// 换 SVG stroke-dashoffset——可以 CSS transition,环真的会「长」出来,不是瞬间满格
// prev 传上次同篇成绩(0-1)则出「上次 X% ↗/↘」对比行,第一次做显示首测提示
// 数字滚动交给全局 CountNum(0→分数,与环同拍);分数档位色走全站打分语汇:绿/琥珀/红
import { ref, computed, onMounted } from 'vue'

const props = defineProps({
  score: { type: Number, required: true }, // 0-1
  kicker: { type: String, default: 'RESULT' }, // mono 小字,如 ECHO RECEIVED
  title: { type: String, default: '' },      // 一句分档话(各视图 resultLine)
  prev: { type: Number, default: null },    // 上次同篇成绩,0-1;null = 首测
  unit: { type: String, default: '%' },
  right: { type: Number, default: null },   // 对了几题(可选,环下方小字)
  total: { type: Number, default: null },
})

const R = 52
const C = 2 * Math.PI * R
const grown = ref(false)

onMounted(() => {
  // 环长满(CSS transition);数字由 CountNum 从 0 滚到位,同拍 ~1s
  requestAnimationFrame(() => { grown.value = true })
})

const offset = computed(() => (grown.value ? C * (1 - Math.max(0, Math.min(1, props.score))) : C))
const pct = computed(() => Math.round(Math.max(0, Math.min(1, props.score)) * 100))
// 档位(纯视觉,喂 CSS 类):≥80 金绿 / ≥50 琥珀 / 其余红,与全站打分色对齐
const tier = computed(() => (props.score >= 0.8 ? 'success' : props.score >= 0.5 ? 'warn' : 'danger'))
const trend = computed(() => {
  if (props.prev == null) return null
  const d = props.score - props.prev
  if (d > 0.02) return { dir: 'up', glyph: '↗', label: Math.round(props.prev * 100) }
  if (d < -0.02) return { dir: 'down', glyph: '↘', label: Math.round(props.prev * 100) }
  return { dir: 'flat', glyph: '→', label: Math.round(props.prev * 100) }
})
</script>

<template>
  <div class="settle fade-in dots-host" :class="tier">
    <span class="dots-decor dots-fade" aria-hidden="true" style="--dots-o:.22" />
    <div class="settle-ring">
      <svg viewBox="0 0 120 120" aria-hidden="true">
        <circle class="track" cx="60" cy="60" :r="R" />
        <circle class="fill" cx="60" cy="60" :r="R" :stroke-dasharray="C" :stroke-dashoffset="offset" />
      </svg>
      <div class="settle-num">
        <b><CountNum :v="pct" :duration="950" mono /></b>
        <span>{{ unit }}</span>
        <i v-if="right != null && total != null">{{ right }}/{{ total }}</i>
      </div>
    </div>
    <div class="settle-body">
      <div class="settle-kicker">{{ kicker }}</div>
      <p class="settle-title">{{ title }}</p>
      <p class="settle-prev" v-if="trend">
        <span class="sp-label">上次这篇</span>
        <span class="sp-val">{{ trend.label }}%</span>
        <span class="sp-trend" :class="trend.dir">{{ trend.glyph }} {{ trend.dir === 'up' ? '比上次好' : trend.dir === 'down' ? '这次退了点,正常波动' : '和上次持平' }}</span>
      </p>
      <p class="settle-prev first" v-else>
        <span class="sp-label">第一次做这篇</span>
        <span class="sp-trend flat">下一遍这里就有对比</span>
      </p>
      <slot />
    </div>
  </div>
</template>

<style scoped>
/* 档位色:--tier-c 着色(环/数字/描边/角部晕),--tier-on 是实底徽章上的文字
   (暖夜主题自动换深字,晴空保持白字,写死 #fff 会在暖夜翻车) */
.settle {
  --tier-c: var(--warn);
  --tier-on: var(--on-warm);
  position: relative;
  display: flex; gap: 24px; align-items: center; flex-wrap: wrap;
  margin-top: 18px; padding: 22px 26px;
  border: 1px solid var(--line); border-left: 2px solid var(--tier-c);
  border-radius: 14px;
  background:
    radial-gradient(340px 190px at 90% -30%, color-mix(in srgb, var(--tier-c) 9%, transparent), transparent 72%),
    var(--surface-sunken);
}
.settle.success { --tier-c: var(--success); --tier-on: var(--on-success); }
.settle.warn { --tier-c: var(--warn); --tier-on: var(--on-warm); }
.settle.danger { --tier-c: var(--danger); --tier-on: var(--on-danger); }

.settle-ring {
  position: relative; width: 128px; height: 128px; flex-shrink: 0;
  animation: ringSquish 0.55s var(--ease-squish-2) 0.02s backwards;
}
@keyframes ringSquish { from { transform: scale(0.55); opacity: 0; } }
.settle-ring svg { width: 100%; height: 100%; transform: rotate(-90deg); }
.settle-ring .track { fill: none; stroke: var(--surface-active); stroke-width: 7; }
.settle-ring .fill {
  fill: none; stroke: var(--tier-c); stroke-width: 7; stroke-linecap: round;
  transition: stroke-dashoffset 1.1s var(--ease);
}

.settle-num {
  position: absolute; inset: 0;
  display: flex; flex-direction: column; align-items: center; justify-content: center; line-height: 1;
}
.settle-num b {
  font-family: var(--mono); font-size: 34px; font-weight: 700;
  color: var(--tier-c); font-variant-numeric: tabular-nums;
}
.settle-num span { font-size: var(--fs-2xs); color: var(--text-3); margin-top: 3px; letter-spacing: 0.1em; }
/* 对/总:档位色实底徽章,文字用 --tier-on(四套主题对比都成立) */
.settle-num i {
  font-style: normal; font-family: var(--mono); font-size: var(--fs-2xs); font-weight: 600;
  color: var(--tier-on); background: var(--tier-c);
  padding: 2px 9px; border-radius: 999px; margin-top: 6px;
}

.settle-body { flex: 1; min-width: 220px; animation: unsealRise 0.5s var(--ease) 0.1s backwards; }
.settle-kicker {
  display: block; width: fit-content;
  padding: 3px 10px; border-radius: 999px;
  font-family: var(--mono); font-size: var(--fs-2xs); font-weight: 600;
  letter-spacing: 0.2em;
  color: var(--tier-c);
  background: color-mix(in srgb, var(--tier-c) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--tier-c) 30%, transparent);
  margin-bottom: 10px;
}
.settle-title { margin: 0; font-size: var(--fs-md); font-weight: 600; line-height: 1.65; color: var(--text); }

.settle-prev {
  display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap;
  margin: 12px 0 0; padding-top: 10px; border-top: 1px dashed var(--line);
  font-size: var(--fs-xs);
}
.sp-label { color: var(--text-3); }
.sp-val { font-family: var(--mono); font-weight: 700; color: var(--text-2); font-variant-numeric: tabular-nums; }
.sp-trend { font-size: var(--fs-xs); }
.sp-trend.up { color: var(--success); }
.sp-trend.flat { color: var(--text-3); }
.sp-trend.down { color: var(--text-3); }

@media (max-width: 640px) {
  .settle { padding: 18px; gap: 16px; }
  .settle-ring { width: 104px; height: 104px; }
  .settle-num b { font-size: var(--fs-2xl); }
  .settle-num i { font-size: var(--fs-2xs); padding: 1px 7px; }
}
</style>
