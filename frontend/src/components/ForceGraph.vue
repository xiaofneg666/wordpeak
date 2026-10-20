<script setup>
// 2D 力导向语义图谱(词汇网络):零新依赖,纯 Canvas2D + 手写 velocity-Verlet 力模拟。
//   40 家族 = 固定锚点;同族节点 = 重弹簧到锚点;跨族共现边 = 弱弹簧;
//   节点-节点 Coulomb 斥力(空间格 O(n));中心弱引力防飘出。
//   渲染:深空底色 → 家族光晕 → 家族标签 → 跨族边 → 节点 → tooltip。
//   交互:hover/click/pan/zoom/双击聚焦。亮度 = 记忆概率(FSRS R),与 3D halo 同源。
// 依据:词峰"克制帧率 + 确定性布局 + 学习数据驱动亮度" 的家族画风(StarFieldBackdrop/SkySketch)。
import { computed, onMounted, onUnmounted, onActivated, onDeactivated, ref, watch } from 'vue'
import { useUniverse } from '../stores/universe'

const props = defineProps({
  nodes: { type: Array, default: () => [] },   // 来自 /api/words/network
  edges: { type: Array, default: () => [] },
  meta:  { type: Object, default: () => ({}) },
  // 高亮家族:被点击的家族名(root),该家族节点亮起 + 边亮
  highlightRoot: { type: String, default: '' },
  // 搜索过滤:命中的节点 id 集合,其他降透明度
  matchIds: { type: Array, default: () => [] },
  // 显示已学/未学筛选
  filterMode: { type: String, default: 'all' }, // 'all' | 'learned' | 'unlearned'
})
const store = useUniverse()

const canvasEl = ref(null)
const wrapEl = ref(null)
let raf = 0
let lastT = 0
let fps = 60
let degraded = false
let drawMs = 0

// 内部节点 / 边(带 x,y,vx,vy)
let N = []   // 节点 {id, x, y, vx, vy, r, root, retrievability, ...}
let E = []   // 边 {a, b, w} (a/b = 节点索引)
let familyAnchors = []  // [{root, x, y, color}]
let grid = null
let dpr = 1

// 视图变换:pan + zoom
let panX = 0, panY = 0, zoom = 1
let viewW = 800, viewH = 600

// 交互态
let hovered = -1
let selected = -1
let dragging = null // { sx, sy, ox, oy, mode:'pan'|'node' }
let lastTap = 0
let lastPanCursor = { x: 0, y: 0 }
let focusTween = null // { fromPan, toPan, fromZoom, toZoom, t, dur }

// 家族色:sculpture.js colorForRoot 同源
function colorForRoot(root) {
  const k = (root || '').toLowerCase().replace(/[^a-z]/g, '') || 'x'
  let n = 2166136261
  for (let i = 0; i < k.length; i++) { n ^= k.charCodeAt(i); n = Math.imul(n, 16777619) }
  const h = (n >>> 0) / 4294967295
  const hue = (206 + h * 34) / 360
  const sat = 0.05 + ((h * 97) % 1) * 0.09
  const lig = 0.66 + ((h * 13) % 1) * 0.13
  // 转 HSL → rgb
  return hslToHex(hue, sat, lig)
}
function hslToHex(h, s, l) {
  const f = (n) => { const k = (n + h * 12) % 12; return l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1))) }
  const r = Math.round(255 * f(0)), g = Math.round(255 * f(8)), b = Math.round(255 * f(4))
  return (r << 16) | (g << 8) | b
}
function hexAlpha(hex, a) {
  const r = (hex >> 16) & 255, g = (hex >> 8) & 255, b = hex & 255
  return `rgba(${r},${g},${b},${a})`
}

// 关系边颜色:同义暖金 / 反义琥珀 / 共现灰(模块级常量,别在 draw 里每帧重建)
const REL_COLORS = { syn: 0xf2ead8, ant: 0xf59e0b, co: 0xa8b0c0 }

