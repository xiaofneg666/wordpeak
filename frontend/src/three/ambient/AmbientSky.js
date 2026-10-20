// AmbientSky — 全站共享的 Three.js 环境天空
// 一层固定背景,替掉原来 90 颗 Canvas2D 星尘:
//   · 三层视差星野(远/中/近),着色器闪烁,少量暖金亮点
//   · 三团低透明度星云(程序化云纹,不是纯 CSS 径向渐变)
// 领地星座不在这里画 —— 交给 TerritoryMark 跟随各页 .terr-head 定位。
// 纪律与旧 Canvas 层一致:30fps 封顶 / 页面隐藏暂停 / 圣殿与官网自带 3D 时整层歇着 /
// 低端机减粒 / prefers-reduced-motion 只画一帧静态图。
// 宣纸主题不做夜空:星点换成极淡墨尘,星云压到近无,不出现夜色。
import * as THREE from 'three'

const TAU = Math.PI * 2
const clamp = (v, a, b) => Math.max(a, Math.min(b, v))

// ---------- CSS 令牌读取 ----------
function readVar(name, fallback) {
  if (typeof document === 'undefined') return fallback
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}
export function tokenColor(name, fallback) {
  try { return new THREE.Color(readVar(name, fallback)) } catch { return new THREE.Color(fallback) }
}

