<script setup>
import { ref, computed, watch, onUnmounted } from 'vue'
import { resolvePhoneme, PLACES } from '../phoneticsData'

const props = defineProps({
  symbol: { type: String, required: true },
  animate: { type: Boolean, default: true },
})

// 静态解剖结构坐标（矢状面，面向左侧：唇在左，咽喉在右）
const PALATE = 'M 66 128 Q 130 100 196 104'          // 硬腭
const TEETH_TOP = 'M 62 128 l 8 0 l 0 12 l -8 0 Z'    // 上齿
const NASAL = 'M 205 92 C 150 34 84 34 58 54'          // 鼻腔上壁
const NASAL_LOW = 'M 205 106 C 148 58 90 58 64 74'     // 鼻腔下壁
const HEAD = 'M 262 10 Q 118 6 76 44 Q 42 78 42 120 Q 42 156 60 182 Q 74 210 108 228 L 108 258 L 258 258 L 262 150 Z'

// 由发音参数生成舌头路径（d 属性随参数平滑过渡）
function tonguePath({ f, h }) {
  const tipY = 152 - h * 30          // 舌尖高度
  const humpX = 236 - f * 164        // 隆起前后位置
  const humpY = 176 - h * 58         // 隆起高度
  return `M 60 ${tipY} Q ${humpX} ${humpY} 248 202 L 246 216 Q 150 ${humpY + 46} 68 ${tipY + 24} Z`
}

// 唇形：aperture 开口(0闭-1开) round 圆唇 spread 展唇
function lips(aperture, round, spread) {
  const a = Math.max(aperture, 0)
  const x = 40 - (round ? 9 : 0) - (spread ? -5 : 0)
  const mid = 34 + (round ? 4 : 0)
  const topY = 130, botY = 134 + a * 26
  const upper = `M ${x - 12} ${topY} Q ${mid} ${topY - (round ? 2 : 8)} ${x + 18} ${topY + 2}`
  const lower = `M ${x - 12} ${botY} Q ${mid} ${botY + (round ? 2 : 8)} ${x + 18} ${botY - 2}`
  return { upper, lower, closed: a < 0.06 }
}

function phonemeParams(p) {
  if (!p) return null
  if (p.kind === 'vowel') {
    const a = (1 - p.h * 0.85) * (p.r ? 0.62 : 1)
    return { tongue: { f: p.f, h: p.h }, lips: lips(a, p.r, !p.r && p.h > 0.8), nasal: false, voiced: true, p }
  }
  if (p.kind === 'diph') {
    // 双元音由调用方切换 from/to
    const a = (1 - p.h * 0.85) * (p.r ? 0.62 : 1)
    return { tongue: { f: p.f, h: p.h }, lips: lips(a, p.r, false), nasal: false, voiced: true, p: { ...p, kind: 'vowel' } }
  }
  // 辅音
  const isClosed = ['stop', 'nasal', 'affr'].includes(p.manner)
  const aperture = p.manner === 'approx' ? 0.35 : p.place === 'bi' ? 0 : 0.16
  const lp = p.manner === 'lat' || p.place === 'bi' ? lips(0.45, p.rounded, false) : lips(aperture, p.rounded, false)
  return {
    tongue: { f: p.f, h: isClosed ? Math.max(p.h, 0.72) : p.h + 0.12 },
    lips: lp, nasal: !!p.nasal, voiced: p.voiced, p, place: PLACES[p.place]?.label,
  }
}

const p = computed(() => resolvePhoneme(props.symbol))

// 双元音：舌位在两个目标间往返滑动
const diphPhase = ref(0)
let timer = null
watch(() => props.symbol, () => {
  clearInterval(timer)
  timer = null
  diphPhase.value = 0
  if (p.value && p.value.kind === 'diph') {
    timer = setInterval(() => { diphPhase.value = 1 - diphPhase.value }, 950)
  }
}, { immediate: true })
onUnmounted(() => clearInterval(timer))

const cur = computed(() => (p.value?.kind === 'diph' ? (diphPhase.value === 0 ? p.value.from : p.value.to) : p.value))
const prm = computed(() => phonemeParams(p.value?.kind === 'diph' ? { kind: 'vowel', ...cur.value } : p.value))
const tPath = computed(() => prm.value && tonguePath(prm.value.tongue))
const fricGap = computed(() => prm.value?.p?.manner === 'fric' || prm.value?.p?.manner === 'affr')
const voicing = computed(() => prm.value?.voiced)
const flowColor = computed(() => (props.animate ? 'color-mix(in srgb, var(--accent) 80%, transparent)' : 'transparent'))
// 主题色 token(SVG 文本/线条的 fill 与 stroke 跟随当前主题)
const textFill = 'var(--text-3)'
const labelFill = 'var(--text-2)'
</script>