// 颜色读取 CSS 变量:按名缓存 getComputedStyle 的结果,主题切换(wv:themechange)时失效——
// 每帧多次 getComputedStyle 是纯浪费
let _varCache = null
function readVar(name, fallback) {
  if (typeof window === 'undefined') return fallback
  if (!_varCache) {
    const cs = getComputedStyle(document.documentElement)
    _varCache = {
      'text': cs.getPropertyValue('--text').trim(),
      'text-2': cs.getPropertyValue('--text-2').trim(),
      'text-3': cs.getPropertyValue('--text-3').trim(),
      'accent': cs.getPropertyValue('--accent').trim(),
      'surface': cs.getPropertyValue('--surface').trim(),
      'line': cs.getPropertyValue('--line').trim(),
    }
  }
  return _varCache[name] || fallback
}

// 节点颜色亮度:未学 0.55 / 已学 1.6 / 掌握 2.3 (与 3D engine _buildHalo 同档)
function nodeIntensity(node) {
  const r = node.retrievability
  if (r == null) return 0.55
  if (r > 0.8) return 2.3
  if (r > 0.5) return 1.6
  return 1.0
}

// 颜色读取 CSS 变量(缓存版)在上方 readVar;原 per-frame 实现已并入缓存

// matchIds 集合按数组引用缓存:搜索/筛选态没变就别每帧 new Set
let _matchCache = { ids: null, set: new Set() }
function matchSetOf(ids) {
  if (_matchCache.ids !== ids) _matchCache = { ids, set: new Set(ids) }
  return _matchCache.set
}

// 初始化图数据:派生 N / E / familyAnchors
function buildGraph() {
  if (!props.nodes.length) return
  const cw = wrapEl.value?.clientWidth || 800
  const ch = wrapEl.value?.clientHeight || 600
  viewW = cw; viewH = ch
  // 家族锚点:40 根中心摆放在画布中央一圈
  const families = [...new Set(props.nodes.map((n) => n.root))]
  // 锚点位置:同心圆环,大族在外(让大族有更多空间)
  const familySize = new Map()
  for (const n of props.nodes) familySize.set(n.root, (familySize.get(n.root) || 0) + 1)
  const sortedFamilies = families.slice().sort((a, b) => (familySize.get(b) || 0) - (familySize.get(a) || 0))
  const R = Math.min(cw, ch) * 0.32
  familyAnchors = sortedFamilies.map((root, i) => {
    const angle = (i / sortedFamilies.length) * Math.PI * 2
    return { root, x: cw / 2 + Math.cos(angle) * R, y: ch / 2 + Math.sin(angle) * R, color: colorForRoot(root) }
  })
  const rootIdx = new Map(familyAnchors.map((a, i) => [a.root, i]))
  // 节点:每族放在锚点附近
  N = props.nodes.map((n) => {
    const a = familyAnchors[rootIdx.get(n.root)]
    const angle = Math.random() * Math.PI * 2
    const dist = Math.random() * 60
    return {
      id: n.id, word: n.word, root: n.root, level: n.level, ipa: n.ipa, meaning: n.meaning,
      retrievability: n.retrievability, mnemonic: n.mnemonic,
      x: a.x + Math.cos(angle) * dist, y: a.y + Math.sin(angle) * dist,
      vx: 0, vy: 0, familyIdx: rootIdx.get(n.root),
    }
  })
  const idxById = new Map(N.map((n, i) => [n.id, i]))
  E = props.edges.map((e) => ({ a: idxById.get(e.source), b: idxById.get(e.target), w: e.weight, type: e.type })).filter((e) => e.a != null && e.b != null)
  // 空间格
  buildGrid()
  // 预热:300 子步让初始布局先收敛
  for (let i = 0; i < 300; i++) step(1 / 60)
  // 视口居中
  panX = 0; panY = 0; zoom = 0.95
}