// ---------- 程序化纹理 ----------
export function makeStarTexture() {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  grd.addColorStop(0, 'rgba(255,255,255,1)')
  grd.addColorStop(0.22, 'rgba(255,255,255,0.92)')
  grd.addColorStop(0.5, 'rgba(255,255,255,0.35)')
  grd.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grd
  g.fillRect(0, 0, 64, 64)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

// 云纹:在 256 画布上叠 16 个随机柔斑,读起来像有内部结构的星云,而不是一个圆
function makeCloudTexture(seed) {
  const c = document.createElement('canvas')
  c.width = c.height = 256
  const g = c.getContext('2d')
  let s = seed >>> 0
  const rnd = () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
  g.globalCompositeOperation = 'lighter'
  for (let i = 0; i < 18; i++) {
    const x = 48 + rnd() * 160
    const y = 48 + rnd() * 160
    const r = 28 + rnd() * 76
    const a = 0.05 + rnd() * 0.1
    const grd = g.createRadialGradient(x, y, 0, x, y, r)
    grd.addColorStop(0, `rgba(255,255,255,${a})`)
    grd.addColorStop(0.55, `rgba(255,255,255,${a * 0.4})`)
    grd.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = grd
    g.beginPath()
    g.arc(x, y, r, 0, TAU)
    g.fill()
  }
  // 边缘收干净,避免平面在屏幕上出现矩形边界
  g.globalCompositeOperation = 'destination-in'
  const mask = g.createRadialGradient(128, 128, 30, 128, 128, 126)
  mask.addColorStop(0, 'rgba(255,255,255,1)')
  mask.addColorStop(0.62, 'rgba(255,255,255,0.8)')
  mask.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = mask
  g.fillRect(0, 0, 256, 256)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

// ---------- 星座纹样 ----------
const V = (x, y, hot = 0) => [x, y, hot]
const chain = (n) => Array.from({ length: Math.max(0, n - 1) }, (_, i) => [i, i + 1])
const closed = (n) => chain(n).concat(n > 2 ? [[n - 1, 0]] : [])
const ringPts = (n, rx, ry = rx, rot = -Math.PI / 2, cx = 0, cy = 0) =>
  Array.from({ length: n }, (_, i) => {
    const a = rot + (i / n) * TAU
    return V(cx + Math.cos(a) * rx, cy + Math.sin(a) * ry)
  })

// 每个领地一个可辨认的星图:观测环 / 学习舱 / 熔炉 / 网络 / 旋臂 / 声波 / 齿轮 /
// 回声弧 / 麦克风 / 铁轨 / 羽毛笔 / 书页 / 罗盘 / 书架 / 星团 / 网格 / 族树 / 虚空 / 滑杆
export function motifFor(kind) {
  switch (kind) {
    case 'dashboard': {
      const pts = ringPts(8, 0.86, 0.6, -Math.PI / 2).concat([
        V(0, 0, 1), V(0, -0.98), V(0.98, 0), V(0, 0.98), V(-0.98, 0),
      ])
      const edges = closed(8).concat([[0, 8], [2, 8], [4, 8], [6, 8], [8, 9], [8, 10], [8, 11], [8, 12]])
      return { pts, edges, hue: '--accent' }
    }
    case 'learn': {
      const outer = ringPts(3, 0.92, 0.92, -Math.PI / 2)
      const inner = ringPts(3, 0.44, 0.44, -Math.PI / 2)
      const pts = outer.concat(inner, [V(0, 0.06, 1)])
      const edges = closed(3).concat(closed(3).map(([a, b]) => [a + 3, b + 3]), [[0, 3], [1, 4], [2, 5], [0, 6], [1, 6], [2, 6]])
      return { pts, edges, hue: '--accent' }
    }
    case 'lab': {
      const pts = ringPts(6, 0.9, 0.9, -Math.PI / 2).concat(ringPts(6, 0.42, 0.42, 0, 0, 0), [V(0, 0, 1)])
      const edges = closed(6).concat(closed(6).map(([a, b]) => [a + 6, b + 6]))
      for (let i = 0; i < 6; i += 2) edges.push([i, 12], [i + 6, 12])
      return { pts, edges, hue: '--warn', orbit: true }
    }
    case 'network': {
      let s = 0x9e3779b9
      const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 }
      const pts = Array.from({ length: 9 }, (_, i) => {
        const a = (i / 9) * TAU + rnd() * 0.35
        const r = 0.34 + rnd() * 0.6
        return V(Math.cos(a) * r, Math.sin(a) * r, i === 0 ? 1 : 0)
      })
      const edges = []
      pts.forEach((p, i) => {
        const near = pts.map((q, j) => ({ j, d: Math.hypot(p[0] - q[0], p[1] - q[1]) }))
          .filter((o) => o.j !== i).sort((a, b) => a.d - b.d).slice(0, 2)
        for (const n of near) if (!edges.some(([a, b]) => (a === i && b === n.j) || (a === n.j && b === i))) edges.push([i, n.j])
      })
      return { pts, edges, hue: '--info' }
    }
    case 'galaxy': {
      const pts = [V(0, 0, 1)]
      const edges = []
      for (let arm = 0; arm < 2; arm++) {
        const start = pts.length
        for (let i = 0; i < 8; i++) {
          const a = arm * Math.PI + i * 0.52
          const r = 0.14 + i * 0.095
          pts.push(V(Math.cos(a) * r, Math.sin(a) * r, i === 7 ? 1 : 0))
        }
        edges.push([0, start])
        for (let i = 0; i < 7; i++) edges.push([start + i, start + i + 1])
      }
      return { pts, edges, hue: '--accent', orbit: true }
    }
    case 'phonetics': {
      const pts = []
      const edges = []
      for (let i = 0; i < 13; i++) {
        const x = -0.92 + (i / 12) * 1.84
        const y = Math.sin(i * 0.78) * 0.42 * (1 - Math.abs(x) * 0.34)
        pts.push(V(x, y, i === 6 ? 1 : 0))
        if (i) edges.push([i - 1, i])
      }
      pts.push(V(-0.92, -0.62), V(0.92, -0.62))
      edges.push([0, 13], [12, 14])
      return { pts, edges, hue: '--warn' }
    }
    case 'grammar': {
      const pts = []
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * TAU
        const r = i % 2 ? 0.64 : 0.9
        pts.push(V(Math.cos(a) * r, Math.sin(a) * r))
      }
      const inner = ringPts(6, 0.3, 0.3, 0)
      pts.push(...inner, V(0, 0, 1))
      const edges = closed(14).concat(closed(6).map(([a, b]) => [a + 14, b + 14]))
      for (let i = 0; i < 6; i++) edges.push([i * 2, 14 + i], [20, 14 + i])
      return { pts, edges, hue: '--info', orbit: true }
    }
    case 'listening': {
      const pts = [V(0, 0, 1)]
      const edges = []
      for (let ring = 0; ring < 3; ring++) {
        const start = pts.length
        const rad = 0.36 + ring * 0.27
        for (let i = 0; i <= 6; i++) {
          const a = -0.9 + (i / 6) * 1.8
          pts.push(V(Math.cos(a) * rad, Math.sin(a) * rad))
          if (i) edges.push([start + i - 1, start + i])
        }
        edges.push([0, start])
      }
      return { pts, edges, hue: '--accent' }
    }
    case 'speaking': {
      const pts = [
        V(-0.26, 0.2), V(-0.26, 0.56), V(-0.16, 0.8), V(0, 0.9), V(0.16, 0.8), V(0.26, 0.56), V(0.26, 0.2),
        V(-0.56, -0.24), V(-0.36, -0.54), V(0, -0.66), V(0.36, -0.54), V(0.56, -0.24),
        V(0, -0.66), V(0, -0.98),
      ]
      pts[0] = V(-0.26, 0.2, 1)
      const edges = chain(7).concat(chain(5).map(([a, b]) => [a + 7, b + 7]), [[6, 8], [7, 8], [11, 12], [12, 13]])
      return { pts, edges, hue: '--accent-2' }
    }
    case 'reading':
    case 'reader': {
      const pts = [V(-0.94, 0.3), V(0.94, 0.3), V(-0.94, -0.3), V(0.94, -0.3)]
      const edges = [[0, 1], [2, 3]]
      for (let i = 0; i < 5; i++) {
        const x = -0.62 + i * 0.31
        pts.push(V(x, 0.3), V(x, -0.3))
        edges.push([4 + i * 2, 5 + i * 2])
      }
      pts.push(V(0, 0.34, 1))
      return { pts, edges, hue: kind === 'reader' ? '--accent-2' : '--success' }
    }
    case 'writing': {
      const pts = [V(-0.78, -0.86), V(-0.3, -0.32), V(0.1, 0.24), V(0.52, 0.74, 1), V(-0.05, 0.08), V(0.18, 0.38), V(0.4, 0.58), V(-0.46, -0.18)]
      const edges = [[0, 1], [1, 2], [2, 3], [1, 4], [4, 5], [5, 6], [1, 7], [7, 4], [2, 5], [6, 3]]
      pts.push(V(0.76, 0.44), V(0.86, 0.26), V(0.62, 0.2))
      edges.push([3, 8], [8, 9], [9, 10], [10, 3])
      return { pts, edges, hue: '--accent-3' }
    }
    case 'diary': {
      const pts = [V(-0.62, -0.78), V(0.5, -0.78), V(0.5, 0.78), V(-0.62, 0.78), V(0.22, 0.78, 1), V(0.5, 0.42)]
      const edges = [[0, 1], [1, 2], [2, 3], [3, 0], [2, 5], [5, 4], [4, 2]]
      for (let i = 0; i < 3; i++) {
        pts.push(V(-0.4, 0.3 - i * 0.34), V(0.26, 0.3 - i * 0.34))
        edges.push([6 + i * 2, 7 + i * 2])
      }
      return { pts, edges, hue: '--accent-2' }
    }
    case 'tips': {
      const pts = ringPts(8, 0.84, 0.84, -Math.PI / 2).concat([
        V(0, 0.72, 1), V(-0.24, -0.06), V(0, -0.62), V(0.24, -0.06),
      ])
      const edges = closed(8).concat([[0, 8], [8, 9], [9, 10], [10, 11], [11, 8]])
      return { pts, edges, hue: '--accent', orbit: true }
    }
    case 'bookshelf': {
      const pts = []
      const edges = []
      for (let shelf = 0; shelf < 3; shelf++) {
        const y = -0.68 + shelf * 0.58
        const base = pts.length
        pts.push(V(-0.92, y, shelf === 1 ? 1 : 0), V(0.92, y))
        edges.push([base, base + 1])
        for (let b = 0; b < 5; b++) {
          const x = -0.7 + b * 0.31
          pts.push(V(x, y), V(x, y + 0.28 + (b % 3) * 0.05))
          edges.push([base + 2 + b * 2, base + 3 + b * 2])
        }
      }
      return { pts, edges, hue: '--success' }
    }
    case 'collections': {
      let s = 0x51ed270b
      const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 }
      const pts = Array.from({ length: 10 }, (_, i) => {
        const a = rnd() * TAU
        const r = 0.2 + rnd() * 0.7
        return V(Math.cos(a) * r, Math.sin(a) * r, i === 3 ? 1 : 0)
      })
      const edges = []
      pts.forEach((p, i) => {
        const near = pts.map((q, j) => ({ j, d: Math.hypot(p[0] - q[0], p[1] - q[1]) }))
          .filter((o) => o.j !== i).sort((a, b) => a.d - b.d).slice(0, 1)
        for (const n of near) if (!edges.some(([a, b]) => (a === i && b === n.j) || (a === n.j && b === i))) edges.push([i, n.j])
      })
      return { pts, edges, hue: '--accent' }
    }
    case 'lexicon': {
      const pts = []
      const edges = []
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 4; c++) {
          pts.push(V(-0.72 + c * 0.48, 0.6 - r * 0.6, r === 1 && c === 2 ? 1 : 0))
          const i = r * 4 + c
          if (c) edges.push([i - 1, i])
          if (r) edges.push([i - 4, i])
        }
      }
      return { pts, edges, hue: '--accent' }
    }
    case 'family': {
      const pts = [
        V(0, -0.94), V(0, -0.22, 1), V(-0.6, 0.18), V(0.6, 0.18), V(0, 0.66),
        V(-0.84, 0.62), V(-0.38, 0.7), V(0.38, 0.7), V(0.84, 0.62),
      ]
      const edges = [[0, 1], [1, 2], [1, 3], [1, 4], [2, 5], [2, 6], [3, 7], [3, 8], [4, 2], [4, 3]]
      return { pts, edges, hue: '--accent-2' }
    }
    case 'mistakes': {
      const pts = [V(-0.62, 0.42), V(0.58, 0.28, 1), V(0.05, -0.64), V(-0.05, 0.02)]
      return { pts, edges: [[0, 1], [1, 2], [2, 0]], hue: '--danger', dim: 0.55 }
    }
    case 'settings': {
      const pts = []
      const edges = []
      const knobs = [-0.34, 0.2, 0.52]
      for (let i = 0; i < 3; i++) {
        const y = 0.52 - i * 0.52
        const base = pts.length
        pts.push(V(-0.82, y), V(0.82, y), V(knobs[i], y, 1))
        edges.push([base, base + 1])
      }
      return { pts, edges, hue: '--text-3', dim: 0.7 }
    }
    case 'site': {
      const pts = [V(-0.7, -0.72), V(-0.7, 0.34), V(-0.32, 0.34), V(-0.32, -0.12), V(0, 0.86, 1), V(0.32, -0.12), V(0.32, 0.34), V(0.7, 0.34), V(0.7, -0.72), V(0, -0.72)]
      const edges = [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 8], [8, 9], [9, 0]]
      return { pts, edges, hue: '--gold' }
    }
    default: {
      const pts = ringPts(7, 0.82, 0.62, -Math.PI / 2).concat([V(0, 0, 1)])
      return { pts, edges: closed(7).concat([[0, 7], [2, 7], [4, 7], [6, 7]]), hue: '--accent' }
    }
  }
}

