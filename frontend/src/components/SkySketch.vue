<script setup>
// 观星台「你的天空」:一幅实时反映学习数据的星图速写
// 全部词星按词根家族分扇区铺满天盘;已学 = 金星(终幕星座同源金),未学 = 暗尘
// 已学星首尾相连成用户的星座线;点一颗亮星 → 回圣殿看它(与 #/word/<id> 同链路)
import { ref, computed, onMounted, onUnmounted, onActivated, onDeactivated, watch } from 'vue'
import { useUniverse } from '../stores/universe'

const store = useUniverse()
const cvs = ref(null)
const wrap = ref(null)

const learned = computed(() =>
  store.words.filter((w) => {
    const s = store.states[w.id]
    return s && !s.is_new
  }))
const learnedCount = computed(() => learned.value.length)

// 星位:确定性生成(同一份知识库永远画出同一片天)——家族分扇区,黄金角在扇内撒星
let layout = [] // { id, x, y, r, learned, strength, root }
let hoverId = null
let raf = 0
let frameFn = null // onMounted 闭包里的帧函数;deactivate/activate 停帧续帧要用
let onMove, onLeave, onClick, onResize
let cleanup = () => {}

const lowEnd = (navigator.hardwareConcurrency || 8) < 4

function buildLayout() {
  const fams = new Map()
  for (const w of store.words) {
    const k = w.root || '_'
    if (!fams.has(k)) fams.set(k, [])
    fams.get(k).push(w)
  }
  // 扇区角度按家族词数分配(大家族占更宽的扇,与真实词量成比例)
  const totalW = store.words.length || 1
  let a = -Math.PI / 2
  const out = []
  for (const [, list] of fams) {
    const span = (list.length / totalW) * Math.PI * 2
    const mid = a + span / 2
    list.forEach((w, i) => {
      const s = store.states[w.id]
      const st = s && !s.is_new ? s : null
      // 黄金角在扇内散布 + 半径按族内序号拉开,避免挤成一圈点
      const g = (i * 2.39996) % 1
      const ang = mid + (g - 0.5) * span * 0.92
      const rr = 0.24 + 0.74 * ((i * 0.618 + 0.12) % 1)
      out.push({
        id: w.id, word: w.word, root: w.root,
        ang, rr,
        learned: !!st, strength: st ? (st.strength ?? 0.5) : 0,
      })
    })
    a += span
  }
  layout = out
}