// 空间格:O(n) 斥力
function buildGrid() {
  const cell = 40
  const cols = Math.ceil((viewW + 400) / cell) + 2
  const rows = Math.ceil((viewH + 400) / cell) + 2
  grid = new Array(cols * rows)
  for (let i = 0; i < grid.length; i++) grid[i] = []
}
function cellOf(x, y) {
  const cell = 40
  const cx = Math.floor((x + 200) / cell), cy = Math.floor((y + 200) / cell)
  return { cx, cy }
}
function idxCell(cx, cy) {
  const cols = Math.ceil((viewW + 400) / 40) + 2
  return cy * cols + cx
}

// 力模拟:dt 秒
const K_FAMILY = 0.012     // 同族 → 锚点
const K_CROSS  = 0.002     // 跨族共现 → 对方(轻)
const L_FAMILY = 30        // 弹簧自然长
const L_CROSS  = 110
const REPEL_R  = 36        // 斥力半径
const REPEL_K  = 220
const DAMP     = 0.86
const CENTER_K = 0.00005

function step(dt) {
  // 力累加
  const fxs = new Float64Array(N.length)
  const fys = new Float64Array(N.length)
  // 家族弹簧(向锚点)
  for (let i = 0; i < N.length; i++) {
    const a = familyAnchors[N[i].familyIdx]
    const dx = a.x - N[i].x, dy = a.y - N[i].y
    const d = Math.max(0.1, Math.hypot(dx, dy))
    const f = K_FAMILY * (d - L_FAMILY)
    fxs[i] += f * dx / d
    fys[i] += f * dy / d
    // 中心引力
    fxs[i] += (viewW / 2 - N[i].x) * CENTER_K
    fys[i] += (viewH / 2 - N[i].y) * CENTER_K
  }
  // 跨族边弹簧
  for (const e of E) {
    const a = N[e.a], b = N[e.b]
    const dx = b.x - a.x, dy = b.y - a.y
    const d = Math.max(1, Math.hypot(dx, dy))
    const f = K_CROSS * (d - L_CROSS)
    fxs[e.a] += f * dx / d; fys[e.a] += f * dy / d
    fxs[e.b] -= f * dx / d; fys[e.b] -= f * dy / d
  }
  // 节点-节点斥力(空间格)
  // 重建格(轻量,千级节点不贵)
  const cols = Math.ceil((viewW + 400) / 40) + 2
  if (grid) for (let i = 0; i < grid.length; i++) grid[i].length = 0
  for (let i = 0; i < N.length; i++) {
    const { cx, cy } = cellOf(N[i].x, N[i].y)
    if (cx < 0 || cy < 0 || cx >= cols) continue
    grid[idxCell(cx, cy)].push(i)
  }
  const cell = 40
  for (let i = 0; i < N.length; i++) {
    const { cx, cy } = cellOf(N[i].x, N[i].y)
    for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
      const cellIdx = idxCell(cx + ox, cy + oy)
      const list = grid[cellIdx]
      if (!list) continue
      for (let k = 0; k < list.length; k++) {
        const j = list[k]
        if (j <= i) continue
        const dx = N[j].x - N[i].x, dy = N[j].y - N[i].y
        const d2 = dx * dx + dy * dy
        if (d2 > REPEL_R * REPEL_R || d2 < 0.1) continue
        const d = Math.sqrt(d2)
        const f = REPEL_K / d2
        const ux = dx / d, uy = dy / d
        fxs[i] -= f * ux; fys[i] -= f * uy
        fxs[j] += f * ux; fys[j] += f * uy
      }
    }
  }
  // 速度更新(velocity-Verlet 简化)
  for (let i = 0; i < N.length; i++) {
    N[i].vx = (N[i].vx + fxs[i] * dt) * DAMP
    N[i].vy = (N[i].vy + fys[i] * dt) * DAMP
  }
  // 位置更新(夹住速度防爆)
  for (let i = 0; i < N.length; i++) {
    const speed = Math.hypot(N[i].vx, N[i].vy)
    const cap = 8
    if (speed > cap) { N[i].vx *= cap / speed; N[i].vy *= cap / speed }
    N[i].x += N[i].vx * dt * 60
    N[i].y += N[i].vy * dt * 60
  }
}