// 星野着色器:圆形柔边 + 逐星闪烁;uOpacity 由主题/层深控制
const STAR_VERT = `
  attribute float aSize;
  attribute float aPhase;
  attribute float aSpeed;
  attribute float aTint;
  uniform float uTime;
  uniform float uPixelRatio;
  uniform float uDrift;
  varying float vTint;
  varying float vAlpha;
  void main() {
    vec3 p = position;
    p.x += sin(uTime * 0.045 + aPhase) * 0.006;
    p.y += cos(uTime * 0.032 + aPhase * 1.7) * 0.005;
    vTint = aTint;
    float tw = 0.66 + 0.34 * sin(uTime * aSpeed + aPhase);
    vAlpha = mix(1.0, tw, uDrift);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
    gl_PointSize = aSize * uPixelRatio;
  }
`
const STAR_FRAG = `
  uniform vec3 uColorA;
  uniform vec3 uColorB;
  uniform vec3 uColorGold;
  uniform float uOpacity;
  varying float vTint;
  varying float vAlpha;
  void main() {
    vec2 q = gl_PointCoord - 0.5;
    float d = dot(q, q);
    if (d > 0.25) discard;
    float a = smoothstep(0.25, 0.0, d);
    vec3 col = mix(uColorA, uColorB, vTint);
    col = mix(col, uColorGold, smoothstep(0.9, 1.0, vTint));
    gl_FragColor = vec4(col, a * uOpacity * vAlpha);
    #include <colorspace_fragment>
  }
`

