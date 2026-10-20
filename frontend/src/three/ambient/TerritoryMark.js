// TerritoryMark — 领地页头右侧的小型 Three.js 星座徽记
// 与全站环境天空同源,但独立渲染在一个 280×210 的透明画布上:
// 每个领地有自己的星图(观测环/齿轮/铁轨/族树……),切页时重新绘制;
// 画布 fixed 定位并跟随当前 .terr-head 的右缘,滚出页头即淡出 —— 它属于页头,不是浮在内容上的贴纸。
// 单独一个 WebGL 上下文(小画布,antialias 开),只在大屏且页头可见时运行。
import * as THREE from 'three'
import { motifFor, tokenColor, makeStarTexture } from './AmbientSky.js'

const TAU = Math.PI * 2
const clamp = (v, a, b) => Math.max(a, Math.min(b, v))
const SKIP = new Set(['galaxy', 'site', 'dashboard', 'reader', 'settings'])
const NAV_H = 64

export class TerritoryMark {
  constructor(canvas, { view = 'dashboard' } = {}) {
    this.canvas = canvas
    this.ok = false
    this.disposed = false
    this.view = null
    this.light = false
    this.time = 0
    this.last = 0
    this.raf = 0
    this.syncAcc = 0
    this.visible = false
    this.life = 0
    this.anchor = null
    this.motif = null
    this.W = 280
    this.H = 210
    this.reduceMotion = !!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches

    try {
      this.renderer = new THREE.WebGLRenderer({
        canvas,
        alpha: true,
        antialias: true,
        powerPreference: 'low-power',
        premultipliedAlpha: true,
      })
    } catch {
      return
    }
    this.renderer.setClearColor(0x000000, 0)
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    this.renderer.setSize(this.W, this.H, false)
    this.renderer.outputColorSpace = THREE.SRGBColorSpace

    this.scene = new THREE.Scene()
    this.camera = new THREE.OrthographicCamera(-this.W / 2, this.W / 2, this.H / 2, -this.H / 2, 0.1, 100)
    this.camera.position.z = 10
    this.starTex = makeStarTexture()

    this._onTheme = (e) => this.setTheme(e?.detail?.theme)
    this._onResize = () => this.syncAnchor()
    this._onScroll = () => this._queueSync()
    this._onVisibility = () => this._syncLoop()
    window.addEventListener('wv:themechange', this._onTheme)
    window.addEventListener('resize', this._onResize)
    window.addEventListener('scroll', this._onScroll, true)
    document.addEventListener('visibilitychange', this._onVisibility)
    this._syncTimer = setInterval(() => this.syncAnchor(), 320)

    this.ok = true
    this.setTheme(document.documentElement.getAttribute('data-theme') || 'dark', true)
    this.setView(view)
    this.syncAnchor()
    this._syncLoop()
  }

  setView(view) {
    if (!this.ok || this.view === view) {
      this.view = view
      return
    }
    this.view = view
    this.life = 0
    this._buildMotif()
    this.syncAnchor()
    if (this.reduceMotion) this._render(0)
  }

