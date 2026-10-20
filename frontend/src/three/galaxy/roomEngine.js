// RoomEngine — 首课 5 词 3D 小房间引擎
//
// 与 GalaxyEngine 并列但独立(不依赖双渲染器 / CSS2D / Bloom / OrbitControls / 家族分簇):
// - 5 个发光球 = 5 个词,1 个静态相机视角(晕 3D 风险 = 0,Legault 2019 原则)
// - 鼠标 hover:0.3s ease-out 球放大 1.4x + 强发光脉冲(不重新构建几何,只改 material)
// - 点击:raycaster 命中 → 回调 onTap(wordId, hitScreenX, hitScreenY) 让 Vue 弹 2D 词卡
// - 低端机降级:复用 navigator.hardwareConcurrency 探测,关 antialias
// - 主题:发色光用 emissiveForState 的 token 体系,主题切换调 applyTheme 重读
//
// 为什么不用 OrbitControls:60-95% 的人有不同程度的视觉不适(调研 2 第 3 条),
// 第一屏让用户看场景就头晕 = 立刻关掉;静态视角 + 鼠标点击更安全。
//
// 为什么不用 Bloom:5 个球不需要全屏辉光,Bloom 反而会让小屏过曝;
// 真要发光强度直接拉 emissiveIntensity(2.4~3.2)就行。
import * as THREE from 'three'
import { readThemeColors, emissiveForState } from './theme.js'

// 房间布局:5 个物体在水/水龙头上方/周围的空间里漂浮
// 每个位置相对镜头正面(0,0,~10)给一点透视感,避免全排成线
const ITEM_POSITIONS = [
  { x: -3.2, y: 0.3, z: 0 },   // 左
  { x: -1.6, y: 1.6, z: 0.4 }, // 左上(高一点)
  { x:  0,   y: 0.4, z: 0.2 }, // 中
  { x:  1.6, y: 1.6, z: 0.4 }, // 右上
  { x:  3.2, y: 0.3, z: 0 },   // 右
]

// 物品名称(每个 3D 物体对应厨房/浴室里跟水相关的一个真实物品)
const ITEM_LABELS = ['水壶', '水龙头', '湿食材', '洗菜盆', '电表']
// ↑ 5 词对应:
//   hydrate(补水)     → 水壶
//   dehydrate(脱水)   → 湿食材/烘干食品
//   hydraulic(液压)   → 水龙头(里面有液压/水压)
//   hydrogen(氢)      → 电表(厨房电表,水电相邻;不强求,主要是"实验室仪器"远观感)
//   hydroelectric(水电) → 洗菜盆上方悬挂的"水力发电小模型"(用线代表水流过小灯)
// — 5 物体都是可点 = 调研 2 第 5 条 Legault "可操作 > 走动 > 观看" 原则

