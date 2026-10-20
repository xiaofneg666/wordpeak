<script setup>
// 装配线:真齿轮 SVG path + 传送带,运转时齿轮联动、零件滑入、装配完成火苗
// 每个语法类别一套专属零件:时态=时间齿轮组,虚拟语气=闪电霓虹电路板,
// 语态=翻转齿轮,从句=嵌套齿轮环,非谓语=发条弹簧,情态=能量表盘,
// 比较=天平,特殊句型=传送带分流,五大句型=经典齿轮组
import { computed } from 'vue'

const props = defineProps({
  parts: { type: Array, default: () => [] },
  running: { type: Boolean, default: false },
  category: { type: String, default: '' },
})

// 类别 → 专属零件主题
const THEMES = {
  '时态': 'time',
  '虚拟语气': 'neon',
  '语态': 'flip',
  '三大从句': 'nested',
  '非谓语动词': 'spring',
  '情态动词': 'power',
  '比较': 'balance',
  '特殊句型': 'conveyor',
}
const theme = computed(() => THEMES[props.category] || 'classic')

// 真齿轮 path:用渐开线近似生成 12 齿
function gearPath(outer, inner, teeth = 12) {
  const r1 = outer, r2 = inner
  const tipR = r1, rootR = r1 * 0.82
  const ang = (Math.PI * 2) / teeth
  const half = ang / 4
  let p = ''
  for (let i = 0; i < teeth; i++) {
    const base = i * ang
    const a1 = base - half
    const a2 = base - half * 0.4
    const a3 = base + half * 0.4
    const a4 = base + half
    const a5 = (i + 1) * ang - half
    if (i === 0) p += `M ${(rootR * Math.cos(a1)).toFixed(2)} ${(rootR * Math.sin(a1)).toFixed(2)} `
    p += `A ${rootR} ${rootR} 0 0 1 ${(rootR * Math.cos(a2)).toFixed(2)} ${(rootR * Math.sin(a2)).toFixed(2)} `
    p += `L ${(tipR * Math.cos(a2 - half * 0.1)).toFixed(2)} ${(tipR * Math.sin(a2 - half * 0.1)).toFixed(2)} `
    p += `A ${tipR} ${tipR} 0 0 1 ${(tipR * Math.cos(a3 + half * 0.1)).toFixed(2)} ${(tipR * Math.sin(a3 + half * 0.1)).toFixed(2)} `
    p += `L ${(rootR * Math.cos(a4)).toFixed(2)} ${(rootR * Math.sin(a4)).toFixed(2)} `
    p += `A ${rootR} ${rootR} 0 0 1 ${(rootR * Math.cos(a5)).toFixed(2)} ${(rootR * Math.sin(a5)).toFixed(2)} `
    if (i < teeth - 1) p += 'Z '
  }
  p += 'Z'
  return p
}

// 经典齿轮组(五大基本句型,默认)
const gears = [
  { id: 'a', cx: 70, cy: 70, r: 56, teeth: 14, dur: 8, dir: 1, color: 'var(--accent)' },
  { id: 'b', cx: 195, cy: 60, r: 38, teeth: 10, dur: 5.4, dir: -1, color: 'var(--accent-2)' },
  { id: 'c', cx: 300, cy: 78, r: 62, teeth: 16, dur: 10, dir: 1, color: 'var(--warn)' },
]

// 时间齿轮组:表盘刻度
const clockTicks = Array.from({ length: 12 }, (_, i) => {
  const a = (i * Math.PI) / 6
  const c = Math.cos(a), s = Math.sin(a)
  return { x1: c * 44, y1: s * 44, x2: c * 50, y2: s * 50 }
})

// 发条弹簧:锯齿折线
const springPoints = (() => {
  const pts = []
  for (let i = 0; i <= 8; i++) pts.push(`${i % 2 ? 202 : 158},${38 + i * 8.5}`)
  return 'M ' + pts.join(' L ')
})()

