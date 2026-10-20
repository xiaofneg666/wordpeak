// HeroOrrery — 观星台首屏右侧的实时天体仪
// 取代原来的静态 SVG:一颗着色器行星 + 尘埃环 + 两颗卫星 + 背后的星座线。
// 轻量:单个小画布(约 320×210),30fps 封顶,切走视图停帧,减少动态时只画一帧。
// 颜色全部取主题令牌,宣纸主题下是一枚墨蓝/香槟金的行星仪,不套夜空。
import * as THREE from 'three'

function tokenColor(name, fallback) {
  if (typeof document === 'undefined') return new THREE.Color(fallback)
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  try { return new THREE.Color(v || fallback) } catch { return new THREE.Color(fallback) }
}

function softDot() {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  gr.addColorStop(0, 'rgba(255,255,255,1)')
  gr.addColorStop(0.3, 'rgba(255,255,255,0.7)')
  gr.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = gr
  g.fillRect(0, 0, 64, 64)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

const PLANET_VERT = `
  varying vec3 vNormal;
  varying vec3 vView;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vNormal = normalize(normalMatrix * normal);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vView = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`
const PLANET_FRAG = `
  uniform vec3 uColorDeep;
  uniform vec3 uColorLight;
  uniform vec3 uRim;
  uniform float uTime;
  varying vec3 vNormal;
  varying vec3 vView;
  varying vec2 vUv;
  void main() {
    vec3 n = normalize(vNormal);
    vec3 L = normalize(vec3(-0.82, 0.46, 0.34));
    float ndl = clamp(dot(n, L), 0.0, 1.0);
    float fres = pow(1.0 - clamp(abs(dot(n, vView)), 0.0, 1.0), 3.0);
    float bands = sin(vUv.y * 22.0 + sin(vUv.x * 8.0 + uTime * 0.05) * 0.7) * 0.5 + 0.5;
    float shade = smoothstep(-0.04, 0.62, ndl);
    vec3 base = mix(uColorDeep, uColorLight, smoothstep(-0.35, 0.9, n.y * 0.5 + (bands - 0.5) * 0.22 + 0.18));
    base *= 0.16 + 0.95 * shade;
    base += uRim * fres * (0.05 + ndl * 0.42);
    vec3 h = normalize(L + vView);
    base += uRim * pow(max(dot(n, h), 0.0), 46.0) * 0.45;
    gl_FragColor = vec4(base, 1.0);
    #include <colorspace_fragment>
  }
`
const ATMO_VERT = `
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    vNormal = normalize(normalMatrix * normal);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vView = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`
const ATMO_FRAG = `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    float rim = pow(1.0 - clamp(abs(dot(normalize(vNormal), vView)), 0.0, 1.0), 2.8);
    gl_FragColor = vec4(uColor, rim * uOpacity);
    #include <colorspace_fragment>
  }
`
const RING_VERT = `
  varying float vR;
  uniform float uInner;
  uniform float uOuter;
  void main() {
    vR = (length(position.xy) - uInner) / max(0.0001, uOuter - uInner);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`
const RING_FRAG = `
  uniform vec3 uColorA;
  uniform vec3 uColorB;
  uniform float uOpacity;
  varying float vR;
  void main() {
    float edge = smoothstep(0.0, 0.06, vR) * smoothstep(1.0, 0.9, vR);
    float bands = 0.55 + 0.45 * sin(vR * 46.0 + sin(vR * 12.0) * 2.2);
    float division = 1.0 - 0.72 * smoothstep(0.46, 0.52, vR) * (1.0 - smoothstep(0.58, 0.64, vR));
    float a = edge * (0.14 + bands * 0.32) * division * uOpacity;
    vec3 col = mix(uColorA, uColorB, clamp(vR, 0.0, 1.0));
    gl_FragColor = vec4(col, a);
    #include <colorspace_fragment>
  }
`

export class HeroOrrery {
  constructor(canvas) {
    this.canvas = canvas
    this.ok = false
    this.disposed = false
    this.light = false
    this.time = 0
    this.last = 0
    this.raf = 0
    this.pointer = { x: 0, y: 0, sx: 0, sy: 0 }
    this.reduceMotion = !!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
    this.active = true

    try {
      this.renderer = new THREE.WebGLRenderer({
        canvas, alpha: true, antialias: true, powerPreference: 'low-power', premultipliedAlpha: true,
      })
    } catch { return }
    this.renderer.setClearColor(0x000000, 0)
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    this.renderer.outputColorSpace = THREE.SRGBColorSpace

    this.scene = new THREE.Scene()
    this.camera = new THREE.PerspectiveCamera(34, 1.48, 0.1, 50)
    this.camera.position.set(0, 0.35, 7.4)
    this.camera.lookAt(0, 0.05, 0)

    this.starTex = softDot()
    this.system = new THREE.Group()
    this.system.rotation.set(0.56, -0.05, -0.24)
    this.scene.add(this.system)

    this._buildPlanet()
    this._buildRings()
    this._buildSatellites()
    this._buildSky()

    this._onResize = () => this.resize()
    this._onTheme = (e) => this.setTheme(e?.detail?.theme)
    this._onMove = (e) => {
      this.pointer.x = (e.clientX / Math.max(1, window.innerWidth) - 0.5) * 2
      this.pointer.y = (e.clientY / Math.max(1, window.innerHeight) - 0.5) * 2
    }
    this._onVis = () => this._syncLoop()
    window.addEventListener('resize', this._onResize)
    window.addEventListener('wv:themechange', this._onTheme)
    window.addEventListener('pointermove', this._onMove, { passive: true })
    document.addEventListener('visibilitychange', this._onVis)

    this.ok = true
    this.resize()
    this.setTheme(document.documentElement.getAttribute('data-theme') || 'dark', true)
    this._syncLoop()
  }

  _buildPlanet() {
    this.planetMat = new THREE.ShaderMaterial({
      uniforms: {
        uColorDeep: { value: new THREE.Color('#07202c') },
        uColorLight: { value: new THREE.Color('#22d3ee') },
        uRim: { value: new THREE.Color('#67e8f9') },
        uTime: { value: 0 },
      },
      vertexShader: PLANET_VERT,
      fragmentShader: PLANET_FRAG,
    })
    this.planet = new THREE.Mesh(new THREE.SphereGeometry(1.16, 64, 48), this.planetMat)
    this.system.add(this.planet)

    this.atmoMat = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color('#22d3ee') },
        uOpacity: { value: 0.5 },
      },
      vertexShader: ATMO_VERT,
      fragmentShader: ATMO_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
    })
    this.atmo = new THREE.Mesh(new THREE.SphereGeometry(1.24, 48, 32), this.atmoMat)
    this.system.add(this.atmo)
  }

  _buildRings() {
    const inner = 1.48, outer = 2.28
    this.ringMat = new THREE.ShaderMaterial({
      uniforms: {
        uColorA: { value: new THREE.Color('#22d3ee') },
        uColorB: { value: new THREE.Color('#a78bfa') },
        uInner: { value: inner },
        uOuter: { value: outer },
        uOpacity: { value: 0.85 },
      },
      vertexShader: RING_VERT,
      fragmentShader: RING_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    })
    this.ring = new THREE.Mesh(new THREE.RingGeometry(inner, outer, 160, 1), this.ringMat)
    this.system.add(this.ring)

    // 外侧一条极细的虚线轨道:给尘埃环一个"仪器刻度"的外缘
    const pts = []
    const N = 160
    for (let i = 0; i <= N; i++) {
      const a = (i / N) * Math.PI * 2
      pts.push(new THREE.Vector3(Math.cos(a) * 2.52, Math.sin(a) * 2.52, 0))
    }
    const g = new THREE.BufferGeometry().setFromPoints(pts)
    this.outerOrbitMat = new THREE.LineBasicMaterial({
      color: new THREE.Color('#22d3ee'), transparent: true, opacity: 0.14, depthWrite: false,
    })
    this.outerOrbit = new THREE.Line(g, this.outerOrbitMat)
    this.system.add(this.outerOrbit)
  }

  _buildSatellites() {
    this.sats = []
    const defs = [
      { rx: 1.78, ry: 1.02, speed: 0.34, phase: 0.6, size: 0.075, color: '#22d3ee' },
      { rx: 2.5, ry: 1.38, speed: -0.22, phase: 2.4, size: 0.06, color: '#a78bfa' },
    ]
    for (const d of defs) {
      const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(d.color) })
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(d.size, 16, 12), mat)
      const gm = new THREE.SpriteMaterial({
        map: this.starTex, color: new THREE.Color(d.color), transparent: true,
        opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending,
      })
      const glow = new THREE.Sprite(gm)
      glow.scale.set(0.26, 0.26, 1)
      this.system.add(mesh, glow)
      this.sats.push({ ...d, mesh, glow, mat, glowMat: gm })
    }

    // 两条淡轨道线,让卫星的位置可读
    this.orbitMats = []
    for (const d of defs) {
      const pts = []
      for (let i = 0; i <= 96; i++) {
        const a = (i / 96) * Math.PI * 2
        pts.push(new THREE.Vector3(Math.cos(a) * d.rx, Math.sin(a) * d.ry, 0))
      }
      const g = new THREE.BufferGeometry().setFromPoints(pts)
      const m = new THREE.LineBasicMaterial({
        color: new THREE.Color(d.color), transparent: true, opacity: 0.12, depthWrite: false,
      })
      const line = new THREE.Line(g, m)
      this.system.add(line)
      this.orbitMats.push(m)
    }
  }

  _buildSky() {
    // 背后的星座线(旧 SVG 的星图语言保留下来,但不抢行星)
    const pts = [
      new THREE.Vector3(-2.3, 1.2, -3.4), new THREE.Vector3(-0.4, 0.2, -3.4),
      new THREE.Vector3(2.1, 1.5, -3.4), new THREE.Vector3(1.2, -1.2, -3.4),
      new THREE.Vector3(-1.4, -1.5, -3.4),
    ]
    this.constelMat = new THREE.LineBasicMaterial({
      color: new THREE.Color('#a78bfa'), transparent: true, opacity: 0.16, depthWrite: false,
    })
    const cg = new THREE.BufferGeometry().setFromPoints(pts.map((p) => p.clone()))
    this.constel = new THREE.Line(cg, this.constelMat)
    this.scene.add(this.constel)

    this.constelDots = []
    for (const p of pts) {
      const m = new THREE.SpriteMaterial({
        map: this.starTex, color: new THREE.Color('#a78bfa'), transparent: true,
        opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending,
      })
      const s = new THREE.Sprite(m)
      s.position.copy(p)
      s.scale.set(0.09, 0.09, 1)
      this.scene.add(s)
      this.constelDots.push(s)
    }

    // 星点:背景稀疏几颗,给透明画布一点空间感
    const N = 46
    const arr = new Float32Array(N * 3)
    for (let i = 0; i < N; i++) {
      arr[i * 3] = (Math.random() - 0.5) * 9.5
      arr[i * 3 + 1] = (Math.random() - 0.5) * 6.5
      arr[i * 3 + 2] = -4.5 - Math.random() * 4
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(arr, 3))
    this.starsMat = new THREE.PointsMaterial({
      color: new THREE.Color('#d9e6f2'), size: 0.035, map: this.starTex,
      transparent: true, opacity: 0.5, depthWrite: false,
      blending: THREE.AdditiveBlending, sizeAttenuation: true,
    })
    this.stars = new THREE.Points(g, this.starsMat)
    this.scene.add(this.stars)
  }

  setTheme(theme, initial = false) {
    if (!this.ok) return
    this.light = theme === 'light'
    const accent = tokenColor('--accent', '#22d3ee')
    const accent2 = tokenColor('--accent-2', '#a78bfa')
    const gold = tokenColor('--gold', '#f2ead8')
    const text = tokenColor('--text', '#f5f7fa')
    const text3 = tokenColor('--text-3', '#66738A')

    if (this.light) {
      this.planetMat.uniforms.uColorDeep.value.copy(tokenColor('--text', '#203653'))
      this.planetMat.uniforms.uColorLight.value.copy(accent2).multiplyScalar(0.9)
      this.planetMat.uniforms.uRim.value.copy(accent)
      this.atmoMat.uniforms.uColor.value.copy(accent)
      this.atmoMat.uniforms.uOpacity.value = 0.10
      this.atmoMat.blending = THREE.NormalBlending
      this.ringMat.uniforms.uColorA.value.copy(gold)
      this.ringMat.uniforms.uColorB.value.copy(accent2)
      this.ringMat.uniforms.uOpacity.value = 0.38
      this.ringMat.blending = THREE.NormalBlending
      this.outerOrbitMat.color.copy(gold)
      this.outerOrbitMat.opacity = 0.22
      this.constelMat.color.copy(accent)
      this.constelMat.opacity = 0.20
      this.starsMat.color.copy(text3)
      this.starsMat.opacity = 0.40
      this.starsMat.blending = THREE.NormalBlending
      this.starsMat.needsUpdate = true
      this.sats.forEach((s, i) => {
        const c = i === 0 ? accent : gold
        s.mat.color.copy(c)
        s.glowMat.color.copy(c)
        s.glowMat.opacity = 0.35
        s.glowMat.blending = THREE.NormalBlending
        s.glowMat.needsUpdate = true
      })
      this.orbitMats.forEach((m, i) => { m.color.copy(i === 0 ? accent : gold); m.opacity = 0.16 })
      this.constelDots.forEach((d) => {
        d.material.color.copy(accent)
        d.material.opacity = 0.40
        d.material.blending = THREE.NormalBlending
        d.material.needsUpdate = true
      })
    } else {
      this.planetMat.uniforms.uColorDeep.value.copy(accent).multiplyScalar(0.045)
      this.planetMat.uniforms.uColorLight.value.copy(accent).multiplyScalar(0.5).lerp(text, 0.06)
      this.planetMat.uniforms.uRim.value.copy(accent).lerp(text, 0.28)
      this.atmoMat.uniforms.uColor.value.copy(accent)
      this.atmoMat.uniforms.uOpacity.value = 0.22
      this.atmoMat.blending = THREE.AdditiveBlending
      this.ringMat.uniforms.uColorA.value.copy(accent).multiplyScalar(0.6)
      this.ringMat.uniforms.uColorB.value.copy(accent2).multiplyScalar(0.6)
      this.ringMat.uniforms.uOpacity.value = 0.36
      this.ringMat.blending = THREE.AdditiveBlending
      this.outerOrbitMat.color.copy(accent)
      this.outerOrbitMat.opacity = 0.14
      this.constelMat.color.copy(accent2)
      this.constelMat.opacity = 0.16
      this.starsMat.color.copy(text)
      this.starsMat.opacity = 0.5
      this.starsMat.blending = THREE.AdditiveBlending
      this.starsMat.needsUpdate = true
      this.sats.forEach((s, i) => {
        const c = i === 0 ? accent : accent2
        s.mat.color.copy(c)
        s.glowMat.color.copy(c)
        s.glowMat.opacity = 0.55
        s.glowMat.blending = THREE.AdditiveBlending
        s.glowMat.needsUpdate = true
      })
      this.orbitMats.forEach((m, i) => { m.color.copy(i === 0 ? accent : accent2); m.opacity = 0.12 })
      this.constelDots.forEach((d) => {
        d.material.color.copy(accent2)
        d.material.opacity = 0.55
        d.material.blending = THREE.AdditiveBlending
        d.material.needsUpdate = true
      })
    }
    if (!initial && this.reduceMotion) this._render(0)
  }

  setActive(on) {
    if (!this.ok) return
    this.active = !!on
    this._syncLoop()
  }

  resize() {
    if (!this.ok) return
    const w = Math.max(160, this.canvas.clientWidth || 320)
    const h = Math.max(100, this.canvas.clientHeight || Math.round(w * 210 / 320))
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
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
    if (ts - this.last < 33) return
    const dt = Math.min(0.1, (ts - this.last) / 1000 || 0.016)
    this.last = ts
    this.time += dt
    this._render(dt)
  }

  _render(dt) {
    if (!this.ok) return
    const t = this.time
    const k = Math.min(1, dt * 2.6)
    this.pointer.sx += (this.pointer.x - this.pointer.sx) * k
    this.pointer.sy += (this.pointer.y - this.pointer.sy) * k

    this.planet.rotation.y = t * 0.12
    this.planetMat.uniforms.uTime.value = t
    this.system.rotation.x = 0.56 + this.pointer.sy * 0.07
    this.system.rotation.z = -0.24 - this.pointer.sx * 0.05
    this.system.rotation.y = -0.05 + this.pointer.sx * 0.09

    for (const s of this.sats) {
      const a = t * s.speed + s.phase
      const x = Math.cos(a) * s.rx
      const y = Math.sin(a) * s.ry
      s.mesh.position.set(x, y, 0)
      s.glow.position.set(x, y, -0.01)
    }
    this.constel.rotation.z = Math.sin(t * 0.03) * 0.02

    this.renderer.render(this.scene, this.camera)
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    cancelAnimationFrame(this.raf)
    this.raf = 0
    window.removeEventListener('resize', this._onResize)
    window.removeEventListener('wv:themechange', this._onTheme)
    window.removeEventListener('pointermove', this._onMove)
    document.removeEventListener('visibilitychange', this._onVis)
    this.scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose()
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material]
        for (const m of mats) m.dispose()
      }
    })
    this.starTex?.dispose()
    this.renderer?.forceContextLoss?.()
    this.renderer?.dispose()
    this.ok = false
  }
}
