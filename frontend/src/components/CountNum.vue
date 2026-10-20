<script setup>
// 数字滚动(motion-primitives · Animated Counter 零依赖复刻)
// 全局注册(main.js),视图把大号统计数字换成 <CountNum :v="stats.learned" mono />;
// 挂载时从 0 数到目标值(quint-out 曲线,对应 open-props --ease-quint-out 的 JS 版),
// 值变化时从旧值滚到新值;prefers-reduced-motion 直接显示终值。
// 只吃整数;非数字(字符串/undefined)原样透传,不炸。
import { ref, watch, onMounted, onUnmounted } from 'vue'

const props = defineProps({
  v: { type: [Number, String], default: 0 },
  // 滚动时长(ms)
  duration: { type: Number, default: 1100 },
  // 等宽数字(数据看板磁贴用)
  mono: { type: Boolean, default: false },
})

const reduced = typeof matchMedia !== 'undefined'
  && matchMedia('(prefers-reduced-motion: reduce)').matches

const display = ref(props.v)
let from = 0
let raf = 0
let watchdog = 0

function isNum(v) { return typeof v === 'number' && isFinite(v) }

function animate(to) {
  cancelAnimationFrame(raf)
  clearTimeout(watchdog)
  if (!isNum(to) || reduced) { display.value = to; from = isNum(to) ? to : 0; return }
  const start = performance.now()
  const a = from
  const ease = (t) => 1 - Math.pow(1 - t, 5) // quint-out
  // 渲染冻结的 webview 里 rAF 永不回调:350ms 等不到首帧就直落终值,避免卡在旧值
  let gotFrame = false, ended = false
  watchdog = setTimeout(() => {
    if (!gotFrame && !ended) { ended = true; from = to; display.value = to }
  }, 350)
  const step = (now) => {
    if (ended) return
    gotFrame = true
    const t = Math.min(1, (now - start) / props.duration)
    display.value = Math.round(a + (to - a) * ease(t))
    if (t < 1) raf = requestAnimationFrame(step)
    else { ended = true; from = to }
  }
  raf = requestAnimationFrame(step)
}

onMounted(() => animate(Number(props.v)))
watch(() => props.v, (nv) => animate(Number(nv)))
onUnmounted(() => { cancelAnimationFrame(raf); clearTimeout(watchdog) })
</script>

<template>
  <span class="count-num" :class="{ mono }">{{ display }}</span>
</template>

<style scoped>
.count-num { font-variant-numeric: tabular-nums; }
.count-num.mono { font-family: var(--mono); letter-spacing: -0.02em; }
</style>