onMounted(() => {
  const c = cvs.value
  if (!c) return
  const ctx = c.getContext('2d')
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  let w = 0, h = 0
  const GOLD = '242,234,216'   // 终幕星座金(与圣殿塔尖灯同源)
  const GOLD_LIGHT = '143,107,42' // 宣纸主题:白底上的深香槟金(与 --gold 同值)
  const DIM = '154,170,200'
  let light = false

  function readTheme() {
    light = document.documentElement.getAttribute('data-theme') === 'light'
  }
  readTheme()

  function resize() {
    const rect = wrap.value?.getBoundingClientRect()
    // 高度跟 CSS 走(观星窗口的高由样式决定,这里只负责乘 dpr)
    h = c.height = Math.round((c.clientHeight || 260) * dpr)
    w = c.width = Math.max(1, Math.round((rect?.width || 600) * dpr))
  }
  buildLayout()
  resize()

  // 星座连线:已学星按方位角排序首尾相连(终幕 MyConstellation 同构,这里只是速写)
  let chain = []
  function buildChain() {
    const cx = w / 2, cy = h / 2
    const R = Math.min(w, h) / 2 - 10 * dpr
    chain = learned.value
      .map((v) => {
        const p = layout.find((l) => l.id === v.id)
        return p ? { x: cx + Math.cos(p.ang) * p.rr * R, y: cy + Math.sin(p.ang) * p.rr * R } : null
      })
      .filter(Boolean)
      .sort((x, y) => Math.atan2(x.y - cy, x.x - cx) - Math.atan2(y.y - cy, y.x - cx))
  }
  buildChain()

  const posOf = (l) => {
    const cx = w / 2, cy = h / 2
    const R = Math.min(w, h) / 2 - 10 * dpr
    return { x: cx + Math.cos(l.ang) * l.rr * R, y: cy + Math.sin(l.ang) * l.rr * R }
  }

  function hit(px, py) {
    const rect = c.getBoundingClientRect()
    const X = (px - rect.left) * dpr, Y = (py - rect.top) * dpr
    let best = null, bd = 14 * dpr
    for (const l of layout) {
      if (!l.learned) continue
      const p = posOf(l)
      const d = Math.hypot(p.x - X, p.y - Y)
      if (d < bd) { bd = d; best = l }
    }
    return best
  }
  onMove = (e) => {
    hoverId = hit(e.clientX, e.clientY)?.id ?? null
    c.style.cursor = hoverId ? 'pointer' : 'default'
  }
  onLeave = () => { hoverId = null; c.style.cursor = 'default' }
  onClick = (e) => {
    const t = hit(e.clientX, e.clientY)
    if (t) { store.openWordInGalaxy(t.id) } // 回圣殿看这颗星
  }
  onResize = () => { resize(); buildChain() }
  c.addEventListener('pointermove', onMove)
  c.addEventListener('pointerleave', onLeave)
  c.addEventListener('click', onClick)
  window.addEventListener('resize', onResize)
  window.addEventListener('wv:themechange', readTheme)

  let last = 0
  const frame = (ts) => {
    raf = requestAnimationFrame(frame)
    if (document.hidden || ts - last < (lowEnd ? 50 : 33)) return
    last = ts
    ctx.clearRect(0, 0, w, h)
    const t = ts / 1000
    const gold = light ? GOLD_LIGHT : GOLD
    // 星座连线(先画线,星压在线上)
    if (chain.length > 1) {
      ctx.strokeStyle = `rgba(${gold},${light ? 0.3 : 0.16})`
      ctx.lineWidth = 1 * dpr
      ctx.beginPath()
      chain.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)))
      if (chain.length > 2) ctx.closePath()
      ctx.stroke()
    }
    // 全部词星
    for (const l of layout) {
      const p = posOf(l)
      if (l.learned) {
        const tw = 0.75 + 0.25 * Math.sin(t * (0.5 + l.strength) + l.id)
        const hot = l.id === hoverId
        const r = (1.5 + l.strength * 1.4 + (hot ? 1.6 : 0)) * dpr
        ctx.fillStyle = `rgba(${gold},${Math.min(1, (0.65 + l.strength * 0.35) * tw)})`
        ctx.beginPath()
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2)
        ctx.fill()
        // 亮星柔晕:与圣殿 halo 同语言,只给已学的星
        ctx.fillStyle = `rgba(${gold},${0.1 * tw + (hot ? 0.16 : 0)})`
        ctx.beginPath()
        ctx.arc(p.x, p.y, r * 2.6, 0, Math.PI * 2)
        ctx.fill()
      } else {
        const tw = 0.5 + 0.5 * Math.sin(t * 0.4 + l.id * 1.7)
        ctx.fillStyle = light
          ? `rgba(32,54,83,${0.09 + 0.09 * tw})` // 宣纸:墨尘更淡,白底上不显脏
          : `rgba(${DIM},${0.14 + 0.14 * tw})`
        ctx.fillRect(p.x - dpr * 0.6, p.y - dpr * 0.6, 1.2 * dpr, 1.2 * dpr)
      }
    }

    // 馆签:hover 的亮星引出金线小标签(词 + 词根 + 掌握度)—— 像美术馆里挂在画旁的说明签
    const hovered = layout.find((l) => l.id === hoverId && l.learned)
    if (hovered) {
      const p = posOf(hovered)
      const lx = p.x + 20 * dpr, ly = p.y - 16 * dpr
      ctx.strokeStyle = `rgba(${gold},${light ? 0.55 : 0.45})`
      ctx.lineWidth = 1 * dpr
      ctx.beginPath()
      ctx.moveTo(p.x + 5 * dpr, p.y - 5 * dpr)
      ctx.lineTo(lx, ly)
      ctx.stroke()

      const t1 = hovered.word
      const t2 = `${(hovered.root || '').toUpperCase()}- · 掌握 ${Math.round(hovered.strength * 100)}%`
      ctx.font = `600 ${13 * dpr}px 'Inter', 'PingFang SC', sans-serif`
      const w1 = ctx.measureText(t1).width
      ctx.font = `${10.5 * dpr}px 'JetBrains Mono', Consolas, monospace`
      const w2 = ctx.measureText(t2).width
      const bw = Math.max(w1, w2) + 22 * dpr
      const bh = 50 * dpr
      const bx = Math.min(Math.max(6 * dpr, lx), w - bw - 6 * dpr)
      const by = Math.max(6 * dpr, ly - bh)

      ctx.fillStyle = light ? 'rgba(255,255,255,0.95)' : 'rgba(7,10,18,0.9)'
      if (ctx.roundRect) {
        ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, 8 * dpr); ctx.fill()
        ctx.strokeStyle = `rgba(${gold},0.38)`; ctx.stroke()
      } else {
        ctx.fillRect(bx, by, bw, bh)
        ctx.strokeStyle = `rgba(${gold},0.38)`; ctx.strokeRect(bx, by, bw, bh)
      }
      ctx.fillStyle = light ? '#b45309' : `rgba(${gold},0.98)`
      ctx.font = `600 ${13 * dpr}px 'Inter', 'PingFang SC', sans-serif`
      ctx.fillText(t1, bx + 11 * dpr, by + 20 * dpr)
      ctx.fillStyle = light ? 'rgba(71,85,105,0.9)' : `rgba(${DIM},0.75)`
      ctx.font = `${10.5 * dpr}px 'JetBrains Mono', Consolas, monospace`
      ctx.fillText(t2, bx + 11 * dpr, by + 37 * dpr)
    }
  }
  frameFn = frame
  raf = requestAnimationFrame(frame)

  // 学习数据变化(刚答完星火问答/复习)时重铺星图与星座
  const stopStates = watch(() => store.states, () => { buildLayout(); buildChain() }, { deep: false })
  cleanup = () => {
    stopStates()
    cancelAnimationFrame(raf)
    c.removeEventListener('pointermove', onMove)
    c.removeEventListener('pointerleave', onLeave)
    c.removeEventListener('click', onClick)
    window.removeEventListener('resize', onResize)
    window.removeEventListener('wv:themechange', readTheme)
  }
})
onUnmounted(cleanup)
// KeepAlive:观星台被缓存切走后星图不可见,30fps 全量重绘在后台空转——停帧,回页续帧
onDeactivated(() => { if (raf) { cancelAnimationFrame(raf); raf = 0 } })
onActivated(() => { if (!raf && frameFn) raf = requestAnimationFrame(frameFn) })
</script>