// 渲染循环
function tick(ts) {
  if (!lastT) lastT = ts
  const dt = Math.min(0.05, (ts - lastT) / 1000)
  lastT = ts
  // 1 步物理
  step(dt)
  // 视口 tween
  if (focusTween) {
    focusTween.t += dt / focusTween.dur
    if (focusTween.t >= 1) { focusTween.t = 1; focusTween = null }
    const k = 1 - Math.pow(1 - focusTween.t, 3) // easeOutCubic
    panX = focusTween.fromX + (focusTween.toX - focusTween.fromX) * k
    panY = focusTween.fromY + (focusTween.toY - focusTween.fromY) * k
    zoom = focusTween.fromZ + (focusTween.toZ - focusTween.fromZ) * k
  }
  // FPS 检测
  const now = performance.now()
  if (now - lastT > 50) fps = Math.min(fps, 30)
  draw()
  raf = requestAnimationFrame(tick)
}

function draw() {
  const c = canvasEl.value
  if (!c) return
  const ctx = c.getContext('2d')
  const t0 = performance.now()
  // 尺寸只在变化时重设:每帧赋 canvas.width 会强制整块位图重分配 + 2D 上下文状态重置
  const cw = Math.max(1, Math.round(wrapEl.value.clientWidth * dpr))
  const ch = Math.max(1, Math.round(wrapEl.value.clientHeight * dpr))
  if (c.width !== cw) c.width = cw
  if (c.height !== ch) c.height = ch
  const w = cw, h = ch
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, w, h)
  // 背景:透明,让 StarFieldBackdrop 透出
  // 1) 家族光晕
  for (const a of familyAnchors) {
    const x = a.x * zoom + panX
    const y = a.y * zoom + panY
    const r = 70 * zoom
    const isHi = props.highlightRoot === a.root
    const intensity = isHi ? 0.18 : 0.06
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r)
    grad.addColorStop(0, hexAlpha(a.color, intensity))
    grad.addColorStop(1, hexAlpha(a.color, 0))
    ctx.fillStyle = grad
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill()
  }
  // 2) 家族标签
  ctx.font = `600 ${11 * zoom}px 'JetBrains Mono', monospace`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  const text3 = readVar('--text-3', '#a8b0c0')
  const accent = readVar('--accent', '#22d3ee')
  for (const a of familyAnchors) {
    const x = a.x * zoom + panX
    const y = a.y * zoom + panY
    const isHi = props.highlightRoot === a.root
    ctx.fillStyle = isHi ? accent : hexAlpha(text3, zoom < 0.7 ? 0.5 : 0.85)
    ctx.fillText(a.root.toUpperCase().slice(0, 5), x, y + 75 * zoom)
  }
  // 3) 跨族边
  const matchSet = matchSetOf(props.matchIds)
  const hoveredId = hovered >= 0 ? N[hovered]?.id : -1
  for (const e of E) {
    const a = N[e.a], b = N[e.b]
    if (!a || !b) continue
    const x1 = a.x * zoom + panX, y1 = a.y * zoom + panY
    const x2 = b.x * zoom + panX, y2 = b.y * zoom + panY
    const isAdj = hoveredId >= 0 && (a.id === hoveredId || b.id === hoveredId)
    const dimBySearch = matchSet.size > 0 && !isAdj
    const dimByFilter = props.filterMode === 'learned' && (a.retrievability == null || b.retrievability == null)
      ? 0.04
      : (props.filterMode === 'unlearned' && a.retrievability != null && b.retrievability != null ? 0.04 : null)
    const base = isAdj ? 0.7 : 0.18 + 0.06 * Math.log2(1 + e.w)
    const op = dimBySearch ? 0.04 : (dimByFilter != null ? dimByFilter : base)
    if (degraded && e.w < 3 && !isAdj) continue
    // typed 颜色:关系边(type=syn/ant)按类型上色,虚线;共现边走默认灰实线
    const t = e.type
    if (t === 'syn' || t === 'ant') {
      const c = REL_COLORS[t]
      ctx.setLineDash([3, 3])
      ctx.lineWidth = isAdj ? 1.6 : 0.9
      ctx.strokeStyle = hexAlpha(c, op)
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke()
      ctx.setLineDash([])
    } else {
      const color = a.retrievability != null ? 0xa8b0c0 : 0x666666
      ctx.lineWidth = 1
      ctx.strokeStyle = hexAlpha(color, op)
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke()
    }
  }
  // 4) 节点
  const accentColor = parseInt(accent.replace('#', ''), 16)
  for (let i = 0; i < N.length; i++) {
    const n = N[i]
    const a = familyAnchors[n.familyIdx]
    const x = n.x * zoom + panX, y = n.y * zoom + panY
    if (x < -20 || y < -20 || x > viewW + 20 || y > viewH + 20) continue
    const isH = i === hovered
    const isS = i === selected
    const dimBySearch = matchSet.size > 0 && !matchSet.has(n.id)
    const dimByFilter = props.filterMode === 'learned' && n.retrievability == null
      || (props.filterMode === 'unlearned' && n.retrievability != null)
    const dim = dimBySearch || dimByFilter
    // 半径:已学略大;hover/selected 更大
    const baseR = 2.2 + (n.retrievability != null ? 1 : 0)
    const r = (isH || isS ? baseR + 2.6 : baseR) * zoom
    const intensity = nodeIntensity(n)
    const colorHex = a.color
    // 节点本体
    ctx.fillStyle = hexAlpha(colorHex, dim ? 0.15 : Math.min(0.95, 0.35 * intensity))
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill()
    // 描边
    ctx.strokeStyle = hexAlpha(colorHex, dim ? 0.2 : 0.7)
    ctx.lineWidth = (isH || isS ? 1.6 : 0.8) * zoom
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke()
    // hover/selected:外圈
    if (isH || isS) {
      ctx.strokeStyle = hexAlpha(accent, isS ? 0.95 : 0.65)
      ctx.lineWidth = 1.2 * zoom
      ctx.beginPath(); ctx.arc(x, y, r + 5 * zoom, 0, Math.PI * 2); ctx.stroke()
    }
    if (isS) {
      ctx.fillStyle = hexAlpha(accent, 0.95)
      ctx.beginPath(); ctx.arc(x, y, 1.5 * zoom, 0, Math.PI * 2); ctx.fill()
    }
  }
  // 5) tooltip
  if (hovered >= 0) drawTooltip(ctx, N[hovered])
  drawMs = performance.now() - t0
  if (drawMs > 20) degraded = true
}

