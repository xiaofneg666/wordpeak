<script setup>
// 共享星尘背景层:所有"普通页面"悬浮在活星空上
// 页面内容 = 宇宙中悬浮的物体,不再是贴在纯色底上的卡片
// 单 Canvas2D · 30fps 封顶 · 页面隐藏暂停 · lowEnd 减粒 · 晴空主题画淡墨尘
import { ref, onMounted, onUnmounted, watch } from 'vue'
import { useUniverse } from '../stores/universe'

const store = useUniverse()
const cvs = ref(null)

let raf = 0
let onMove, onWheel, onResize, onTheme
let cleanup = () => {}

const lowEnd = (navigator.hardwareConcurrency || 8) < 4
const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches

function hexRgb(hex) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec((hex || '').trim())
  if (!m) return null
  const s = m[1]
  const full = s.length === 3 ? [...s].map((c) => c + c).join('') : s
  return `${parseInt(full.slice(0, 2), 16)},${parseInt(full.slice(2, 4), 16)},${parseInt(full.slice(4, 6), 16)}`
}

onMounted(() => {
  const c = cvs.value
  if (!c) return
  const ctx = c.getContext('2d')
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  let w = 0, h = 0
  let light = false
  let tint1 = '34,211,238', tint2 = '167,139,250'
  const DIM = '190,205,235'

  function readTheme() {
    try {
      const cs = getComputedStyle(document.documentElement)
      tint1 = hexRgb(cs.getPropertyValue('--accent')) || tint1
      tint2 = hexRgb(cs.getPropertyValue('--accent-2')) || tint2
      light = document.documentElement.getAttribute('data-theme') === 'light'
    } catch { /* 读不到沿用缓存 */ }
  }
  readTheme()

  // 星尘:归一化坐标(resize 不重排)· 闪烁相位 · 慢速下沉漂移 · 视差深度 · 少量家族色点缀
  // 数量与亮度都收着来:背景层永远不能跟内容抢眼睛(用户反馈「乱了/看不清」后调减)
  const N = lowEnd ? 50 : 90
  const stars = Array.from({ length: N }, () => ({
    x: Math.random(), y: Math.random(),
    r: 0.5 + Math.random() * 1.1,
    ph: Math.random() * Math.PI * 2,
    sp: 0.25 + Math.random() * 0.7,
    dx: (Math.random() - 0.5) * 3,     // px/s,慢到几乎察觉不到
    dy: 1.5 + Math.random() * 2.5,
    z: 0.3 + Math.random() * 0.7,
    tint: Math.random() < 0.05 ? 1 : (Math.random() < 0.05 ? 2 : 0),
  }))

  function resize() {
    w = c.width = Math.max(1, Math.round(window.innerWidth * dpr))
    h = c.height = Math.max(1, Math.round(window.innerHeight * dpr))
  }
  resize()

  // 光标视差:整个星野随指针极轻微反相漂(平滑跟),世界回应你的身体
  let px = 0, py = 0, sx = 0, sy = 0
  onMove = (e) => {
    px = (e.clientX / window.innerWidth - 0.5) * 2
    py = (e.clientY / window.innerHeight - 0.5) * 2
  }
  // 滚动景深:滚页面时近星(z 大)比远星错位多漂一点,滚完弹性归位 —— 页面滚动有了纵深
  let boost = 0
  onWheel = (e) => {
    boost = Math.max(-46, Math.min(46, boost + e.deltaY * 0.06))
  }
  onResize = resize
  onTheme = readTheme
  window.addEventListener('pointermove', onMove)
  window.addEventListener('wheel', onWheel, { passive: true })
  window.addEventListener('resize', onResize)
  window.addEventListener('wv:themechange', onTheme)

  let last = 0
  const frame = (ts) => {
    raf = requestAnimationFrame(frame)
    if (document.hidden || ts - last < 33) return // 30fps 封顶,背景层永不抢前台帧
    const dt = Math.min(0.12, (ts - last) / 1000)
    last = ts
    if (!reduceMotion) {
      sx += (px - sx) * Math.min(1, dt * 3)
      sy += (py - sy) * Math.min(1, dt * 3)
    }
    boost *= Math.exp(-dt * 2.4) // 滚动冲量按秒衰减,星野慢慢躺回原位
    ctx.clearRect(0, 0, w, h)
    const t = ts / 1000
    for (const s of stars) {
      s.x += (s.dx * dt * dpr) / w
      s.y += (s.dy * dt * dpr) / h
      if (s.y > 1.02) { s.y = -0.02; s.x = Math.random() }
      if (s.x > 1.02) s.x = -0.02
      if (s.x < -0.02) s.x = 1.02
      const tw = 0.55 + 0.45 * Math.sin(t * s.sp * 2 + s.ph)
      let rgb, alpha
      if (light) {
        // 晴空:白天看不见星星,只留极淡的浮尘感(再明显就在白屏上显脏)
        rgb = '83,102,140'
        alpha = 0.025 + 0.03 * tw
      } else {
        rgb = s.tint === 1 ? tint1 : s.tint === 2 ? tint2 : DIM
        alpha = (s.tint ? 0.2 : 0.1) * tw + 0.03
      }
      const par = reduceMotion ? 0 : s.z * 16 * dpr
      const X = s.x * w - sx * par
      const Y = s.y * h - sy * par - boost * s.z * dpr
      const sz = s.r * dpr
      ctx.fillStyle = `rgba(${rgb},${alpha})`
      ctx.fillRect(X, Y, sz, sz)
    }
  }
  raf = requestAnimationFrame(frame)

  // 词汇圣殿自己就是整片星空:进去时彻底停帧(v-show 只藏画布,rAF 仍空转),
  // 出来时重新挂帧,last 归零避免一帧 dt 巨大;immediate 兜住 ?view=galaxy 直达
  watch(() => store.view, (v) => {
    if (v === 'galaxy') {
      cancelAnimationFrame(raf)
      raf = 0
    } else if (!raf) {
      last = 0
      raf = requestAnimationFrame(frame)
    }
  }, { immediate: true })

  cleanup = () => {
    cancelAnimationFrame(raf)
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('wheel', onWheel)
    window.removeEventListener('resize', onResize)
    window.removeEventListener('wv:themechange', onTheme)
  }
})
onUnmounted(cleanup)
</script>

<template>
  <!-- 词汇圣殿/官网自己就是整片星空,进去时这层歇着,别白烧一个 rAF -->
  <canvas v-show="store.view !== 'galaxy' && store.view !== 'site'" ref="cvs" class="starfield" aria-hidden="true" />
</template>

<style scoped>
.starfield {
  position: fixed; inset: 0; z-index: 0;
  width: 100vw; height: 100vh;
  pointer-events: none;
}
</style>