// 霓虹电路板:走线(直角 PCB traces)
const traces = [
  'M 10 100 H 60 V 46 H 120',
  'M 10 118 H 84 V 92 H 130',
  'M 250 40 H 300 V 96 H 352',
  'M 240 118 H 288 V 66 H 322',
  'M 140 16 V 34',
  'M 216 16 V 34',
]
</script>

<template>
  <div class="machine" :class="[`theme-${theme}`, { running }]">
    <div class="gear-stage">
      <svg class="gear-svg" viewBox="0 0 360 140" preserveAspectRatio="xMidYMid meet">
        <defs>
          <radialGradient id="centerGlow" cx="50%" cy="50%">
            <stop offset="0%" stop-color="var(--accent)" stop-opacity="0.6" />
            <stop offset="100%" stop-color="var(--accent)" stop-opacity="0" />
          </radialGradient>
          <radialGradient id="neonGlow" cx="50%" cy="50%">
            <stop offset="0%" stop-color="var(--accent-2)" stop-opacity="0.5" />
            <stop offset="100%" stop-color="var(--accent-2)" stop-opacity="0" />
          </radialGradient>
          <filter id="grain">
            <feTurbulence baseFrequency="0.65" numOctaves="2" />
            <feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0 0.05 0" />
            <feComposite operator="in" in2="SourceGraphic" />
          </filter>
        </defs>

        <!-- ===== 经典齿轮组(五大基本句型) ===== -->
        <template v-if="theme === 'classic'">
          <circle cx="180" cy="80" r="100" fill="url(#centerGlow)" opacity="0.5" />
          <g v-for="g in gears" :key="g.id" :transform="`translate(${g.cx} ${g.cy})`">
            <g :class="['gear', { active: running, rev: g.dir === -1 }]" :style="{ '--dur': `${g.dur}s` }">
              <circle :r="g.r" fill="black" opacity="0.18" :cy="3" />
              <path :d="gearPath(g.r, g.r * 0.78, g.teeth)" :fill="g.color" :stroke="g.color" stroke-width="1" :style="{ filter: `drop-shadow(0 0 8px ${g.color})` }" opacity="0.9" />
              <circle :r="g.r * 0.5" fill="var(--surface)" :stroke="g.color" stroke-width="1.5" opacity="0.85" />
              <circle :r="6" :fill="g.color" />
              <circle :r="2.5" fill="var(--bg-2)" />
            </g>
          </g>
          <line v-if="running" x1="0" y1="130" x2="360" y2="130" stroke="var(--line-accent)" stroke-width="2" stroke-dasharray="6 4" class="belt-flow" />
        </template>

        <!-- ===== 时间齿轮组(时态):时钟 + 伴动小齿轮 + 传送带 ===== -->
        <template v-else-if="theme === 'time'">
          <circle cx="180" cy="78" r="58" fill="url(#centerGlow)" opacity="0.4" />
          <!-- 主表盘 -->
          <g transform="translate(180 78)">
            <circle r="54" class="clock-face" />
            <line v-for="(t, i) in clockTicks" :key="i" :x1="t.x1" :y1="t.y1" :x2="t.x2" :y2="t.y2" class="clock-tick" :class="{ major: i % 3 === 0 }" />
            <!-- 分针(快)与时针(慢),运转时各自转动 -->
            <g :class="['clock-hand', 'minute', { active: running }]">
              <circle r="42" fill="none" stroke="none" />
              <line x1="0" y1="6" x2="0" y2="-42" />
            </g>
            <g :class="['clock-hand', 'hour', { active: running }]">
              <circle r="26" fill="none" stroke="none" />
              <line x1="0" y1="8" x2="0" y2="-26" />
            </g>
            <circle r="5" class="clock-hub" />
          </g>
          <!-- 伴动小齿轮:时间的传动 -->
          <g transform="translate(64 108)"><circle r="20" :class="['mini-gear', { active: running }]" :style="{ '--dur': '4s' }" /></g>
          <g transform="translate(300 108)"><circle r="20" :class="['mini-gear rev', { active: running }]" :style="{ '--dur': '6s' }" /></g>
          <!-- 时间传送带 -->
          <line x1="0" y1="134" x2="360" y2="134" stroke="var(--line-accent)" stroke-width="2" stroke-dasharray="6 4" :class="{ 'belt-flow': running }" />
        </template>

        <!-- ===== 翻转齿轮(语态/被动) ===== -->
        <template v-else-if="theme === 'flip'">
          <circle cx="180" cy="72" r="96" fill="url(#centerGlow)" opacity="0.35" />
          <!-- 上下翻转的主齿轮:受动者"被翻面" -->
          <g transform="translate(110 70)">
            <g :class="['flip-gear', { active: running }]" :style="{ '--dur': '7s' }">
              <path :d="gearPath(52, 40, 13)" fill="var(--accent)" opacity="0.9" />
              <circle r="24" fill="var(--surface)" stroke="var(--accent)" stroke-width="1.5" />
              <path d="M -12 -8 a 14 14 0 0 1 24 0 M 12 -8 l 7 -5 m -7 5 l 8 3" class="flip-arrow" fill="none" />
            </g>
          </g>
          <g transform="translate(262 74)">
            <g :class="['flip-gear rev', { active: running }]" :style="{ '--dur': '5s' }">
              <path :d="gearPath(36, 28, 9)" fill="var(--accent-2)" opacity="0.9" />
              <circle r="16" fill="var(--surface)" stroke="var(--accent-2)" stroke-width="1.5" />
            </g>
          </g>
          <!-- 升降阀杆:被动件的上下翻面 -->
          <g :class="['lifter', { active: running }]">
            <rect x="344" y="30" width="10" height="46" rx="4" class="lifter-rod" />
            <path d="M 349 84 l -6 10 h 12 z" class="lifter-tip" />
          </g>
        </template>

        <!-- ===== 嵌套齿轮环(三大从句) ===== -->
        <template v-else-if="theme === 'nested'">
          <circle cx="180" cy="74" r="100" fill="url(#centerGlow)" opacity="0.35" />
          <!-- 三层同心齿轮环:从句嵌套进主句 -->
          <g transform="translate(180 74)">
            <g :class="['ring-gear r1', { active: running }]" :style="{ '--dur': '14s' }">
              <path :d="gearPath(58, 46, 18)" fill="var(--accent)" opacity="0.85" />
              <circle r="46" fill="var(--bg-2)" />
            </g>
            <g :class="['ring-gear r2 rev', { active: running }]" :style="{ '--dur': '9s' }">
              <path :d="gearPath(40, 31, 12)" fill="var(--accent-2)" opacity="0.9" />
              <circle r="31" fill="var(--bg-2)" />
            </g>
            <g :class="['ring-gear r3', { active: running }]" :style="{ '--dur': '5s' }">
              <path :d="gearPath(22, 16, 8)" fill="var(--warn)" opacity="0.95" />
              <circle r="16" fill="var(--bg-2)" />
              <circle r="5" fill="var(--warn)" />
            </g>
          </g>
          <!-- 卫星小齿轮 -->
          <g transform="translate(312 44)"><circle r="16" :class="['mini-gear rev', { active: running }]" :style="{ '--dur': '4s' }" /></g>
          <g transform="translate(44 116)"><circle r="12" :class="['mini-gear', { active: running }]" :style="{ '--dur': '3.2s' }" /></g>
        </template>

        <!-- ===== 发条弹簧(非谓语动词) ===== -->
        <template v-else-if="theme === 'spring'">
          <circle cx="180" cy="76" r="96" fill="url(#centerGlow)" opacity="0.35" />
          <!-- 弹簧:非谓语的"蓄力" -->
          <g :class="['spring', { active: running }]">
            <path :d="springPoints" class="spring-coil" />
          </g>
          <!-- 两端齿轮 -->
          <g transform="translate(70 76)">
            <g :class="['gear', { active: running }]" :style="{ '--dur': '6s' }">
              <path :d="gearPath(44, 34, 11)" fill="var(--accent)" opacity="0.9" />
              <circle r="20" fill="var(--surface)" stroke="var(--accent)" stroke-width="1.5" />
              <circle r="5" fill="var(--accent)" />
            </g>
          </g>
          <g transform="translate(290 76)">
            <g :class="['gear rev', { active: running }]" :style="{ '--dur': '4.5s' }">
              <path :d="gearPath(36, 28, 9)" fill="var(--accent-2)" opacity="0.9" />
              <circle r="16" fill="var(--surface)" stroke="var(--accent-2)" stroke-width="1.5" />
              <circle r="4" fill="var(--accent-2)" />
            </g>
          </g>
          <!-- 弹簧顶部小球:被弹起 -->
          <circle cx="180" cy="24" r="6" :class="['spring-ball', { active: running }]" />
        </template>

        <!-- ===== 能量表盘(情态动词) ===== -->
        <template v-else-if="theme === 'power'">
          <circle cx="150" cy="86" r="82" fill="url(#centerGlow)" opacity="0.35" />
          <!-- 半圆表盘:能力/许可/义务的刻度 -->
          <g transform="translate(150 100)">
            <path d="M -62 0 A 62 62 0 0 1 62 0" class="gauge-arc" fill="none" />
            <line v-for="(t, i) in [-60, -30, 0, 30, 60]" :key="i" class="gauge-tick" :x1="Math.cos((t - 90) * Math.PI / 180) * 54" :y1="Math.sin((t - 90) * Math.PI / 180) * 54" :x2="Math.cos((t - 90) * Math.PI / 180) * 62" :y2="Math.sin((t - 90) * Math.PI / 180) * 62" />
            <g :class="['gauge-needle', { active: running }]">
              <circle r="46" fill="none" stroke="none" />
              <line x1="0" y1="8" x2="0" y2="-46" />
              <circle r="4" class="gauge-hub" />
            </g>
            <text x="0" y="18" text-anchor="middle" class="gauge-label">can · may · must</text>
          </g>
          <!-- 电源按钮:运转时脉冲充能 -->
          <g transform="translate(288 72)">
            <circle r="26" class="power-ring" :class="{ active: running }" />
            <circle r="26" fill="none" class="power-pulse" :class="{ active: running }" />
            <line x1="0" y1="-24" x2="0" y2="-8" class="power-stick" />
          </g>
        </template>

        <!-- ===== 天平(比较) ===== -->
        <template v-else-if="theme === 'balance'">
          <circle cx="180" cy="74" r="96" fill="url(#centerGlow)" opacity="0.35" />
          <!-- 支柱与底座 -->
          <line x1="180" y1="40" x2="180" y2="112" class="balance-post" />
          <path d="M 150 116 h 60" class="balance-base" />
          <!-- 横梁 + 吊盘:运转时左右摆动比大小 -->
          <g transform="translate(180 46)" :class="['balance-beam', { active: running }]">
            <line x1="-72" y1="0" x2="72" y2="0" class="balance-bar" />
            <circle r="4" class="balance-pivot" />
            <line x1="-72" y1="0" x2="-84" y2="26" class="balance-chain" />
            <line x1="-72" y1="0" x2="-60" y2="26" class="balance-chain" />
            <line x1="72" y1="0" x2="60" y2="26" class="balance-chain" />
            <line x1="72" y1="0" x2="84" y2="26" class="balance-chain" />
            <path d="M -96 26 a 12 12 0 0 0 24 0 z" class="balance-pan" />
            <path d="M 60 26 a 12 12 0 0 0 24 0 z" class="balance-pan" />
            <text x="-84" y="52" text-anchor="middle" class="balance-sym">-er</text>
            <text x="84" y="52" text-anchor="middle" class="balance-sym">-est</text>
          </g>
          <!-- 伴动小齿轮 -->
          <g transform="translate(50 110)"><circle r="14" :class="['mini-gear', { active: running }]" :style="{ '--dur': '5s' }" /></g>
          <g transform="translate(314 110)"><circle r="14" :class="['mini-gear rev', { active: running }]" :style="{ '--dur': '3.6s' }" /></g>
        </template>

        <!-- ===== 闪电霓虹电路板(虚拟语气) ===== -->
        <template v-else-if="theme === 'neon'">
          <circle cx="180" cy="70" r="98" fill="url(#neonGlow)" opacity="0.5" />
          <!-- PCB 走线 + 焊点 -->
          <path v-for="(t, i) in traces" :key="i" :d="t" class="neon-trace" :class="{ active: running }" :style="{ '--d': `${i * 0.35}s` }" />
          <circle v-for="(t, i) in [[60, 100], [84, 118], [120, 46], [130, 92], [300, 96], [322, 66], [288, 118], [288, 40], [216, 34]]" :key="'p' + i" :cx="t[0]" :cy="t[1]" r="3" class="neon-node" :class="{ active: running }" :style="{ '--d': `${i * 0.25}s` }" />
          <!-- 主闪电:虚拟现实的"不可能能量" -->
          <path d="M 186 14 L 148 62 L 172 62 L 152 116 L 214 54 L 188 54 Z" class="neon-bolt" :class="{ active: running }" />
          <!-- 芯片 -->
          <rect x="246" y="88" width="40" height="26" rx="5" class="neon-chip" :class="{ active: running }" />
          <line x1="254" y1="114" x2="254" y2="122" class="neon-pin" />
          <line x1="264" y1="114" x2="264" y2="122" class="neon-pin" />
          <line x1="274" y1="114" x2="274" y2="122" class="neon-pin" />
          <line x1="254" y1="80" x2="254" y2="88" class="neon-pin" />
          <line x1="264" y1="80" x2="264" y2="88" class="neon-pin" />
          <line x1="274" y1="80" x2="274" y2="88" class="neon-pin" />
        </template>

        <!-- ===== 传送带分流(特殊句型) ===== -->
        <template v-else-if="theme === 'conveyor'">
          <circle cx="180" cy="70" r="92" fill="url(#centerGlow)" opacity="0.3" />
          <!-- 滚轮 -->
          <g transform="translate(96 106)"><g :class="['belt-wheel', { active: running }]" :style="{ '--dur': '2.4s' }"><circle r="17" /><line x1="-13" y1="0" x2="13" y2="0" /><line x1="0" y1="-13" x2="0" y2="13" /><circle r="3" class="hub" /></g></g>
          <g transform="translate(264 106)"><g :class="['belt-wheel', { active: running }]" :style="{ '--dur': '2.4s' }"><circle r="17" /><line x1="-13" y1="0" x2="13" y2="0" /><line x1="0" y1="-13" x2="0" y2="13" /><circle r="3" class="hub" /></g></g>
          <!-- 传送带面 -->
          <line x1="79" y1="89" x2="281" y2="89" class="belt-line" :class="{ active: running }" />
          <line x1="79" y1="123" x2="281" y2="123" class="belt-line" :class="{ active: running }" />
          <!-- 分流阀:句子向两条支线分流 -->
          <circle cx="180" cy="60" r="13" class="junction" :class="{ active: running }" />
          <line x1="180" y1="73" x2="180" y2="86" class="branch-pipe" />
          <path d="M 316 89 q 24 -14 40 -34" class="branch-pipe" fill="none" />
          <path d="M 316 123 q 24 14 40 34" class="branch-pipe" fill="none" />
          <!-- 带上零件箱:运转时滑过 -->
          <g :class="['belt-item i1', { active: running }]"><rect x="-11" y="-9" width="22" height="18" rx="3" /><line x1="-11" y1="-2" x2="11" y2="-2" /></g>
          <g :class="['belt-item i2', { active: running }]"><rect x="-9" y="-8" width="18" height="16" rx="3" /><line x1="-9" y1="0" x2="9" y2="0" /></g>
        </template>
      </svg>
    </div>

    <!-- 零件装配区 -->
    <div class="parts-track">
      <TransitionGroup name="part">
        <span
          v-for="(p, i) in parts" :key="p.label + p.value"
          class="part"
          :class="{ ok: running }"
        >
          <small>{{ p.label }}</small>
          <span class="part-val">{{ p.value }}</span>
        </span>
        <span v-if="!parts.length" key="empty" class="part empty">暂无零件,答对题目就能装配亮起</span>
      </TransitionGroup>
    </div>

    <!-- 全对时的"装配完成"火苗 -->
    <Transition name="flame">
      <div v-if="running && parts.length" class="flame-row">
        <svg class="flame" viewBox="0 0 16 16" width="18" height="18" aria-hidden="true">
          <path d="M8 1c.6 2.6-3.2 4-3.2 7a3.2 3.2 0 0 0 6.4 0c0-1-.4-2-1.1-2.7.2 1.3-.7 2-1.4 1.4C10.3 5 8.9 3.3 8 1z" fill="var(--warn)" />
        </svg>
        <span class="flame-text">装配完成,机器转起来了</span>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.machine { position: relative; }