function drawTooltip(ctx, n) {
  if (!n) return
  const x = n.x * zoom + panX
  const y = n.y * zoom + panY
  const off = 18
  const tx = x + off, ty = y - 70
  const pad = 12
  const lines = []
  lines.push({ txt: n.word, font: `600 17px 'Times New Roman', serif`, color: readVar('--text', '#f5f7fa') })
  lines.push({ txt: `${n.ipa || ''} · ${n.root}-(${n.meaning?.split(/[,，;；]/)[0] || ''})`, font: `12px 'JetBrains Mono', monospace`, color: readVar('--text-3', '#a8b0c0') })
  const r = n.retrievability
  const rTxt = r == null ? '还没学' : `记忆 ${Math.round(r * 100)}%`
  lines.push({ txt: rTxt, font: `12px 'JetBrains Mono', monospace`, color: r != null ? readVar('--accent', '#22d3ee') : readVar('--text-3', '#a8b0c0') })
  if (n.mnemonic) lines.push({ txt: n.mnemonic, font: `12.5px 'Inter', sans-serif`, color: readVar('--text-2', '#a8b0c0'), max: 200 })
  // 量尺寸
  ctx.font = lines[0].font
  let w = ctx.measureText(lines[0].txt).width
  for (let i = 1; i < lines.length; i++) {
    ctx.font = lines[i].font
    w = Math.max(w, Math.min(240, ctx.measureText(lines[i].txt).width))
  }
  const width = w + pad * 2
  const height = lines.length * 18 + pad * 2
  // 位置:右溢出就放到左
  const ax = tx + width > viewW ? x - off - width : tx
  const ay = ty + height < 0 ? 10 : Math.max(10, ty)
  const bg = readVar('--surface', '#0a0f1e')
  ctx.fillStyle = hexAlpha(parseInt(bg.replace('#', ''), 16), 0.95)
  roundRect(ctx, ax, ay, width, height, 6)
  ctx.fill()
  ctx.strokeStyle = readVar('--line', 'rgba(255,255,255,0.1)')
  ctx.lineWidth = 1
  ctx.stroke()
  for (let i = 0; i < lines.length; i++) {
    const yy = ay + pad + 14 + i * 18
    ctx.font = lines[i].font
    ctx.fillStyle = lines[i].color
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    const max = lines[i].max || 240
    let t = lines[i].txt
    if (ctx.measureText(t).width > max) {
      while (t.length > 4 && ctx.measureText(t + '…').width > max) t = t.slice(0, -1)
      t += '…'
    }
    ctx.fillText(t, ax + pad, yy)
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + r); ctx.lineTo(x + w, y + h - r)
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h); ctx.lineTo(x + r, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - r); ctx.lineTo(x, y + r)
  ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath()
}

