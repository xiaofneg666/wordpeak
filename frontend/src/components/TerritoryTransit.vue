<script setup>
// 领地过场(Territorial Transit):视图切换时全屏星流 + 领地名浮现
// 由 App.vue 驱动 —— watch store.view 后先盖过场、盖住期间换视图、再淡出
// 生命周期 ~0.9s,只在存活的这段时间里跑自己的 Canvas 星流(径向外流=航渡感)
import { ref, onMounted } from 'vue'

const props = defineProps({ transit: { type: Object, required: true } }) // { zh, latin, k }

const cvs = ref(null)

onMounted(() => {
  const c = cvs.value
  if (!c) return
  const ctx = c.getContext('2d')
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  c.width = Math.round(c.clientWidth * dpr)
  c.height = Math.round(c.clientHeight * dpr)
  const w = c.width, h = c.height, cx = w / 2, cy = h / 2
  const maxR = Math.hypot(cx, cy)
  let accent = ''
  try {
    accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()
  } catch { /* 沿用白星 */ }

  // 星流:从中心附近向外流的短划线,20% 染家族色(青/紫,读 CSS 变量)
  const N = 120
  const stars = Array.from({ length: N }, () => {
    const v = 100 + Math.random() * 340
    return {
      a: Math.random() * Math.PI * 2,
      r: Math.random() * maxR * 0.3,
      v: v * dpr,
      tinted: Math.random() < 0.18,
    }
  })
  let t0 = 0
  let start = 0
  const frame = (ts) => {
    if (!start) start = ts
    if (!t0) t0 = ts
    const dt = Math.min(0.05, (ts - t0) / 1000)
    t0 = ts
    ctx.clearRect(0, 0, w, h)
    ctx.lineCap = 'round'
    for (const s of stars) {
      s.r += s.v * dt
      if (s.r > maxR) { s.r = 0; s.a = Math.random() * Math.PI * 2 }
      // 越远越亮(近中心刚出生的星最暗)——像从你身边掠过去
      const alpha = Math.min(0.75, 0.08 + (s.r / maxR) * 0.9)
      const len = (3 + (s.r / maxR) * 26) * dpr
      ctx.globalAlpha = alpha
      ctx.strokeStyle = s.tinted && accent ? accent : 'rgba(196,210,240,1)'
      ctx.lineWidth = 1.1 * dpr
      ctx.beginPath()
      ctx.moveTo(cx + Math.cos(s.a) * s.r, cy + Math.sin(s.a) * s.r)
      ctx.lineTo(cx + Math.cos(s.a) * (s.r + len), cy + Math.sin(s.a) * (s.r + len))
      ctx.stroke()
    }
    ctx.globalAlpha = 1
    // 过场存活 ~0.9s,超时(兜底 2s)或组件已卸载就不再排帧
    if (ts - start < 2000 && document.body.contains(c)) requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
})
</script>

<template>
  <div class="territory-transit" :key="transit.k" aria-hidden="true">
    <canvas ref="cvs" class="tt-stars" />
    <div class="tt-name">
      <div class="tt-rule" />
      <div class="tt-zh">{{ transit.zh }}</div>
      <div class="tt-latin">{{ transit.latin }}</div>
    </div>
  </div>
</template>

<style scoped>
.territory-transit {
  position: fixed; inset: 0; z-index: 240;
  background: var(--bg);
  display: flex; align-items: center; justify-content: center;
  pointer-events: none; /* 过场不拦截点击,快速连点的用户不被卡住 */
}
.tt-stars { position: absolute; inset: 0; width: 100%; height: 100%; }
.tt-name { position: relative; text-align: center; }

/* 领地名:刻线 → 衬线中文(字距收拢) → mono 拉丁,与圣殿章节字幕同一运动语汇 */
.tt-rule {
  width: 46px; height: 1px; margin: 0 auto 18px;
  background: var(--accent);
  transform-origin: center;
  animation: ttRule 0.5s var(--ease) backwards;
}
@keyframes ttRule { from { transform: scaleX(0); opacity: 0 } }

.tt-zh {
  font-family: var(--serif);
  font-size: clamp(34px, 6vw, 54px);
  font-weight: 600; color: var(--text);
  animation: ttZh 0.6s var(--ease) 0.1s backwards;
}
@keyframes ttZh {
  from { opacity: 0; filter: blur(4px); letter-spacing: 0.55em; margin-left: 0.55em }
  to { filter: blur(0); letter-spacing: 0.3em; margin-left: 0.3em }
}
/* 终态字距必须留在动画里(margin 补偿居中),所以 to 不能省 */

.tt-latin {
  margin-top: 14px;
  font-family: var(--mono);
  font-size: var(--fs-2xs); letter-spacing: 0.5em; margin-left: 0.5em;
  color: var(--accent); opacity: 0.85;
  animation: ttLatin 0.5s var(--ease) 0.3s backwards;
}
@keyframes ttLatin { from { opacity: 0; filter: blur(4px) } }

@media (prefers-reduced-motion: reduce) {
  .tt-rule, .tt-zh, .tt-latin { animation-duration: 0.01s }
  .tt-stars { display: none }
}
</style>