  _buildMotif() {
    if (this.motif) this._disposeMotif()
    if (SKIP.has(this.view)) {
      this.motif = null
      return
    }
    const data = motifFor(this.view)
    const group = new THREE.Group()
    const pts = data.pts.map(([x, y, hot]) => ({ x, y, hot }))

    const edgePos = new Float32Array(data.edges.length * 6)
    data.edges.forEach(([a, b], i) => {
      const p = pts[a], q = pts[b]
      edgePos.set([p.x, p.y, 0, q.x, q.y, 0], i * 6)
    })
    const lineGeo = new THREE.BufferGeometry()
    lineGeo.setAttribute('position', new THREE.BufferAttribute(edgePos, 3))
    const lineMat = new THREE.LineBasicMaterial({
      color: tokenColor(data.hue || '--accent', '#22d3ee'),
      transparent: true,
      opacity: 0.2,
      depthWrite: false,
      depthTest: false,
      blending: this.light ? THREE.NormalBlending : THREE.AdditiveBlending,
    })
    const lines = new THREE.LineSegments(lineGeo, lineMat)
    group.add(lines)

    const pr = this.renderer.getPixelRatio()
    const mkPoints = (list, size, opacity) => {
      const arr = new Float32Array(list.length * 3)
      list.forEach((p, i) => arr.set([p.x, p.y, 0], i * 3))
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.BufferAttribute(arr, 3))
      const m = new THREE.PointsMaterial({
        color: tokenColor(data.hue || '--accent', '#22d3ee'),
        size: size * pr,
        sizeAttenuation: false,
        map: this.starTex,
        transparent: true,
        opacity,
        depthWrite: false,
        depthTest: false,
        blending: this.light ? THREE.NormalBlending : THREE.AdditiveBlending,
      })
      return new THREE.Points(g, m)
    }
    const normal = mkPoints(pts.filter((p) => !p.hot), 2.6, 0.8)
    group.add(normal)
    const hotPts = pts.filter((p) => p.hot)
    let hot = null
    if (hotPts.length) {
      hot = mkPoints(hotPts, 5.2, 0.95)
      group.add(hot)
    }

    let orbitMat = null, orbitLine = null, satMat = null, satellite = null
    if (data.orbit !== false) {
      const c = new THREE.EllipseCurve(0, 0, 1.0, 0.42, 0, TAU)
      const op = c.getPoints(80).map((p) => new THREE.Vector3(p.x, p.y, 0))
      const og = new THREE.BufferGeometry().setFromPoints(op)
      orbitMat = new THREE.LineBasicMaterial({
        color: tokenColor(data.hue || '--accent', '#22d3ee'),
        transparent: true,
        opacity: 0.08,
        depthWrite: false,
        depthTest: false,
        blending: this.light ? THREE.NormalBlending : THREE.AdditiveBlending,
      })
      orbitLine = new THREE.LineLoop(og, orbitMat)
      orbitLine.rotation.z = -0.3
      group.add(orbitLine)

      const sm = new THREE.SpriteMaterial({
        map: this.starTex,
        color: tokenColor(data.hue || '--accent', '#22d3ee'),
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
        depthTest: false,
        blending: this.light ? THREE.NormalBlending : THREE.AdditiveBlending,
      })
      satellite = new THREE.Sprite(sm)
      // 卫星在缩放过的 motif group 里:尺寸要除以 group 的缩放,才能保持 8px 的视觉大小
      satellite.scale.set(8 / (Math.min(this.W, this.H) * 0.44), 8 / (Math.min(this.W, this.H) * 0.44), 1)
      group.add(satellite)
    }