<template>
  <svg v-if="p" width="330" height="270" viewBox="0 0 320 270" style="display: block">
    <defs>
      <linearGradient id="tg" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#e88a9a" /><stop offset="100%" stop-color="#a34d63" />
      </linearGradient>
      <!-- 腔体氛围辉光跟主题 accent 走(四套主题自动换色) -->
      <radialGradient id="cav" cx="40%" cy="40%">
        <stop offset="0%" stop-color="color-mix(in srgb, var(--accent) 10%, transparent)" /><stop offset="100%" stop-color="transparent" />
      </radialGradient>
    </defs>

    <!-- 头部轮廓 -->
    <path :d="HEAD" fill="color-mix(in srgb, var(--info) 4.5%, transparent)" stroke="color-mix(in srgb, var(--info) 16%, transparent)" stroke-width="1.5" />
    <!-- 鼻腔 -->
    <path
      :d="`${NASAL} L 205 106 ${NASAL_LOW.replace('M', 'L').replace(/C/, 'C')} Z`"
      fill="color-mix(in srgb, var(--accent-2) 10%, transparent)" stroke="color-mix(in srgb, var(--accent-2) 35%, transparent)" stroke-width="1.2"
    />
    <text x="120" y="42" font-size="10" :fill="textFill">鼻腔 Nasal</text>
    <!-- 硬腭 + 上齿(骨结构色走 text 派生:深空里亮骨白,晴空里深墨线,四主题都看得清) -->
    <path :d="PALATE" fill="none" stroke="color-mix(in srgb, var(--text) 55%, transparent)" stroke-width="3" stroke-linecap="round" />
    <path :d="TEETH_TOP" fill="color-mix(in srgb, var(--text) 72%, transparent)" opacity=".85" />
    <text x="128" y="94" font-size="10" :fill="textFill">硬腭 Palate</text>

    <!-- 咽壁 -->
    <path d="M 252 96 L 252 208" stroke="color-mix(in srgb, var(--text) 32%, transparent)" stroke-width="3" stroke-linecap="round" />
    <text x="256" y="160" font-size="10" :fill="textFill" text-anchor="middle" transform="rotate(90 258 156)">咽 Pharynx</text>

    <!-- 舌头（核心动画） -->
    <path class="mouth-tongue" :d="tPath" fill="url(#tg)" stroke="#7e3a4d" stroke-width="1.5" opacity=".95" />
    <text x="150" y="188" font-size="10" fill="var(--text-2)">Tongue 舌</text>

    <!-- 唇 -->
    <path class="mouth-lip" :d="prm.lips.upper" fill="none" stroke="#e88a9a" stroke-width="8" stroke-linecap="round" />
    <path class="mouth-lip" :d="prm.lips.lower" fill="none" stroke="#c96a7c" stroke-width="8" stroke-linecap="round" />

    <!-- 声带 -->
    <g>
      <rect x="150" y="222" width="64" height="30" rx="6" fill="color-mix(in srgb, var(--info) 8%, transparent)" stroke="color-mix(in srgb, var(--info) 30%, transparent)" />
      <path
        :class="voicing ? 'voice-bars' : ''"
        d="M 158 237 l 6 -7 l 6 14 l 6 -14 l 6 14 l 6 -14 l 6 14 l 6 -7"
        fill="none" :stroke="voicing ? 'var(--accent)' : 'var(--text-4)'" stroke-width="2.2" stroke-linecap="round"
        style="transform-origin: 182px 237px"
      />
      <text x="182" y="248" font-size="9" :fill="voicing ? 'var(--accent)' : textFill" text-anchor="middle">
        {{ voicing ? '声带振动' : '声带静止' }}
      </text>
    </g>

    <!-- 气流 -->
    <path
      class="flow"
      :d="prm.nasal
        ? 'M 244 200 C 210 150 214 110 205 96 C 150 40 90 44 60 52'
        : 'M 244 200 C 210 160 150 140 56 142'"
      fill="none" :stroke="flowColor" stroke-width="2.5" stroke-linecap="round"
    />
    <text v-if="prm.nasal" x="150" y="60" font-size="10" fill="var(--accent-2)">鼻腔气流</text>

    <!-- 摩擦湍流 -->
    <g v-if="fricGap" fill="var(--accent)">
      <circle cx="52" cy="136" r="2.4" class="turb" style="animation-delay: 0s" />
      <circle cx="60" cy="146" r="1.8" class="turb" style="animation-delay: .2s" />
      <circle cx="48" cy="150" r="2" class="turb" style="animation-delay: .4s" />
    </g>

    <!-- 双元音滑动提示 -->
    <text v-if="p.kind === 'diph'" x="160" y="262" font-size="11" fill="var(--warn)" text-anchor="middle">
      ↔ 双元音滑动：{{ cur === p.to ? '滑动终点' : '滑动起点' }}
    </text>
  </svg>
</template>