// 交互
function getMousePos(e) {
  const r = canvasEl.value.getBoundingClientRect()
  const cx = (e.clientX - r.left - panX) / zoom
  const cy = (e.clientY - r.top - panY) / zoom
  return { cx, cy, mx: e.clientX - r.left, my: e.clientY - r.top }
}
function findNode(cx, cy, maxDist = 12 / zoom) {
  let best = -1, bestD = maxDist
  for (let i = 0; i < N.length; i++) {
    const dx = N[i].x - cx, dy = N[i].y - cy
    const d = Math.hypot(dx, dy)
    if (d < bestD) { bestD = d; best = i }
  }
  return best
}
// 触屏/鼠标统一:pointer 事件 + 双指捏合缩放(替代滚轮),单指 = 拖拽/点节点,桌面 hover 照旧
const pointers = new Map()
let pinch = null // { d0, z0, px0, py0, mx0, my0 }

function onPointerDown(e) {
  if (e.button === 1 || e.button === 2) { e.preventDefault(); return }
  canvasEl.value?.setPointerCapture?.(e.pointerId)
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
  if (pointers.size === 2) {
    // 双指进入捏合:取消单指拖拽,记录起始距离/中点
    const [a, b] = [...pointers.values()]
    pinch = { d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, z0: zoom, px0: panX, py0: panY, mx0: (a.x + b.x) / 2, my0: (a.y + b.y) / 2 }
    dragging = null
    return
  }
  const { cx, cy } = getMousePos(e)
  const idx = findNode(cx, cy)
  if (idx >= 0) {
    dragging = { mode: 'node', idx, cx: e.clientX, cy: e.clientY, ox: panX, oy: panY }
    selected = idx
  } else {
    dragging = { mode: 'pan', cx: e.clientX, cy: e.clientY, ox: panX, oy: panY }
  }
  canvasEl.value.style.cursor = 'grabbing'
}