    const span = Math.min(this.W, this.H) * 0.44
    group.scale.set(span, span, 1)
    group.position.set(6, 8, 0)
    this.scene.add(group)
    this.motif = {
      group, data, lines, lineMat, normal, normalMat: normal.material, hot, hotMat: hot?.material || null,
      orbitLine, orbitMat, satellite, satMat, phase: Math.random() * TAU,
    }
    this._applyThemeToMotif()
    if (this.reduceMotion) this.life = 1
  }

  _applyThemeToMotif() {
    const m = this.motif
    if (!m) return
    const hue = tokenColor(m.data.hue || '--accent', '#22d3ee')
    m.lineMat.color.copy(hue)
    m.normalMat.color.copy(hue)
    if (m.hotMat) m.hotMat.color.copy(this.light ? tokenColor('--gold', '#8F6B2A') : tokenColor('--text', '#f5f7fa'))
    if (m.orbitMat) m.orbitMat.color.copy(hue)
    if (m.satMat) m.satMat.color.copy(this.light ? tokenColor('--gold', '#8F6B2A') : tokenColor('--gold', '#f2ead8'))
    const blend = this.light ? THREE.NormalBlending : THREE.AdditiveBlending
    for (const mat of [m.lineMat, m.normalMat, m.hotMat, m.orbitMat, m.satMat]) {
      if (!mat) continue
      mat.blending = blend
      mat.needsUpdate = true
    }
  }

  setTheme(theme, initial = false) {
    if (!this.ok) return
    this.light = theme === 'light'
    if (this.motif) this._applyThemeToMotif()
    if (!initial && this.reduceMotion) this._render(0)
  }

  _findHost() {
    if (SKIP.has(this.view)) return null
    const list = [...document.querySelectorAll('.view-scroll .terr-head')]
    for (const el of list) {
      const r = el.getBoundingClientRect()
      if (r.width > 40 && r.height > 20 && getComputedStyle(el).visibility !== 'hidden') return el
    }
    return null
  }

  _queueSync() {
    if (this._syncQueued) return
    this._syncQueued = true
    requestAnimationFrame(() => {
      this._syncQueued = false
      this.syncAnchor()
    })
  }

  syncAnchor() {
    if (!this.ok || this.disposed) return
    const host = this._findHost()
    if (!host) {
      this.visible = false
      this.canvas.style.opacity = '0'
      this._syncLoop()
      return
    }
    const r = host.getBoundingClientRect()
    const vw = window.innerWidth
    const gap = 22
    let left = r.right + gap
    if (left + this.W > vw - 16) left = vw - this.W - 20
    const top = r.top + 14
    const onScreen = r.bottom > NAV_H + 20 && r.top < window.innerHeight - 40 && left > r.right - 8
    const fade = clamp((r.top - NAV_H + 70) / 90, 0, 1)
    this.visible = onScreen && fade > 0.02 && vw > 940
    this.canvas.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`
    this.canvas.style.opacity = this.visible ? String(fade) : '0'
    this._syncLoop()
  }

  _syncLoop() {
    if (!this.ok || this.disposed) return
    const should = this.visible && !document.hidden && !!this.motif
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
    if (!this.visible || document.hidden) return
    if (ts - this.last < 33) return
    const dt = Math.min(0.1, (ts - this.last) / 1000 || 0.016)
    this.last = ts
    this.time += dt
    this.syncAcc += dt
    if (this.syncAcc > 0.25) { this.syncAcc = 0; this.syncAnchor() }
    this._render(dt)
  }

  _render(dt) {
    if (!this.ok || !this.motif) return
    const m = this.motif
    this.life = clamp(this.life + dt / 0.9, 0, 1)
    const e = 1 - Math.pow(1 - this.life, 3)
    const dim = (m.data.dim || 1) * e
    m.lineMat.opacity = (this.light ? 0.30 : 0.22) * dim
    m.normalMat.opacity = (this.light ? 0.62 : 0.8) * dim
    if (m.hotMat) m.hotMat.opacity = 0.95 * dim
    if (m.orbitMat) m.orbitMat.opacity = (this.light ? 0.10 : 0.08) * e
    if (m.satMat) m.satMat.opacity = 0.9 * e
    if (m.satellite) {
      const a = this.time * 0.62 + m.phase
      const ox = Math.cos(a) * 1.0
      const oy = Math.sin(a) * 0.42
      const rot = -0.3
      m.satellite.position.set(ox * Math.cos(rot) - oy * Math.sin(rot), ox * Math.sin(rot) + oy * Math.cos(rot), 0)
    }
    m.group.rotation.z = Math.sin(this.time * 0.05 + m.phase) * 0.02
    this.renderer.render(this.scene, this.camera)
  }

  _disposeMotif() {
    const m = this.motif
    if (!m) return
    this.scene.remove(m.group)
    m.group.traverse((o) => { if (o.geometry) o.geometry.dispose() })
    for (const mat of [m.lineMat, m.normalMat, m.hotMat, m.orbitMat, m.satMat]) mat?.dispose()
    this.motif = null
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    cancelAnimationFrame(this.raf)
    this.raf = 0
    clearInterval(this._syncTimer)
    window.removeEventListener('wv:themechange', this._onTheme)
    window.removeEventListener('resize', this._onResize)
    window.removeEventListener('scroll', this._onScroll, true)
    document.removeEventListener('visibilitychange', this._onVisibility)
    this._disposeMotif()
    this.starTex?.dispose()
    this.renderer?.forceContextLoss?.()
    this.renderer?.dispose()
    this.ok = false
  }
}