export class RoomEngine {
  constructor(container, { words, onTap } = {}) {
    this.container = container
    this.words = words || []       // [{ id, word, ipa, meaning, ... }]
    this.onTap = onTap             // (wordId, screenX, screenY) => void
    this.balls = []                // 5 个 Mesh
    this.hoverId = null
    this.clock = new THREE.Clock()
    this.t = 0
    this.raycaster = new THREE.Raycaster()
    this.pointer = new THREE.Vector2()
    this.lowEnd = (navigator.hardwareConcurrency || 8) < 4 || (navigator.deviceMemory || 8) < 4
    this.disposed = false

    const w = container.clientWidth || 1
    const h = container.clientHeight || 1
    const pixelRatio = this.lowEnd ? 1 : Math.min(window.devicePixelRatio, 2)

    // 场景:保持项目暗空基色 #05070f(对齐 styles.css 暗主题 --bg 与 engine.js:32 决策)
    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color('#05070f')

    this.camera = new THREE.PerspectiveCamera(48, w / h, 0.1, 100)
    this.camera.position.set(0, 0.8, 9)
    this.camera.lookAt(0, 0.8, 0)

    this.renderer = new THREE.WebGLRenderer({ antialias: !this.lowEnd, powerPreference: 'low-power' })
    this.renderer.setPixelRatio(pixelRatio)
    this.renderer.setSize(w, h)
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.15
    container.appendChild(this.renderer.domElement)

    // 灯光:柔和环境光 + 1 盏强方向光让球有立体感
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.55))
    const dir = new THREE.DirectionalLight(0xffffff, 0.9)
    dir.position.set(4, 6, 4)
    this.scene.add(dir)
    // 顶部一点冷色补光(青绿 = --accent)让球在暗背景里发亮
    const rim = new THREE.PointLight(0x22d3ee, 1.4, 14, 2)
    rim.position.set(0, 3, 1.5)
    this.scene.add(rim)
    this._rim = rim // applyTheme 时跟随换色

    // 平台:一个暗灰色圆盘,让 5 球有"桌面"感(不画完整房间 — 5 词首课不需要一整间厨房)
    const platform = new THREE.Mesh(
      new THREE.CircleGeometry(4.4, 48),
      new THREE.MeshStandardMaterial({
        color: 0x0a0e1a, roughness: 0.6, metalness: 0.25,
        emissive: 0x05080f, emissiveIntensity: 0.4,
      }),
    )
    platform.rotation.x = -Math.PI / 2
    platform.position.y = -0.9
    this.scene.add(platform)
    this._platform = platform

    // 平台边缘光圈(发光细环,装饰;_update 里做极慢呼吸,applyTheme 跟随换色)
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(4.32, 4.46, 64),
      new THREE.MeshBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.4, side: THREE.DoubleSide }),
    )
    ring.rotation.x = -Math.PI / 2
    ring.position.y = -0.895
    this.scene.add(ring)
    this._ring = ring

    // 5 个词球:复用 planetStyle 配色,但把 emissiveIntensity 拉到 2.4~3.2
    // 让它们在暗背景里自带"会发光"的视觉(代替 Bloom 后处理)
    const colors = readThemeColors()
    for (let i = 0; i < this.words.length && i < ITEM_POSITIONS.length; i++) {
      const w = this.words[i]
      const pos = ITEM_POSITIONS[i]
      const radius = 0.55 + (i % 2) * 0.08  // 错落大小

      const geom = new THREE.SphereGeometry(1, 28, 28)
      const mat = new THREE.MeshStandardMaterial({
        color: 0x0e2a3a,  // 暗青底
        emissive: colors.accent,
        emissiveIntensity: 2.4,
        roughness: 0.28,
        metalness: 0.35,
      })
      const mesh = new THREE.Mesh(geom, mat)
      mesh.scale.setScalar(radius)
      mesh.position.set(pos.x, pos.y, pos.z)
      mesh.userData.wordId = w.id
      mesh.userData.baseScale = radius
      mesh.userData.hovered = false
      this.scene.add(mesh)
      this.balls.push(mesh)
    }

    // 鼠标点击 / hover 事件(6px 阈值 = 复用 engine.js:99-108 的设计)
    this._down = null
    this._onDown = (e) => { this._down = [e.clientX, e.clientY] }
    this._onUp = (e) => {
      if (!this._down) return
      const dist = Math.hypot(e.clientX - this._down[0], e.clientY - this._down[1])
      this._down = null
      if (dist >= 6) return
      const hit = this._raycast(e)
      if (hit) {
        const rect = this.renderer.domElement.getBoundingClientRect()
        this.onTap?.(hit.userData.wordId, e.clientX - rect.left, e.clientY - rect.top)
      }
    }
    this._onMove = (e) => {
      const hit = this._raycast(e)
      document.body.style.cursor = hit ? 'pointer' : 'auto'
      this._setHovered(hit ? hit.userData.wordId : null)
    }
    this._onLeave = () => {
      document.body.style.cursor = 'auto'
      this._setHovered(null)
    }
    this.renderer.domElement.addEventListener('pointerdown', this._onDown)
    this.renderer.domElement.addEventListener('pointerup', this._onUp)
    this.renderer.domElement.addEventListener('pointermove', this._onMove)
    this.renderer.domElement.addEventListener('pointerleave', this._onLeave)

    // 容器尺寸变化
    this._ro = new ResizeObserver(() => this._resize())
    this._ro.observe(container)

    // 启动动画循环
    this._tick = () => this._update()
    this.renderer.setAnimationLoop(this._tick)
  }

  _raycast(e) {
    const rect = this.renderer.domElement.getBoundingClientRect()
    this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
    this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
    this.raycaster.setFromCamera(this.pointer, this.camera)
    const hits = this.raycaster.intersectObjects(this.balls, false)
    return hits.length ? hits[0].object : null
  }

  _setHovered(id) {
    if (this.hoverId === id) return
    this.hoverId = id
    for (const b of this.balls) {
      b.userData.hovered = (id != null && b.userData.wordId === id)
    }
  }

  _resize() {
    const w = this.container.clientWidth || 1
    const h = this.container.clientHeight || 1
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(w, h)
  }

  _update() {
    this.t += this.clock.getDelta()
    // 5 球各自呼吸 + 选中态放大
    for (const b of this.balls) {
      const hov = b.userData.hovered
      const base = b.userData.baseScale
      const target = base * (hov ? 1.4 : 1) + Math.sin(this.t * 1.6 + b.position.x) * 0.02
      const s = b.scale.x + (target - b.scale.x) * 0.18
      b.scale.setScalar(s)
      // 呼吸式 emissive 强度:静态 2.4,hover 飙到 4.0
      const targetEm = hov ? 4.0 : 2.4 + Math.sin(this.t * 2.0 + b.position.y) * 0.3
      b.material.emissiveIntensity += (targetEm - b.material.emissiveIntensity) * 0.15
    }
    // 平台光环极慢呼吸
    if (this._ring) this._ring.material.opacity = 0.32 + 0.12 * Math.sin(this.t * 0.9)
    this.renderer.render(this.scene, this.camera)
  }

  // 主题切换(Onboarding 订阅 wv:themechange 调这里,与 GalaxyEngine 同一事件源)
  applyTheme() {
    const colors = readThemeColors()
    for (const b of this.balls) {
      b.material.emissive.copy(colors.accent)
    }
    this._ring?.material.color.copy(colors.accent)
    this._rim?.color.copy(colors.accent)
  }

  // 标记某个词球为"已学完"淡出 + 标 ✓ — 5 词首课完成后调用
  markLearned(wordId) {
    const b = this.balls.find((x) => x.userData.wordId === wordId)
    if (!b) return
    // 0.6s 内把 emissive 降为 success 绿色 + 0.3 收缩
    const start = performance.now()
    const dur = 600
    const tick = () => {
      const t = Math.min((performance.now() - start) / dur, 1)
      const e = 1 - Math.pow(1 - t, 3)
      b.material.emissive.setHex(0x4ade80)
      b.material.emissiveIntensity = 3.0 * (1 - e) + 1.0 * e
      b.scale.setScalar(b.userData.baseScale * (1 - 0.3 * e))
      if (t < 1) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    this.renderer.setAnimationLoop(null)
    this._ro?.disconnect()
    this.renderer.domElement.removeEventListener('pointerdown', this._onDown)
    this.renderer.domElement.removeEventListener('pointerup', this._onUp)
    this.renderer.domElement.removeEventListener('pointermove', this._onMove)
    this.renderer.domElement.removeEventListener('pointerleave', this._onLeave)
    for (const b of this.balls) {
      b.geometry.dispose()
      b.material.dispose()
    }
    for (const extra of [this._ring, this._platform]) {
      extra?.geometry.dispose()
      extra?.material.dispose()
    }
    this.renderer.dispose()
    if (this.renderer.domElement.parentNode) this.renderer.domElement.parentNode.removeChild(this.renderer.domElement)
  }
}