function onPointerMove(e) {
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
  if (pinch && pointers.size >= 2) {
    const [a, b] = [...pointers.values()]
    const d = Math.hypot(a.x - b.x, a.y - b.y) || 1
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2
    const r = canvasEl.value.getBoundingClientRect()
    const newZ = Math.max(0.4, Math.min(4, pinch.z0 * (d / pinch.d0)))
    // 锚中点缩放 + 中点平移(与 onWheel 同一套锚点数学)
    const cx0 = pinch.mx0 - r.left, cy0 = pinch.my0 - r.top
    panX = cx0 - (cx0 - pinch.px0) * (newZ / pinch.z0) + (mx - pinch.mx0)
    panY = cy0 - (cy0 - pinch.py0) * (newZ / pinch.z0) + (my - pinch.my0)
    zoom = newZ
    focusTween = null
    return
  }
  if (dragging) {
    if (dragging.mode === 'pan') {
      const dx = e.clientX - dragging.cx, dy = e.clientY - dragging.cy
      panX = dragging.ox + dx; panY = dragging.oy + dy
    } else if (dragging.mode === 'node' && dragging.idx >= 0) {
      const r = canvasEl.value.getBoundingClientRect()
      const cx = (e.clientX - r.left - panX) / zoom
      const cy = (e.clientY - r.top - panY) / zoom
      N[dragging.idx].x = cx
      N[dragging.idx].y = cy
      N[dragging.idx].vx = 0; N[dragging.idx].vy = 0
    }
    return
  }
  const { cx, cy } = getMousePos(e)
  const idx = findNode(cx, cy)
  if (idx !== hovered) { hovered = idx; lastPanCursor = { x: e.clientX, y: e.clientY } }
  canvasEl.value.style.cursor = idx >= 0 ? 'pointer' : (dragging ? 'grabbing' : 'grab')
}

function onPointerUp(e) {
  pointers.delete(e.pointerId)
  if (pointers.size < 2) pinch = null
  if (pointers.size > 0) { dragging = null; return } // 捏合后剩下的那根指头别再当拖拽
  // 区分 click vs drag
  if (dragging && dragging.mode === 'pan') {
    const moved = Math.hypot(e.clientX - dragging.cx, e.clientY - dragging.cy)
    if (moved < 3) {
      // 空白点击 = 取消选中
      selected = -1
    }
  } else if (dragging && dragging.mode === 'node') {
    const moved = Math.hypot(e.clientX - dragging.cx, e.clientY - dragging.cy)
    if (moved < 3) {
      // 点击节点 → 打开词卡
      const w = N[dragging.idx]
      if (w) store.selectWord(w.id)
    }
  }
  dragging = null
  canvasEl.value.style.cursor = 'grab'
}
function onDblClick(e) {
  const { cx, cy } = getMousePos(e)
  const idx = findNode(cx, cy)
  if (idx >= 0) {
    // 双击节点 → 聚焦
    const targetZoom = 2.4
    const tx = viewW / 2 - N[idx].x * targetZoom
    const ty = viewH / 2 - N[idx].y * targetZoom
    focusTween = { fromX: panX, toX: tx, fromY: panY, toY: ty, fromZ: zoom, toZ: targetZoom, t: 0, dur: 0.5 }
  } else {
    // 双击空白 → 复位
    focusTween = { fromX: panX, toX: 0, fromY: panY, toY: 0, fromZ: zoom, toZ: 0.95, t: 0, dur: 0.5 }
  }
}
function onWheel(e) {
  e.preventDefault()
  const r = canvasEl.value.getBoundingClientRect()
  const mx = e.clientX - r.left, my = e.clientY - r.top
  const factor = Math.exp(-e.deltaY * 0.0015)
  const newZ = Math.max(0.4, Math.min(4, zoom * factor))
  // 保持光标位置为缩放锚点
  panX = mx - (mx - panX) * (newZ / zoom)
  panY = my - (my - panY) * (newZ / zoom)
  zoom = newZ
  focusTween = null // 用户手动接管
}

function onResize() {
  if (!canvasEl.value) return
  dpr = Math.min(2, window.devicePixelRatio || 1)
  buildGrid()
}

// 主题变化响应:配色走 CSS 变量缓存,失效缓存即可——
// 不再 buildGraph(会重撒节点 + 重置视口,用户白调的布局直接丢)
function onThemeChange() { _varCache = null }