.gear-stage {
  width: 100%; height: 160px; border-radius: 14px; overflow: hidden;
  background:
    linear-gradient(180deg, var(--surface-sunken), var(--bg-2)),
    repeating-linear-gradient(45deg, transparent 0 14px, color-mix(in srgb, var(--text) 4%, transparent) 14px 28px);
  border: 1px solid var(--line); margin: 6px 0 14px;
  position: relative;
}
.theme-neon .gear-stage {
  background:
    linear-gradient(180deg, var(--surface-sunken), var(--bg-2)),
    repeating-linear-gradient(0deg, transparent 0 18px, color-mix(in srgb, var(--accent) 3%, transparent) 18px 19px);
}
.gear-svg { width: 100%; height: 100%; display: block; }

/* ---- 通用:旋转齿轮 ---- */
.gear { transform-box: fill-box; transform-origin: center; }
.gear.active { animation: spin var(--dur, 8s) linear infinite; }
.gear.active.rev { animation: spinRev var(--dur, 8s) linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
@keyframes spinRev { to { transform: rotate(-360deg); } }

.mini-gear {
  fill: var(--accent); opacity: 0.8; stroke: var(--accent-2); stroke-width: 2;
  stroke-dasharray: 4 3;
  transform-box: fill-box; transform-origin: center;
}
.mini-gear.active { animation: spin var(--dur, 5s) linear infinite; }
.mini-gear.active.rev { animation: spinRev var(--dur, 5s) linear infinite; }

.belt-flow { stroke-dashoffset: 0; animation: beltMove 0.6s linear infinite; }
@keyframes beltMove { to { stroke-dashoffset: -20; } }

/* ---- 时态:时间齿轮组 ---- */
.clock-face { fill: var(--surface); stroke: var(--accent); stroke-width: 2; }
.clock-tick { stroke: var(--text-3); stroke-width: 1.5; }
.clock-tick.major { stroke: var(--accent); stroke-width: 2.5; }
.clock-hand line { stroke: var(--text); stroke-width: 3; stroke-linecap: round; }
.clock-hand.minute line { stroke: var(--accent); }
.clock-hand.hour line { stroke: var(--warn); }
.clock-hand { transform-box: fill-box; transform-origin: center; }
.clock-hand.minute.active { animation: spin 10s linear infinite; }
.clock-hand.hour.active { animation: spin 60s linear infinite; }
.clock-hub { fill: var(--accent); }

/* ---- 语态:翻转齿轮 ---- */
.flip-gear { transform-box: fill-box; transform-origin: center; }
.flip-gear.active { animation: flipSpin var(--dur, 7s) linear infinite; }
.flip-gear.active.rev { animation: flipSpinRev var(--dur, 7s) linear infinite; }
@keyframes flipSpin { 0% { transform: rotate(0) scaleY(1); } 50% { transform: rotate(180deg) scaleY(-1); } 100% { transform: rotate(360deg) scaleY(1); } }
@keyframes flipSpinRev { 0% { transform: rotate(0) scaleY(-1); } 50% { transform: rotate(-180deg) scaleY(1); } 100% { transform: rotate(-360deg) scaleY(-1); } }
.flip-arrow { stroke: var(--accent); stroke-width: 2; stroke-linecap: round; }
.lifter { transform-box: fill-box; transform-origin: center; }
.lifter-rod { fill: var(--accent-2); opacity: 0.85; }
.lifter-tip { fill: var(--accent-2); }
.lifter.active { animation: lift 1.4s ease-in-out infinite alternate; }
@keyframes lift { from { transform: translateY(0); } to { transform: translateY(14px); } }

/* ---- 从句:嵌套齿轮环 ---- */
.ring-gear { transform-box: fill-box; transform-origin: center; }
.ring-gear.active { animation: spin var(--dur, 12s) linear infinite; }
.ring-gear.active.rev { animation: spinRev var(--dur, 12s) linear infinite; }

/* ---- 非谓语:发条弹簧 ---- */
.spring { transform-box: fill-box; transform-origin: center; }
.spring-coil { fill: none; stroke: var(--accent-2); stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; }
.spring.active { animation: coil 1.1s ease-in-out infinite; }
@keyframes coil { 0%, 100% { transform: scaleY(1); } 50% { transform: scaleY(0.78); } }
.spring-ball { fill: var(--warn); opacity: 0.9; }
.spring-ball.active { animation: bounce 1.1s ease-in infinite; }
@keyframes bounce { 0%, 100% { transform: translateY(0); } 55% { transform: translateY(-10px); } }

/* ---- 情态:能量表盘 ---- */
.gauge-arc { stroke: var(--line-accent); stroke-width: 3; }
.gauge-tick { stroke: var(--text-3); stroke-width: 2; }
.gauge-needle { transform-box: fill-box; transform-origin: center; }
.gauge-needle line { stroke: var(--accent); stroke-width: 3; stroke-linecap: round; }
.gauge-hub { fill: var(--accent); }
.gauge-label { font-family: var(--mono); font-size: var(--fs-2xs); fill: var(--text-3); }
.gauge-needle.active { animation: sweep 2.6s ease-in-out infinite alternate; }
@keyframes sweep { from { transform: rotate(-70deg); } to { transform: rotate(70deg); } }
.power-ring { fill: none; stroke: var(--accent); stroke-width: 3; }
.power-stick { stroke: var(--accent); stroke-width: 5; stroke-linecap: round; }
.power-pulse { fill: none; stroke: var(--accent); stroke-width: 2; transform-box: fill-box; transform-origin: center; }
.power-pulse.active { animation: pulse 1.6s ease-out infinite; }
@keyframes pulse { 0% { transform: scale(0.8); opacity: 0.9; } 100% { transform: scale(1.7); opacity: 0; } }

/* ---- 比较:天平 ---- */
.balance-post { stroke: var(--text-3); stroke-width: 3; }
.balance-base { stroke: var(--text-3); stroke-width: 4; stroke-linecap: round; }
.balance-bar { stroke: var(--accent); stroke-width: 3.5; stroke-linecap: round; }
.balance-pivot { fill: var(--warn); }
.balance-chain { stroke: var(--line-accent); stroke-width: 1.5; }
.balance-pan { fill: var(--surface); stroke: var(--accent-2); stroke-width: 2; }
.balance-sym { font-family: var(--mono); font-size: var(--fs-2xs); fill: var(--text-3); }
.balance-beam { transform-box: fill-box; transform-origin: center top; }
.balance-beam.active { animation: tilt 2s ease-in-out infinite alternate; }
@keyframes tilt { from { transform: rotate(-7deg); } to { transform: rotate(7deg); } }

/* ---- 虚拟语气:闪电霓虹电路板 ---- */
.neon-trace { fill: none; stroke: var(--accent-2); stroke-width: 1.5; opacity: 0.35; }
.neon-trace.active { animation: traceFlow 1.8s linear infinite; animation-delay: var(--d, 0s); }
@keyframes traceFlow { 0%, 100% { opacity: 0.25; } 50% { opacity: 0.9; filter: drop-shadow(0 0 4px var(--accent-2)); } }
.neon-node { fill: var(--accent-2); opacity: 0.4; }
.neon-node.active { animation: traceFlow 1.8s ease-in-out infinite; animation-delay: var(--d, 0s); }
.neon-bolt { fill: var(--warn); opacity: 0.5; }
.neon-bolt.active { animation: boltFlicker 1.2s steps(2) infinite, boltGlow 1.2s linear infinite; }
@keyframes boltFlicker { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
@keyframes boltGlow { 0%, 100% { filter: drop-shadow(0 0 6px var(--warn)); } 50% { filter: drop-shadow(0 0 14px var(--warn)); } }
.neon-chip { fill: var(--surface); stroke: var(--accent-2); stroke-width: 1.5; opacity: 0.9; }
.neon-chip.active { animation: traceFlow 2.4s ease-in-out infinite; }
.neon-pin { stroke: var(--accent-2); stroke-width: 2; opacity: 0.7; }

/* ---- 特殊句型:传送带分流 ---- */
.belt-wheel circle { fill: var(--surface); stroke: var(--accent); stroke-width: 2.5; }
.belt-wheel line { stroke: var(--accent); stroke-width: 2; }
.belt-wheel .hub { fill: var(--accent); }
.belt-wheel { transform-box: fill-box; transform-origin: center; }
.belt-wheel.active { animation: spin var(--dur, 2.4s) linear infinite; }
.belt-line { stroke: var(--line-accent); stroke-width: 2; stroke-dasharray: 6 4; }
.belt-line.active { animation: beltMove 0.5s linear infinite; }
.junction { fill: var(--surface); stroke: var(--warn); stroke-width: 2.5; stroke-dasharray: 4 3; transform-box: fill-box; transform-origin: center; }
.junction.active { animation: spin 3s linear infinite; }
.branch-pipe { stroke: var(--line-accent); stroke-width: 2; }
.belt-item { transform-box: view-box; }
.belt-item rect { fill: var(--accent-soft); stroke: var(--accent); stroke-width: 1.5; }
.belt-item line { stroke: var(--accent); stroke-width: 1; opacity: 0.6; }
.belt-item.active { animation: beltCarry 3s linear infinite; }
.belt-item.i2.active { animation-duration: 4.5s; animation-delay: 1.2s; }
@keyframes beltCarry { from { transform: translate(60px, 89px); } to { transform: translate(310px, 89px); } }

/* ---- 零件装配区 ---- */
.parts-track { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin: 8px 0 0; min-height: 36px; }
.part {
  display: inline-flex; flex-direction: column; align-items: center;
  padding: 7px 14px; border-radius: 10px; gap: 2px;
  background: var(--surface); border: 1px solid var(--line-accent);
  font-size: var(--fs-base); color: var(--text); transition: all 0.3s var(--ease);
}
.part.ok { background: var(--accent-soft); border-color: var(--accent); color: var(--text); box-shadow: 0 0 12px var(--accent-soft); }
.part small { font-size: var(--fs-2xs); color: var(--text-3); letter-spacing: 0.04em; }
.part-val { font-weight: 600; }
.part.empty { font-size: var(--fs-sm); color: var(--text-3); border-style: dashed; background: transparent; }

.part-enter-active, .part-leave-active { transition: all 0.4s var(--ease-snap); }
.part-enter-from { opacity: 0; transform: translateX(-12px) scale(0.85); }

.flame-row { display: flex; align-items: center; gap: 8px; margin-top: 10px; color: var(--success); }
.flame { display: inline-block; animation: flameWiggle 0.6s ease-in-out infinite alternate; }
.flame-text { font-size: var(--fs-sm); font-weight: 600; }
@keyframes flameWiggle { to { transform: translateY(-2px) scale(1.06); } }
.flame-enter-active, .flame-leave-active { transition: all 0.4s var(--ease-snap); }
.flame-enter-from, .flame-leave-to { opacity: 0; transform: scale(0.7); }
</style>