// 星云在暗主题用加色,在宣纸主题用正常混合(白底上加法只会糊成一片白)
const CLOUDS = [
  { x: -0.30, y: 0.30, sx: 1.12, sy: 0.96, hue: '--accent', o: 0.075, ph: 0.4, speed: 0.020 },
  { x: 0.34, y: 0.12, sx: 0.9, sy: 0.8, hue: '--accent-2', o: 0.055, ph: 2.1, speed: 0.016 },
  { x: 0.06, y: -0.42, sx: 1.2, sy: 0.9, hue: '--accent-3', o: 0.038, ph: 4.2, speed: 0.013 },
]

export class AmbientSky {
  constructor(canvas, { onFail } = {}) {
    this.canvas = canvas
    this.ok = false
    this.disposed = false
    this.view = null
    this.active = true
    this.light = false
    this.time = 0
    this.last = 0
    this.raf = 0
    this.stars = []
    this.clouds = []
    this.pointer = { x: 0, y: 0, sx: 0, sy: 0 }
    this.wheel = 0
    this.reduceMotion = !!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
    this.lowEnd = (navigator.hardwareConcurrency || 8) < 4 || (navigator.deviceMemory || 8) < 4

    try {
      this.renderer = new THREE.WebGLRenderer({
        canvas,
        alpha: true,
        antialias: false,
        powerPreference: 'low-power',
        premultipliedAlpha: true,
      })
    } catch (e) {
      onFail?.(e)
      return
    }
    this.renderer.setClearColor(0x000000, 0)
    this.renderer.setPixelRatio(this.lowEnd ? 1 : Math.min(window.devicePixelRatio || 1, 1.5))
    this.renderer.outputColorSpace = THREE.SRGBColorSpace

    this.scene = new THREE.Scene()
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100)
    this.camera.position.z = 10