onMounted(() => {
  dpr = Math.min(2, window.devicePixelRatio || 1)
  if (canvasEl.value) {
    canvasEl.value.addEventListener('pointermove', onPointerMove)
    canvasEl.value.addEventListener('pointerdown', onPointerDown)
    canvasEl.value.addEventListener('pointerup', onPointerUp)
    canvasEl.value.addEventListener('pointercancel', onPointerUp)
    canvasEl.value.addEventListener('dblclick', onDblClick)
    canvasEl.value.addEventListener('wheel', onWheel, { passive: false })
    canvasEl.value.addEventListener('contextmenu', (e) => e.preventDefault())
  }
  window.addEventListener('resize', onResize)
  window.addEventListener('wv:themechange', onThemeChange)
  if (props.nodes.length) {
    buildGraph()
    raf = requestAnimationFrame(tick)
  }
})
onUnmounted(() => {
  if (raf) cancelAnimationFrame(raf)
  if (canvasEl.value) {
    canvasEl.value.removeEventListener('pointermove', onPointerMove)
    canvasEl.value.removeEventListener('pointerdown', onPointerDown)
    canvasEl.value.removeEventListener('pointerup', onPointerUp)
    canvasEl.value.removeEventListener('pointercancel', onPointerUp)
    canvasEl.value.removeEventListener('dblclick', onDblClick)
    canvasEl.value.removeEventListener('wheel', onWheel)
  }
  window.removeEventListener('resize', onResize)
  window.removeEventListener('wv:themechange', onThemeChange)
})
// KeepAlive:NetworkView 被缓存切走后本图不可见,力模拟 + 全画布重绘的
// rAF 却在后台 60fps 空转——切走停帧,回页续帧(对照 StarFieldBackdrop 的停帧纪律)
onDeactivated(() => { if (raf) { cancelAnimationFrame(raf); raf = 0 } })
onActivated(() => { if (!raf && N.length) { lastT = 0; raf = requestAnimationFrame(tick) } })
watch(() => [props.nodes, props.edges], ([n, e]) => {
  if (n && n.length) {
    buildGraph()
    if (!raf) raf = requestAnimationFrame(tick)
  }
})
watch(() => props.highlightRoot, () => { /* 仅影响 draw,无副作用 */ })
</script>

<template>
  <div ref="wrapEl" class="fg-wrap">
    <canvas ref="canvasEl" class="fg-canvas" />
    <div v-if="!props.nodes.length" class="fg-empty">满天星等待编织…</div>
    <div class="fg-legend">
      <span class="fg-legend-dot learned" />已学
      <span class="fg-legend-dot mastered" />掌握
      <span class="fg-legend-dot" />未学
      <span class="fg-hint">滚轮缩放 · 拖拽空白平移 · 双击聚焦</span>
    </div>
  </div>
</template>

<style scoped>
.fg-wrap { position: relative; width: 100%; height: 100%; min-height: 460px; }
.fg-canvas { display: block; width: 100%; height: 100%; cursor: grab; background: transparent; touch-action: none; }
.fg-empty {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  color: var(--text-3); font-size: var(--fs-base); letter-spacing: 0.08em;
}
.fg-legend {
  position: absolute; left: 14px; bottom: 12px; display: flex; align-items: center; gap: 14px;
  font-size: var(--fs-2xs); color: var(--text-3); font-family: var(--mono, monospace); letter-spacing: 0.05em;
  padding: 6px 10px; border: 1px solid var(--line); border-radius: 999px; background: color-mix(in srgb, var(--bg) 65%, transparent);
  pointer-events: none;
}
.fg-legend-dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: var(--text-3); }
.fg-legend-dot.learned { background: color-mix(in srgb, var(--accent) 80%, transparent); }
.fg-legend-dot.mastered { background: var(--accent); box-shadow: 0 0 6px var(--accent); }
.fg-hint { color: var(--text-3); opacity: 0.8; }
</style>