<template>
  <div ref="wrap" class="sky-wrap">
    <!-- 星盘刻度环:画布之下的 whisper 级仪器层(12 向刻度 + 内虚线环 + 中心十字),极慢自转 -->
    <svg class="sky-graticule" viewBox="0 0 300 300" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <g class="sg-ticks">
        <path d="M284 150h8M266 83l7-4M217 34l4-7M150 16v-8M83 34l-4-7M34 83l-7-4M16 150h-8M34 217l-7 4M83 266l-4 7M150 284v8M217 266l4 7M266 217l7 4" />
      </g>
      <circle class="sg-ring" cx="150" cy="150" r="96" />
      <path class="sg-cross" d="M150 140V130M150 160v10M140 150H130M160 150h10" />
    </svg>
    <canvas ref="cvs" class="sky-canvas" aria-label="你的天空:已点亮的词星与你的星座线" />
    <div v-if="!learnedCount" class="sky-empty">
      <div class="se-orbit" aria-hidden="true"><i class="se-star" /></div>
      <div class="se-line" aria-hidden="true" />
      <p>还没有星被点亮 —— 去圣殿里做几道题，第一颗星很快就会亮起。</p>
    </div>
  </div>
</template>

<style scoped>
.sky-wrap { position: relative; }
/* 分层:刻度环(0) < 星图画布(1) < 取景暗角(2) < 空态(3),星永远压在仪器刻线之上 */
.sky-graticule {
  position: absolute; inset: 0; z-index: 0;
  width: 100%; height: 100%; pointer-events: none;
}
.sg-ticks path {
  fill: none; stroke: color-mix(in srgb, var(--text-3) 45%, transparent);
  stroke-width: 1.4; stroke-linecap: round;
}
/* 刻度环极慢自转:仪器的呼吸,不是表演(系统减少动态时被全局规则停掉) */
.sg-ticks { transform-origin: 150px 150px; animation: skySpin 240s linear infinite; }
@keyframes skySpin { to { transform: rotate(360deg) } }
.sg-ring {
  fill: none; stroke: color-mix(in srgb, var(--text-3) 34%, transparent);
  stroke-width: 1; stroke-dasharray: 2 6;
}
.sg-cross {
  fill: none; stroke: color-mix(in srgb, var(--text-3) 40%, transparent);
  stroke-width: 1; stroke-linecap: round;
}
/* 观星窗:画布本身不带卡片底,靠暗角取景 —— 像从塔顶望出去的一扇窗 */
.sky-wrap::after {
  content: ''; position: absolute; inset: 0; pointer-events: none; z-index: 2;
  border-radius: 12px;
  background: radial-gradient(120% 100% at 50% 42%, transparent 58%, rgba(2,4,10,0.22));
}
[data-theme='light'] .sky-wrap::after { background: transparent }
.sky-canvas { display: block; width: 100%; height: 320px; cursor: default; position: relative; z-index: 1; }
.sky-empty {
  position: absolute; inset: 0; z-index: 3;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px;
  pointer-events: none;
}
/* 空态:一圈虚线轨道 + 中心一颗待点亮的金种星(词之心塔尖灯同源暖金,晴空降为暗琥珀) */
.se-orbit {
  position: relative; width: 112px; height: 112px; border-radius: 50%;
  border: 1px dashed color-mix(in srgb, var(--text-3) 38%, transparent);
  display: flex; align-items: center; justify-content: center;
}
.se-star { position: relative; width: 5px; height: 5px; border-radius: 50%; background: var(--gold); }
/* 金种星外圈缓慢 ping:像雷达在等第一颗星落进来,不是流光 */
.se-star::after {
  content: ''; position: absolute; inset: -5px; border-radius: 50%;
  border: 1px solid color-mix(in srgb, var(--gold) 55%, transparent);
  animation: sePing 3s var(--ease-out-3) infinite;
}
@keyframes sePing {
  0% { transform: scale(0.35); opacity: 0 }
  35% { opacity: 1 }
  100% { transform: scale(2.4); opacity: 0 }
}
.se-line { width: 46px; height: 1px; background: var(--accent); opacity: 0.7 }
.sky-empty p { font-size: var(--fs-sm); color: var(--text-3); margin: 0 }
@media (max-width: 640px) { .sky-canvas { height: 260px } }
</style>