    this.starTex = makeStarTexture()
    this.cloudTextures = [makeCloudTexture(11), makeCloudTexture(29), makeCloudTexture(53)]

    this._buildStars()
    this._buildClouds()

    this._onResize = () => this.resize()
    this._onMove = (e) => {
      this.pointer.x = (e.clientX / Math.max(1, window.innerWidth) - 0.5) * 2
      this.pointer.y = (e.clientY / Math.max(1, window.innerHeight) - 0.5) * 2
    }
    this._onWheel = (e) => {
      this.wheel = clamp(this.wheel + e.deltaY * 0.05, -52, 52)
    }
    this._onTheme = (e) => this.setTheme(e?.detail?.theme)
    this._onVisibility = () => this._syncLoop()

    window.addEventListener('resize', this._onResize)
    window.addEventListener('pointermove', this._onMove, { passive: true })
    window.addEventListener('wheel', this._onWheel, { passive: true })
    window.addEventListener('wv:themechange', this._onTheme)
    document.addEventListener('visibilitychange', this._onVisibility)

    this.ok = true
    this.resize()
    this.setTheme(document.documentElement.getAttribute('data-theme') || 'dark', true)
    this._syncLoop()
    if (this.reduceMotion) this._render(0)
  }

  // ---------- 星野 ----------
  _buildStars() {
    const total = this.lowEnd ? 260 : 620
    const layers = [
      { n: Math.round(total * 0.44), size: [0.7, 1.3], opacity: 0.30, par: 3.5 },
      { n: Math.round(total * 0.38), size: [1.1, 1.9], opacity: 0.46, par: 8.5 },
      { n: Math.round(total * 0.18), size: [1.6, 2.8], opacity: 0.60, par: 16 },
    ]
    layers.forEach((cfg, li) => {
      const pos = new Float32Array(cfg.n * 3)
      const size = new Float32Array(cfg.n)
      const phase = new Float32Array(cfg.n)
      const speed = new Float32Array(cfg.n)
      const tint = new Float32Array(cfg.n)
      for (let i = 0; i < cfg.n; i++) {
        let x = Math.random() * 2 - 1
        let y = Math.random() * 2 - 1
        // 35% 的星压进一条斜向银河带;只在中/远层做,近层保留散星
        if (li < 2 && Math.random() < 0.35) {
          const along = Math.random() * 2 - 1
          const band = (Math.random() + Math.random() + Math.random() - 1.5) * 0.16
          x = along
          y = -0.42 + along * 0.46 + band
        }
        pos[i * 3] = x
        pos[i * 3 + 1] = y
        pos[i * 3 + 2] = 0
        size[i] = cfg.size[0] + Math.random() * (cfg.size[1] - cfg.size[0])
        phase[i] = Math.random() * TAU
        speed[i] = 0.35 + Math.random() * 1.5
        tint[i] = Math.random() < 0.055 ? 0.97 : Math.random() * 0.85
      }
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
      geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1))
      geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1))
      geo.setAttribute('aSpeed', new THREE.BufferAttribute(speed, 1))
      geo.setAttribute('aTint', new THREE.BufferAttribute(tint, 1))
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uPixelRatio: { value: this.renderer.getPixelRatio() },
          uDrift: { value: this.reduceMotion ? 0 : 1 },
          uColorA: { value: new THREE.Color('#22d3ee') },
          uColorB: { value: new THREE.Color('#f5f7fa') },
          uColorGold: { value: new THREE.Color('#f2ead8') },
          uOpacity: { value: cfg.opacity },
        },
        vertexShader: STAR_VERT,
        fragmentShader: STAR_FRAG,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
      })
      const points = new THREE.Points(geo, mat)
      points.frustumCulled = false
      points.renderOrder = li
      points.userData.par = cfg.par
      points.userData.layer = li
      this.scene.add(points)
      this.stars.push({ points, mat, cfg, factor: cfg.par })
    })
  }

  // ---------- 星云 ----------
  _buildClouds() {
    CLOUDS.forEach((cfg, i) => {
      const mat = new THREE.SpriteMaterial({
        map: this.cloudTextures[i],
        color: new THREE.Color('#22d3ee'),
        transparent: true,
        opacity: cfg.o,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false,
      })
      const sprite = new THREE.Sprite(mat)
      sprite.renderOrder = -10
      sprite.userData.cfg = cfg
      this.scene.add(sprite)
      this.clouds.push({ sprite, mat, cfg })
    })
  }

  setView(kind) {
    if (!this.ok) return
    // 领地星座由 TerritoryMark 渲染在页头右侧;环境层只保留星野与星云。
    // 这里仅记录当前领地,保留未来做整屏星图切换的入口。
    this.view = kind
  }

  setTheme(theme, initial = false) {
    if (!this.ok) return
    this.light = theme === 'light'
    if (!this.light && theme !== 'violet' && theme !== 'catppuccin' && theme !== 'dark') {
      // 未知主题按深空处理,读到的令牌仍会给出正确色
      this.light = false
    }
    const accent = tokenColor('--accent', '#22d3ee')
    const accent2 = tokenColor('--accent-2', '#a78bfa')
    const accent3 = tokenColor('--accent-3', '#f472b6')
    const text = tokenColor('--text', '#f5f7fa')
    const gold = tokenColor('--gold', '#f2ead8')

    for (const s of this.stars) {
      const u = s.mat.uniforms
      u.uColorA.value.copy(this.light ? tokenColor('--text-3', '#66738A') : accent)
      u.uColorB.value.copy(this.light ? tokenColor('--accent', '#3D5A85') : text)
      u.uColorGold.value.copy(gold)
      u.uOpacity.value = s.cfg.opacity * (this.light ? 0.30 : 1)
      s.mat.blending = this.light ? THREE.NormalBlending : THREE.AdditiveBlending
      s.mat.needsUpdate = true
    }

    for (const c of this.clouds) {
      const base = tokenColor(c.cfg.hue, '#22d3ee')
      c.mat.color.copy(this.light ? tokenColor('--text-3', '#66738A') : base)
      c.mat.opacity = this.light ? c.cfg.o * 0.16 : c.cfg.o
      c.mat.blending = this.light ? THREE.NormalBlending : THREE.AdditiveBlending
      c.mat.needsUpdate = true
    }

    // 色板:星云在暗主题的第三团用 accent-3,切主题时保持
    if (this.clouds[0]) this.clouds[0].mat.color.copy(this.light ? tokenColor('--text-3', '#66738A') : accent)
    if (this.clouds[1]) this.clouds[1].mat.color.copy(this.light ? tokenColor('--text-3', '#66738A') : accent2)
    if (this.clouds[2]) this.clouds[2].mat.color.copy(this.light ? tokenColor('--gold', '#8F6B2A') : accent3)

    if (!initial && this.reduceMotion) this._render(0)
  }

  setActive(on) {
    if (!this.ok) return
    this.active = !!on
    this._syncLoop()
  }

  resize() {
    if (!this.ok) return
    const w = Math.max(1, window.innerWidth)
    const h = Math.max(1, window.innerHeight)
    this.w = w
    this.h = h
    this.renderer.setSize(w, h, false)
    this.camera.left = -w / 2
    this.camera.right = w / 2
    this.camera.top = h / 2
    this.camera.bottom = -h / 2
    this.camera.updateProjectionMatrix()

    for (const s of this.stars) {
      s.points.scale.set(w * 0.53, h * 0.53, 1)
      s.mat.uniforms.uPixelRatio.value = this.renderer.getPixelRatio()
    }
    for (const c of this.clouds) {
      c.sprite.scale.set(w * c.cfg.sx, h * c.cfg.sy, 1)
      c.sprite.position.set(c.cfg.x * w, c.cfg.y * h, -1)
    }
    if (this.reduceMotion) this._render(0)
  }

  _syncLoop() {
    if (!this.ok || this.disposed) return
    const should = this.active && !document.hidden
    if (should && !this.raf && !this.reduceMotion) {
      this.last = 0
      this.raf = requestAnimationFrame(this._frame)
    } else if (!should && this.raf) {
      cancelAnimationFrame(this.raf)
      this.raf = 0
    } else if (should && this.reduceMotion) {
      this._render(0)
    }
  }

  _frame = (ts) => {
    if (this.disposed) return
    this.raf = requestAnimationFrame(this._frame)
    if (!this.active || document.hidden) return
    if (ts - this.last < 33) return // 30fps 封顶
    const dt = Math.min(0.1, (ts - this.last) / 1000 || 0.016)
    this.last = ts
    this.time += dt
    this._render(dt)
  }

  _render(dt) {
    if (!this.ok) return
    const t = this.time
    const k = Math.min(1, dt * 3)
    if (!this.reduceMotion) {
      this.pointer.sx += (this.pointer.x - this.pointer.sx) * k
      this.pointer.sy += (this.pointer.y - this.pointer.sy) * k
      this.wheel *= Math.exp(-dt * 2.2)
    }

    for (const s of this.stars) {
      s.mat.uniforms.uTime.value = t
      s.points.position.set(
        -this.pointer.sx * s.factor,
        this.pointer.sy * s.factor - this.wheel * (s.factor / 16),
        0,
      )
    }

    for (const c of this.clouds) {
      const { cfg } = c
      c.sprite.position.set(
        cfg.x * this.w + Math.sin(t * cfg.speed + cfg.ph) * 26 - this.pointer.sx * (5 + cfg.sx * 2),
        cfg.y * this.h + Math.cos(t * cfg.speed * 0.8 + cfg.ph) * 20 + this.pointer.sy * (4 + cfg.sy * 2) - this.wheel * 0.03,
        -1,
      )
      c.mat.rotation = Math.sin(t * 0.01 + cfg.ph) * 0.16
    }

    this.renderer.render(this.scene, this.camera)
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    cancelAnimationFrame(this.raf)
    this.raf = 0
    window.removeEventListener('resize', this._onResize)
    window.removeEventListener('pointermove', this._onMove)
    window.removeEventListener('wheel', this._onWheel)
    window.removeEventListener('wv:themechange', this._onTheme)
    document.removeEventListener('visibilitychange', this._onVisibility)
    for (const s of this.stars) {
      s.points.geometry.dispose()
      s.mat.dispose()
    }
    for (const c of this.clouds) c.mat.dispose()
    for (const t of this.cloudTextures) t.dispose()
    this.starTex?.dispose()
    this.renderer?.forceContextLoss?.()
    this.renderer?.dispose()
    this.ok = false
  }
}
