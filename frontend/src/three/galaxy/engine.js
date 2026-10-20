// GalaxyEngine — 词汇圣殿版
// 删:星空/星云/流星(圣殿不需要) + 旧的 FamilyCluster 3 圈轨道环
// 保留:HDRI 反射、雕塑家族、OrbitControls(静止起始,用户可拖)、选中放大
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js'
import { createComposer } from './postfx.js'
import { FamilyCluster } from './cluster.js'
import { Atrium, makeGlowTexture } from './atrium.js'
import { FlightController, chapterAt } from './flightpath.js'
import { MyConstellation } from './constellation.js'
import { createNebulaSky } from './nebulaSky.js'

export class GalaxyEngine {
  constructor(container, { onSelect } = {}) {
    this.container = container
    this.onSelect = onSelect
    this.clusters = []
    this.selectedId = null
    this.hoverId = null
    this.lockedRoot = null
    this.wordTokenMap = new Map()
    this.envMap = null

    this.lowEnd = (navigator.hardwareConcurrency || 8) < 4 || (navigator.deviceMemory || 8) < 4
    this.downgraded = this.lowEnd
    const pixelRatio = this.lowEnd ? 1 : Math.min(window.devicePixelRatio, 2)

    const w = container.clientWidth || 1
    const h = container.clientHeight || 1

    this.scene = new THREE.Scene()
    this.scene.fog = new THREE.Fog(0x05070f, 62, 175)

    this.camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 500)
    this.camera.position.set(0, 13.5, 50)
    this.camera.lookAt(0, 1, 0)

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(pixelRatio)
    this.renderer.setSize(w, h)
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.15 // 电影感:亮部烧起来,暗部沉住
    container.appendChild(this.renderer.domElement)

    // 展厅「01 星系」:六千粒子三旋臂星盘垫在词族环下(v1 原样);「03 Vanta
    // 鸟群」GPGPU 原版移植,换掉星壳小球(v3,用户反馈:小球 → 天上飞的鸟)。
    // 鸟群要用 renderer 建计算纹理,所以在渲染器就绪后装配
    this.nebula = createNebulaSky({ lowEnd: this.lowEnd, renderer: this.renderer })
    this.scene.add(this.nebula.group)

    this.labelRenderer = new CSS2DRenderer()
    this.labelRenderer.setSize(w, h)
    const labelDom = this.labelRenderer.domElement
    labelDom.style.position = 'absolute'
    labelDom.style.top = '0'
    labelDom.style.left = '0'
    labelDom.style.pointerEvents = 'none'
    container.appendChild(labelDom)

    // 展厅(HDRI + 悬浮空间:中央纪念碑 + 尘埃 + 光帘 + 星球壳,无地板)
    this.atrium = new Atrium()
    this.atrium.setup(this.renderer, this.scene, { lowEnd: this.lowEnd }).then(() => {
      this.envMap = this.scene.environment
      // 把 envMap 传到每个 cluster(雕塑用它)
      for (const c of this.clusters) c.family._envMap = this.envMap
    })

    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.06
    this.controls.autoRotate = false // 圣殿不自动转,用户视角
    this.controls.minDistance = 12
    this.controls.maxDistance = 95
    this.controls.minPolarAngle = Math.PI * 0.06 // 允许近乎俯视(星群有厚度,俯瞰才读得出)
    this.controls.maxPolarAngle = Math.PI * 0.62 // 允许压到地平线以下仰视悬浮的词
    this.controls.target.set(0, 1, 0)
    this.controls.enabled = true // 默认可用;开场运镜启动时才临时锁住

    this._introDone = false
    this._intro = null

    // 航行:滚动驱动的航路(与开场运镜终点闭环,一镜到底)
    this._flight = new FlightController()
    this._flightLook = new THREE.Vector3(0, 1, 0)
    this._resume = null
    this._auto = false
    this._lastEmitP = -1
    this._emit = (name, detail) => window.dispatchEvent(new CustomEvent(name, { detail }))
    this._onFlightResume = () => this.engageFlight()
    this._onFlightJump = (e) => this.jumpToProgress(e.detail)
    // 星火问答答对 → 这颗星当场烧亮一档(halo 闪 + 脉冲)
    this._onWordLit = (e) => this.onWordLit(e.detail?.wordId)
    // 「只看已点亮」:未学的雕塑与柔晕压到近隐,你学的都在发光
    this._learnFocus = false
    this._onLearnFocus = (e) => this.setLearnedFocus(!!e.detail?.on)
    window.addEventListener('wv:learnFocus', this._onLearnFocus)
    // 终幕星图导出:HUD 发来版面文案,引擎截帧合成后回传 dataURL
    this._onExport = (e) => this.onExportStarmap(e.detail || {})
    window.addEventListener('wv:flightResume', this._onFlightResume)
    window.addEventListener('wv:flightJump', this._onFlightJump)
    window.addEventListener('wv:wordLit', this._onWordLit)
    window.addEventListener('wv:exportStarmap', this._onExport)
    // 终幕「我的星座」:航路尽头点亮(航出/回滚即收)
    this._finale = null
    this._haloFlashId = null
    this._haloFlashUntil = 0

    this.clock = new THREE.Clock()
    this.t = 0
    this.raycaster = new THREE.Raycaster()
    this.pointer = new THREE.Vector2()

    // === 覆盖层 DOM ===
    this._v3 = new THREE.Vector3()
    this.popupEl = document.createElement('div')
    this.popupEl.className = 'planet-popup'
    this.popupEl.addEventListener('click', (e) => {
      if (e.target.closest('.pp-close')) this.onSelect?.(null)
    })
    this.tooltipEl = document.createElement('div')
    this.tooltipEl.className = 'planet-tooltip'
    this.lockBtnEl = document.createElement('button')
    this.lockBtnEl.className = 'family-lock-btn'
    this.lockBtnEl.textContent = '退出家族视角'
    this.lockBtnEl.addEventListener('click', () => this.unlockFamily())
    container.append(this.popupEl, this.tooltipEl, this.lockBtnEl)

    this._down = null
    this._lastAct = performance.now()
    this._onDown = (e) => {
      this._lastAct = performance.now()
      this._focus = null // 用户上手,运镜立即交还
      if (this._intro) this._finishIntro(false) // 跳到终点但不挂航路:用户要的是自己控制相机
      else this.pauseFlight() // igloo 心法:一碰就停,相机交还
      this._down = [e.clientX, e.clientY]
    }
    this._onWheel = (e) => {
      this._lastAct = performance.now()
      this._focus = null
      if (this._intro) { this._finishIntro(true); return } // 滚轮 = 想航行:直接上航路
      if (this._resume) this._snapResume() // 接回动画中滚轮:立即落位开始航行
      if (this._flight.engaged) { this._auto = false; this._flight.scroll(e.deltaY); return }
      // 自由漫游时滚轮 = OrbitControls 原生缩放
    }
    this._onUp = (e) => {
      if (!this._down) return
      const dist = Math.hypot(e.clientX - this._down[0], e.clientY - this._down[1])
      this._down = null
      if (dist >= 6 || e.target !== this.renderer.domElement) return
      const hit = this._raycastAt(e)
      this.onSelect?.(hit ? hit : null)
    }
    this._lastHover = 0
    this._onMove = (e) => {
      const now = performance.now()
      if (now - this._lastHover < 50) return
      this._lastHover = now
      const hit = this._raycastAt(e)
      // 光标的世界坐标(y=0 地平面)——中场星流的斥力源
      const rect = this.renderer.domElement.getBoundingClientRect()
      this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
      this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
      if (!this._groundPlane) this._groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
      if (!this._pointerWorld) this._pointerWorld = new THREE.Vector3()
      this.raycaster.setFromCamera(this.pointer, this.camera)
      this.raycaster.ray.intersectPlane(this._groundPlane, this._pointerWorld)
      document.body.style.cursor = hit ? 'pointer' : 'auto'
      this.setHovered(hit)
      if (hit) {
        const word = this.findWord(hit)
        if (word) {
          // 悬停即回答「这个词我学过吗」:单词名 + 学习状态(图例同色)
          const si = this._stateInfo(this._states?.[hit])
          this.tooltipEl.innerHTML =
            `<span>${word.word}</span>` +
            (si ? `<span class="pt-state s-${si.cls}">${si.text}</span>` : '')
          this.tooltipEl.classList.add('show')
          this.tooltipEl.style.transform =
            `translate(${e.clientX - rect.left + 16}px, ${e.clientY - rect.top - 12}px)`
        }
      } else {
        this.tooltipEl.classList.remove('show')
      }
    }
    this._onLeave = () => {
      this.setHovered(null)
      this.tooltipEl.classList.remove('show')
      this._pointerWorld = null // 光标离场,星流回落平静
      document.body.style.cursor = 'auto'
    }
    this.renderer.domElement.addEventListener('pointerdown', this._onDown)
    this.renderer.domElement.addEventListener('pointerup', this._onUp)
    this.renderer.domElement.addEventListener('pointermove', this._onMove)
    this.renderer.domElement.addEventListener('pointerleave', this._onLeave)
    this.renderer.domElement.addEventListener('wheel', this._onWheel, { passive: true })

    this._ro = new ResizeObserver(() => this.resize())
    this._ro.observe(container)

    this._tick = () => this.tick()
    this.renderer.setAnimationLoop(this._tick)

    // 后期:Bloom 克制(只给高亮状态),DOF 焦散(进词卡时焦散到虚化)
    // pixelRatio 与 renderer 同源(lowEnd=1x),别让 composer 自己按 dpr 拉高
    this.composer = createComposer(this.renderer, this.scene, this.camera, { w, h, pixelRatio, bloom: !this.lowEnd, dof: !this.lowEnd })
    this._fpsFrames = 0; this._fpsLast = performance.now(); this._fpsLowStreak = 0
  }

  _raycastAt(e) {
    const rect = this.renderer.domElement.getBoundingClientRect()
    this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
    this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
    this.raycaster.setFromCamera(this.pointer, this.camera)
    const list = this.lockedRoot
      ? this.clusters.filter((c) => c.family.root === this.lockedRoot)
      : this.clusters
    const meshes = []
    for (const c of list) {
      for (const p of c.planets.values()) {
        p.group.traverse((o) => { if (o.isMesh) meshes.push(o) })
      }
    }
    const hits = this.raycaster.intersectObjects(meshes, false)
    if (!hits.length) return null
    // 找到归属 wordId:从 mesh 向上找 group 的 userData.wordId
    let obj = hits[0].object
    while (obj && obj.userData?.wordId == null) obj = obj.parent
    return obj?.userData?.wordId ?? null
  }

  build(words, states) {
    this.clearClusters()
    this._states = states || {}
    this.wordTokenMap = new Map()
    for (const wd of words || []) this.wordTokenMap.set(String(wd.word).toLowerCase(), wd.id)
    this.hoverId = null
    this.lockedRoot = null
    this.lockBtnEl.classList.remove('show')
    this.tooltipEl.classList.remove('show')
    const map = new Map()
    for (const w of words || []) {
      if (!map.has(w.family)) map.set(w.family, { root: w.root, meaning: w.root_meaning, words: [] })
      map.get(w.family).words.push(w)
    }
    // 布展:按词数降序给 idx(大族 → 外环槽位),total 记录总族数供三环分段
    const entries = [...map.entries()].sort((a, b) => b[1].words.length - a[1].words.length)
    let i = 0
    for (const [fam, v] of entries) {
      const family = { ...v, family: fam, idx: i, total: entries.length }
      family._envMap = this.envMap
      const cluster = new FamilyCluster(family, states, { onLock: (root) => this.lockFamily(root) })
      this.clusters.push(cluster)
      this.scene.add(cluster.group)
      i++
    }
    // 圣殿不重飞:只有第一次 build 走运镜(词表刷新不重播)
    if (!this._introDone) { this._introDone = true; this._startIntro() }
    this._buildHalo()
    if (this._learnFocus) this.setLearnedFocus(true) // 词表重建后恢复「只看已点亮」
    this.setSelected(this.selectedId)
  }

  // 词星柔晕:每颗词的位置放一个家族色的柔光点(Points 单次 draw call)
  // 全部词真正读成"星"——星海感的主要来源之一
  // 亮度分档 = 学习数据:未学=家族基色,已学×1.6,已掌握×2.3 —— 宇宙的亮度就是词汇量
  _buildHalo() {
    this._disposeHalo()
    const pos = []
    const fam = []
    this._haloMap = new Map() // wordId → 顶点序号(hover 点亮那一颗用)
    let idx = 0
    for (const c of this.clusters) {
      const base = new THREE.Color(c.color).multiplyScalar(0.55)
      for (const p of c.planets.values()) {
        pos.push(p.group.position.x, p.group.position.y, p.group.position.z)
        fam.push(base.r, base.g, base.b)
        this._haloMap.set(p.word.id, idx)
        idx++
      }
    }
    if (!pos.length) return
    this._haloFam = new Float32Array(fam) // 家族基色(无状态档位),分档色从这里算
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    geo.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(fam.length), 3))
    this.halo = new THREE.Points(geo, new THREE.PointsMaterial({
      map: makeGlowTexture(), size: 2.2, vertexColors: true,
      transparent: true, opacity: 0.26, depthWrite: false,
      blending: THREE.AdditiveBlending, sizeAttenuation: true,
    }))
    this.scene.add(this.halo)
    this._refreshHalo()
  }

  // 按学习状态给柔晕分档上色,写进 _haloBase(hover 增亮的基准)
  // learnedBoost/newDim:终幕专用 —— 已学星再放大、未学星压暗,「你的星座」从星海里浮出来
  _applyHaloColors(learnedBoost = 1, newDim = 1) {
    if (!this.halo || !this._haloFam) return
    const out = new Float32Array(this._haloFam.length)
    for (const [id, i] of this._haloMap) {
      const s = this._states?.[id]
      let m = newDim, lift = 0
      if (s && !s.is_new) {
        m = learnedBoost * ((s.strength ?? 0) > 0.75 ? 2.3 : 1.6)
        lift = 0.06
      }
      const j = i * 3
      out[j] = Math.min(1, this._haloFam[j] * m + lift)
      out[j + 1] = Math.min(1, this._haloFam[j + 1] * m + lift)
      out[j + 2] = Math.min(1, this._haloFam[j + 2] * m + lift * 1.8) // 冷偏移,亮星偏青白
    }
    this.halo.geometry.attributes.color.array.set(out)
    this.halo.geometry.attributes.color.needsUpdate = true
    this._haloBase = out
  }

  // hover 词:那一颗星的柔晕烧亮(顶点色 ×mult,其余还原基准)
  _updateHaloHover(id, mult = 2.5) {
    if (!this.halo || !this._haloBase) return
    const attr = this.halo.geometry.attributes.color
    attr.array.set(this._haloBase)
    if (id != null) {
      const i = this._haloMap.get(id)
      if (i != null) {
        attr.array[i * 3] = this._haloBase[i * 3] * mult + 0.25
        attr.array[i * 3 + 1] = this._haloBase[i * 3 + 1] * mult + 0.3
        attr.array[i * 3 + 2] = this._haloBase[i * 3 + 2] * mult + 0.4
      }
    }
    attr.needsUpdate = true
  }

  _disposeHalo() {
    if (!this.halo) return
    this.scene.remove(this.halo)
    this.halo.geometry.dispose()
    this.halo.material.dispose()
    this.halo = null
  }

  // === 开场运镜:一词特写 → 缓缓绕行 → 拉出至圣殿全览 ===
  // 选词优先级:点亮过的星(已学/掌握)> 最大族首词;贴上去绕 0.6rad,再拉出落航路
  _pickIntroWordId() {
    let best = null, bestS = -1
    for (const c of this.clusters) {
      for (const [id] of c.planets) {
        const s = this._states?.[id]
        const score = s && !s.is_new ? (s.strength ?? 0) + 1 : 0
        if (score > bestS) { bestS = score; best = id } // 同分先遇到者胜(大族出场动画最早亮)
      }
    }
    return best
  }

  _startIntro() {
    const wid = this._pickIntroWordId()
    const grp = wid ? this.findPlanetGroup(wid) : null
    this._introCluster = wid ? this.findCluster(wid) : null
    const wp = grp ? grp.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3(0, 2.1, 0)
    const phi = Math.atan2(wp.z, wp.x)
    const a0 = phi - 0.38, a1 = phi + 0.26, r = 4.6
    const wordPos = new THREE.Vector3(wp.x + Math.cos(a0) * r, wp.y + 0.9, wp.z + Math.sin(a0) * r)
    this._intro = {
      t0: performance.now(),
      aDur: 2000, bDur: 2600, cDur: 4200,
      wp: wp.clone(),
      a0, a1, r, y: wp.y + 0.9, // 特写高度跟着这颗词所在的层走(星群有厚度)
      look: new THREE.Vector3(wp.x, wp.y - 0.2, wp.z),
      wordPos,
      camFrom: new THREE.Vector3(0, 5, 34),
      lookFrom: new THREE.Vector3(0, 26, 10),
      from: new THREE.Vector3(wp.x + Math.cos(a1) * r, 1.5, wp.z + Math.sin(a1) * r),
      to: new THREE.Vector3(0, 13.5, 50),
      lookTo: new THREE.Vector3(0, 1, 0),
      ctrl: new THREE.Vector3(wp.x * 0.4, 13, wp.z * 0.4 + 23),
      stage: 'word',
    }
    this.controls.enabled = false
    // 开场鸟群幕(用户:鸟群做成页面的开场动画引出正文):把 GPGPU 鸟群
    // 重新聚到镜头前,仰望它们掠过圣殿,再随它们落到第一只词鸟身上;
    // 鸟群不可用(GPGPU 不支持/减弱动态)时直接走词特写,不空等
    let birdsOn = false
    if (this.nebula?.restartFlock) {
      try { birdsOn = this.nebula.restartFlock(0, 24, 16, 120) } catch { birdsOn = false }
    }
    if (birdsOn) {
      this._intro.stage = 'birds'
      this.camera.position.copy(this._intro.camFrom)
      this.camera.lookAt(this._intro.lookFrom)
      this._emit('wv:intro', { stage: 'birds' })
      return
    }
    this.camera.position.set(wp.x + Math.cos(a0) * r, this._intro.y, wp.z + Math.sin(a0) * r)
    this.camera.lookAt(this._intro.look)
    this._emit('wv:intro', { stage: 'word' })
  }

  // engage:false = 用户上手,跳到终点但不挂航路(他要自己控制相机)
  _finishIntro(engage = true) {
    if (!this._intro) return
    this._intro = null
    // 鸟群只属于开场(用户:都开场用了就不用常驻展示)——正文里词自己就是鸟
    this.nebula?.retireFlock()
    for (const c of this.clusters) c.setSweep(0) // 开场期手动点亮的星图交回航路驱动
    this.camera.position.set(0, 13.5, 50)
    this.camera.lookAt(0, 1, 0)
    this._emit('wv:intro', { stage: 'end' })
    // 开场特写运镜落地即上航路,并默认缓航:画面永远在运镜,而不是静止或抖动
    if (engage) { this._engageFlight(0); this._auto = true }
    else this.controls.enabled = true
  }

  _updateIntro() {
    const it = this._intro
    const pt = performance.now() - it.t0
    // 第〇段·鸟群引路:仰望掠过圣殿的鸟群,它们升回天幕,视线随之落到
    // 第一只词鸟身上(相机沿同一弧滑向词特写的环绕起点,无跳切)
    if (it.stage === 'birds') {
      const p = Math.min(1, pt / it.cDur)
      const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2
      this.nebula?.setFlockCenter(0, 24 + 126 * e, 16 * (1 - e))
      this.camera.position.lerpVectors(it.camFrom, it.wordPos, e)
      if (!this._introLook) this._introLook = new THREE.Vector3()
      this._introLook.lerpVectors(it.lookFrom, it.look, e)
      this.camera.lookAt(this._introLook)
      if (p >= 1) {
        it.stage = 'word'
        it.t0 = performance.now()
        this._emit('wv:intro', { stage: 'word' })
      }
      return
    }
    if (pt < it.aDur) {
      // 第一段:绕词特写(缓入缓出,星空在词背后缓缓移轴)
      const p = pt / it.aDur
      const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2
      const a = it.a0 + (it.a1 - it.a0) * e
      this.camera.position.set(it.wp.x + Math.cos(a) * it.r, it.y, it.wp.z + Math.sin(a) * it.r)
      this.camera.lookAt(it.look)
      return
    }
    if (it.stage !== 'pull') {
      it.stage = 'pull'
      this._emit('wv:intro', { stage: 'pull' })
      // 星座当面绘制:拉出运镜期间,首词所在家族的星图当着用户长出来
      this._introCluster?.beginConstellationDraw()
      this._introCluster?.setSweep(1)
    }
    const p = Math.min(1, (pt - it.aDur) / it.bDur)
    if (p >= 1) { this._finishIntro(); return }
    const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2
    const u = 1 - e
    this.camera.position.set(
      u * u * it.from.x + 2 * u * e * it.ctrl.x + e * e * it.to.x,
      u * u * it.from.y + 2 * u * e * it.ctrl.y + e * e * it.to.y,
      u * u * it.from.z + 2 * u * e * it.ctrl.z + e * e * it.to.z,
    )
    if (!this._introLook) this._introLook = new THREE.Vector3()
    this._introLook.lerpVectors(it.look, it.lookTo, e)
    this.camera.lookAt(this._introLook)
  }

  // === 航路:滚动 = 航行 ===
  // atP != null:相机已在航路上(开场落地),直接挂挡;否则回航动画接最近航路点
  _engageFlight(atP) {
    if (atP != null) {
      this._flight.p = this._flight.target = atP
      this._flight.engaged = true
      this._auto = false
      this.controls.enabled = false
      this._prevHeading = null; this._bank = 0; this._prevPos = null // 侧倾状态归零
      this._emitFlight(true)
      return
    }
    const toP = new THREE.Vector3()
    const toT = new THREE.Vector3()
    const np = this._flight.path.nearestProgress(this.camera.position)
    this._flight.path.sample(np, toP, toT)
    this._resume = {
      t0: performance.now(), dur: 1100,
      fromP: this.camera.position.clone(), fromT: this.controls.target.clone(),
      toP, toT, np,
    }
  }

  // HUD「继续航行」→ 航路从当前视野平滑接回;触摸设备由它进入自动航行
  engageFlight(autoplay = false) {
    if (this._intro) { this._finishIntro(true); return }
    if (this._flight.engaged || this._resume) return
    this._focus = null
    this._engageFlight(null)
    this._auto = !!autoplay
  }

  pauseFlight() {
    if (!this._flight.engaged && !this._resume) return
    this.endFinale()
    this._flight.engaged = false
    this._resume = null
    this._auto = false
    this.controls.enabled = true
    this.controls.target.copy(this._flightLook)
    this.controls.update()
    for (const c of this.clusters) c.setSweep(0)
    this.atrium?.setFlight(null)
    this.atrium?.setFlowSpeed(1)
    this._emitFlight(false)
  }

  // HUD 章节刻度点:跳到某幕(先接回航路再滑过去,不瞬移)
  jumpToProgress(p) {
    if (this._intro) { this._finishIntro(true) }
    if (!this._flight.engaged && !this._resume) this._engageFlight(null)
    this._auto = false
    // 跳幕目标要越过回航动画:否则 _snapResume 落地时会把 target 改写回
    // 最近航路点,跳向航路尽头的终幕永远到不了
    this._jumpTarget = Math.min(1, Math.max(0, p))
    this._flight.target = this._jumpTarget
  }

  _snapResume() {
    const r = this._resume
    if (!r) return
    this.camera.position.copy(r.toP)
    this.controls.target.copy(r.toT)
    this._resume = null
    this._flight.p = this._flight.target = this._jumpTarget ?? r.np
    this._jumpTarget = null
    this._flight.engaged = true
    this.controls.enabled = false
    this._prevHeading = null; this._bank = 0; this._prevPos = null
    this._emitFlight(true)
  }

  _updateResume() {
    const r = this._resume
    const p = Math.min(1, (performance.now() - r.t0) / r.dur)
    const e = 1 - Math.pow(1 - p, 3)
    this.camera.position.lerpVectors(r.fromP, r.toP, e)
    this.controls.target.lerpVectors(r.fromT, r.toT, e)
    this.camera.lookAt(this.controls.target)
    if (p >= 1) this._snapResume()
  }

  _emitFlight(engaged) {
    this._lastEmitP = -1 // 强制下一帧重发进度
    this._emit('wv:flight', { engaged, p: this._flight.p, chapter: chapterAt(this._flight.p) })
  }

  _updateFlight(dt) {
    const f = this._flight
    if (this._auto) f.target = Math.min(1, f.target + dt / 28) // 自动航行(触摸设备主通道;开场落地后也默认缓航)
    f.update(dt)
    this._flight.path.sample(f.p, this.camera.position, this._flightLook)
    // 相机只在航路上平滑滑行,不做任何自主抖动(用户:不要震动,要运镜)
    // 光标视差:注视点微微追着光标 —— 航行中场景也在回应你
    if (!this._par) this._par = { x: 0, y: 0 }
    this._par.x += (this.pointer.x - this._par.x) * Math.min(1, dt * 2.5)
    this._par.y += (this.pointer.y - this._par.y) * Math.min(1, dt * 2.5)
    if (!this._lookAdj) this._lookAdj = new THREE.Vector3()
    this._lookAdj.copy(this._flightLook)
    this._lookAdj.x += this._par.x * 1.3
    this._lookAdj.y += this._par.y * 0.7
    this.camera.lookAt(this._lookAdj)
    // 转向侧倾:航路转弯时画面轻微内倾(开飞机的手感);dp 抹掉方向突变
    if (!this._prevPos) this._prevPos = new THREE.Vector3()
    const vx = this.camera.position.x - this._prevPos.x
    const vz = this.camera.position.z - this._prevPos.z
    if (vx * vx + vz * vz > 1e-8) {
      const heading = Math.atan2(vz, vx)
      if (this._prevHeading != null) {
        let dh = heading - this._prevHeading
        dh = Math.atan2(Math.sin(dh), Math.cos(dh))
        const rate = dt > 0 ? dh / dt : 0
        const bank = Math.max(-0.05, Math.min(0.05, -rate * 0.06))
        this._bank = (this._bank ?? 0) + (bank - (this._bank ?? 0)) * Math.min(1, dt * 2.5)
        this.camera.rotateZ(this._bank)
      }
      this._prevHeading = heading
    }
    this._prevPos.copy(this.camera.position)
    // 场景联动:航线扫过的家族浮现星图(连线+刻线环渐亮),像被逐个点读
    const az = Math.atan2(this.camera.position.z, this.camera.position.x)
    for (const c of this.clusters) {
      let d = Math.atan2(c.slot[1], c.slot[0]) - az
      d = Math.atan2(Math.sin(d), Math.cos(d))
      const w = Math.max(0, 1 - Math.abs(d) / 0.9)
      c.setSweep(w * w)
    }
    // 航行感:星流随航速加速漂移;光照沿航路呼吸(巡航段压暗,圣坛段最暖)
    this.atrium?.setFlight(f.p)
    this.atrium?.setFlowSpeed(1 + Math.min(3, f.speed * 6))
    // 终幕:航路尽头,已学星连成只属于你的星座;回滚或脱离即收
    if (f.p > 0.965) this.beginFinale()
    else if (f.p < 0.9) this.endFinale()
    // HUD 节流上报:进度变化 >0.3% 或章节切换才发
    const ch = chapterAt(f.p)
    if (Math.abs(f.p - this._lastEmitP) > 0.003 || ch !== this._lastChapter) {
      this._lastEmitP = f.p
      this._lastChapter = ch
      this._emit('wv:flight', { engaged: true, p: f.p, chapter: ch })
    }
  }

  // === 终幕「我的星座」===
  // 已学词星(非 is_new)绕心连成金色星链,已学柔晕再放大、未学压暗 ——
  // 这片星海里,亮着的全是"你"。星座因学习档案而异,每人看到的都不同。
  beginFinale() {
    if (this._finale) return
    const pts = []
    for (const c of this.clusters) {
      for (const [id, p] of c.planets) {
        const s = this._states?.[id]
        if (s && !s.is_new) pts.push({ x: p.group.position.x, y: p.group.position.y, z: p.group.position.z })
      }
    }
    this._finale = new MyConstellation(this.scene)
    const chained = this._finale.build(pts)
    this._applyHaloColors(1.7, 0.3)
    this._emit('wv:finale', { on: true, learned: pts.length, chained })
  }

  endFinale() {
    if (!this._finale) return
    this._finale.dispose()
    this._finale = null
    this._refreshHalo()
    this._emit('wv:finale', { on: false })
  }

  // 星火问答答对:这颗星当场烧亮(柔晕 ×3.5 闪 1.4s + 雕塑脉冲)
  onWordLit(id) {
    if (id == null) return
    this.findCluster(id)?.planets.get(id)?.pulse()
    this._haloFlashId = id
    this._haloFlashUntil = performance.now() + 1400
  }

  // === 终幕星图导出 ===
  // 现渲一帧 → 截 WebGL 画布 → 2D 合成暗角 + 星图命名式版面 → 回传 dataURL
  // (渲染与 toDataURL 同一同步任务,不碰合成器的帧节奏)
  exportStarMap({ title, subtitle, footer } = {}) {
    this.composer.composer.render()
    const src = this.renderer.domElement
    const W = src.width || 1, H = src.height || 1
    const c = document.createElement('canvas')
    c.width = W; c.height = H
    const ctx = c.getContext('2d')
    ctx.drawImage(src, 0, 0)
    // 电影暗角:和画面里的 .galaxy-vignette 同一配方
    const g = ctx.createRadialGradient(W / 2, H * 0.46, Math.min(W, H) * 0.28, W / 2, H * 0.46, Math.max(W, H) * 0.72)
    g.addColorStop(0, 'rgba(2,4,10,0)')
    g.addColorStop(1, 'rgba(2,4,10,0.55)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, W, H)
    // 版面:星图命名式 —— 衬线星座名 + 衬线一行数据 + mono 落款
    const px = (n) => n * Math.max(1, W / 1280)
    ctx.textAlign = 'center'
    ctx.fillStyle = '#f2ead8'
    ctx.font = `600 ${px(36)}px "Times New Roman", "Songti SC", "STZhongsong", serif`
    if (title) ctx.fillText(title, W / 2, H - px(152))
    ctx.fillStyle = 'rgba(233,240,246,0.88)'
    ctx.font = `${px(16)}px "Times New Roman", "Songti SC", "STZhongsong", serif`
    if (subtitle) ctx.fillText(subtitle, W / 2, H - px(112))
    ctx.fillStyle = 'rgba(139,149,163,0.95)'
    ctx.font = `500 ${px(12)}px ui-monospace, "Cascadia Mono", Consolas, monospace`
    if (footer) ctx.fillText(footer, W / 2, H - px(72))
    return c.toDataURL('image/png')
  }

  onExportStarmap(detail) {
    const url = this.exportStarMap(detail)
    this._emit('wv:starmap', { url, title: detail?.title || '' })
  }

  updateStates(states) {
    this._states = states || {}
    for (const c of this.clusters) c.updateStates(states)
    this._refreshHalo() // 学完一档,星当场更亮
  }

  // 柔晕分档的唯一出口:终幕 > 只看已点亮 > 常态,互不打架
  _refreshHalo() {
    if (this._finale) this._applyHaloColors(1.7, 0.3)
    else if (this._learnFocus) this._applyHaloColors(2.4, 0.1)
    else this._applyHaloColors()
  }

  // 「只看已点亮」:未学的雕塑压到近隐(靠材质 _baseOpacity,聚簇每帧乘 fade 自然消费),
  // 已学柔晕放大 2.4×、未学压到 0.1 —— 一眼看出"这宇宙里哪些是我的"
  setLearnedFocus(on) {
    this._learnFocus = !!on
    for (const c of this.clusters) {
      for (const [id, p] of c.planets) {
        const s = this._states?.[id]
        p.setLearnDim(on && (!s || s.is_new))
      }
    }
    this._refreshHalo()
  }

  applyTheme() {
    // 主题色不重置雕塑(雕塑有自己调色板)
    if (this.atrium?.applyTheme) this.atrium.applyTheme()
  }

  findCluster(id) {
    for (const c of this.clusters) if (c.planets.has(id)) return c
    return null
  }

  findWord(id) {
    return this.findCluster(id)?.planets.get(id)?.word || null
  }

  findPlanetGroup(id) {
    return this.findCluster(id)?.planets.get(id)?.group || null
  }

  exampleWordIds(id) {
    return this._exampleIds(id, null)
  }

  _exampleIds(id, exIndex) {
    const w = this.findWord(id)
    if (!w || !w.examples?.length) return []
    const list = exIndex == null ? w.examples : [w.examples[exIndex]].filter(Boolean)
    const ids = []
    for (const ex of list) {
      for (const tk of String(ex.en || '').toLowerCase().split(/[^a-z']+/)) {
        const tid = this.wordTokenMap.get(tk)
        if (tid && tid !== id && !ids.includes(tid)) ids.push(tid)
      }
    }
    return ids
  }

  setActiveExample(index) {
    const id = this.selectedId
    if (!id) return
    const glowIds = index >= 0 ? this._exampleIds(id, index) : []
    // 例句关联词高亮:用 hover 状态(放大 1.15x)作低成本反馈
    for (const c of this.clusters) c.setHovered(index >= 0 ? glowIds[0] : null)
  }

  setHovered(id) {
    if (this.hoverId === id) return
    this.hoverId = id
    for (const c of this.clusters) c.setHovered(id)
    if (!this._haloFlashUntil) this._updateHaloHover(id) // 星火闪亮期不让 hover 抢走
  }

  setSelected(id) {
    const prevId = this.selectedId
    this.selectedId = id
    if (id && this.lockedRoot) {
      const c = this.findCluster(id)
      if (!c || c.family.root !== this.lockedRoot) this.unlockFamily()
    }
    for (const c of this.clusters) c.setSelected(id)
    if (id && id !== prevId) {
      const grp = this.findPlanetGroup(id)
      if (grp) {
        grp.getWorldPosition(this._v3)
        if (!this._intro) {
          if (this._flight.engaged || this._resume) this.pauseFlight() // 解封词档案前先脱离航路
          this._focusOn(this._v3) // 运镜飞给这颗星
        }
      }
      this.findCluster(id)?.planets.get(id)?.pulse()
    }
    this.renderPopup(id)
  }

  // 运镜聚焦:目标点滑到词上方,相机沿当前方向收到 20 距离,0.9s easeOut
  // 拖拽/滚轮立即取消(_onDown/_onWheel 已置空 _focus)
  _focusOn(wordPos) {
    const to = new THREE.Vector3(wordPos.x, Math.max(0.9, wordPos.y + 0.6), wordPos.z)
    const dir = this.camera.position.clone().sub(to)
    const dist = Math.max(16, Math.min(dir.length(), 26))
    dir.setLength(dist)
    this._focus = {
      t0: performance.now(), dur: 900,
      fromT: this.controls.target.clone(), toT: to,
      fromP: this.camera.position.clone(), toP: to.clone().add(dir),
    }
  }

  _updateFocus() {
    const f = this._focus
    const p = Math.min(1, (performance.now() - f.t0) / f.dur)
    const e = 1 - Math.pow(1 - p, 3) // easeOutCubic
    this.controls.target.lerpVectors(f.fromT, f.toT, e)
    this.camera.position.lerpVectors(f.fromP, f.toP, e)
    this.camera.lookAt(this.controls.target)
    if (p >= 1) {
      this._focus = null
      this._lastAct = performance.now() // 聚焦后给 4s 缓冲再进慢转
    }
  }

  lockFamily(root) {
    const target = this.clusters.find((c) => c.family.root === root)
    if (!target) return
    if (this.lockedRoot === root) { this.unlockFamily(); return }
    this.lockedRoot = root
    for (const c of this.clusters) c.setFamilyLock(c === target)
    this.lockBtnEl.textContent = `退出「${String(root).toUpperCase()}-」家族视角`
    this.lockBtnEl.classList.add('show')
  }

  unlockFamily() {
    if (!this.lockedRoot) return
    this.lockedRoot = null
    for (const c of this.clusters) c.setFamilyLock(true)
    this.lockBtnEl.classList.remove('show')
  }

  // 学习状态 → 人话短标签(与左下图例同色:s-new 灰 / s-learning 青 / s-mastered 银白 / s-due 琥珀)
  _stateInfo(state) {
    if (!state || state.is_new) return { cls: 'new', text: '未学' }
    const s = state.strength ?? 0
    if (state.due && s < 0.45) return { cls: 'due', text: '快忘了 · 该复习' }
    if (state.due) return { cls: 'due', text: '待复习' }
    if (s > 0.75) return { cls: 'mastered', text: `已掌握 ${Math.round(s * 100)}%` }
    if (s > 0.45) return { cls: 'learning', text: `学习中 ${Math.round(s * 100)}%` }
    return { cls: 'learning', text: `学习中 ${Math.round(s * 100)}%` }
  }

  renderPopup(id) {
    const w = id ? this.findWord(id) : null
    if (!w) { this.popupEl.classList.remove('show'); return }
    const si = this._stateInfo(this._states?.[id])
    const examples = (w.examples || []).slice(0, 2).map((e) =>
      `<div class="pp-ex"><div class="pp-ex-en">${e.en || ''}</div><div class="pp-ex-zh">${e.zh || ''}</div></div>`,
    ).join('')
    this.popupEl.innerHTML =
      `<button class="pp-close" title="关闭">✕</button>` +
      `<div class="pp-head"><span class="pp-word">${w.word}</span><span class="pp-ipa">${w.ipa || ''}</span></div>` +
      `<div class="pp-state s-${si.cls}">${si.text}</div>` +
      `<div class="pp-root">${String(w.root || '').toUpperCase()}- · ${w.root_meaning || ''}</div>` +
      `<div class="pp-meaning">${w.pos || ''} ${w.meaning || ''}</div>` +
      examples +
      `<div class="pp-more">按 ✕ 或 Esc 收回</div>`
    this.popupEl.classList.add('show')
  }

  updatePopupPos() {
    if (!this.selectedId) return
    const grp = this.findPlanetGroup(this.selectedId)
    if (!grp) { this.popupEl.classList.remove('show'); return }
    grp.getWorldPosition(this._v3)
    this._v3.project(this.camera)
    if (this._v3.z > 1) { this.popupEl.classList.remove('show'); return }
    const w = this.container.clientWidth || 1
    const h = this.container.clientHeight || 1
    const pw = this.popupEl.offsetWidth || 268
    const ph = this.popupEl.offsetHeight || 170
    let x = (this._v3.x * 0.5 + 0.5) * w + 24
    let y = (-this._v3.y * 0.5 + 0.5) * h - ph - 12
    x = Math.min(Math.max(x, 10), w - pw - 10)
    y = Math.min(Math.max(y, 10), h - ph - 10)
    this.popupEl.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`
    this.popupEl.classList.add('show')
  }

  updateFps() {
    this._fpsFrames++
    const now = performance.now()
    const gap = now - this._fpsLast
    if (gap < 1000) return
    // 停帧恢复(KeepAlive 切走/后台标签页)后的第一个统计窗口不可信:
    // 暂停几秒回来,帧数极少而时间窗巨大,会算出假低帧率,一次性触发不可逆的画质降级。
    // 窗口跨度过大或帧数不足 10 的整窗丢弃重新计时(真卡顿攒满 10 帧仍会正常触发)
    if (gap > 3000 || this._fpsFrames < 10) { this._fpsFrames = 0; this._fpsLast = now; return }
    const fps = this._fpsFrames * (1000 / gap)
    this._fpsFrames = 0
    this._fpsLast = now
    if (fps < 30) this._fpsLowStreak++
    else this._fpsLowStreak = 0
    // 卡了 1 秒就降(原来要连续 3 秒,低端机上用户早被卡跑了)
    if (this._fpsLowStreak >= 1 && !this.downgraded) this.applyDowngrade()
  }

  applyDowngrade() {
    this.downgraded = true
    this.renderer.setPixelRatio(1)
    this.composer.composer.setPixelRatio(1)
    if (this.composer.bloom) this.composer.bloom.enabled = false
    // 降级同时关 DOF(已开的话) + 卸 rim 注入:省帧给渲染本身
    if (this.composer.bokeh) this.composer.bokeh.enabled = false
    for (const c of this.clusters) c.applyDowngrade?.()
    if (this.controls) this.controls.autoRotate = false
  }

  tick() {
    let dt = this.clock.getDelta()
    // 停帧恢复(切走视图/后台标签页)后的首帧 dt 是整个暂停时长——钳到 0.1s,
    // 否则自动航行 target 一帧加满直接瞬移终幕,星尘/星流动画也全体跳帧
    if (dt > 0.1) dt = 0.1
    this.t += dt
    // 光标世界坐标(y=0 地平面)一并传给鸟群:鼠标=捕食者,靠近的鸟群被驱散
    this.nebula?.update(dt, this._pointerWorld)
    const t = this.t
    // DOF 焦散:仅在静态聚焦/恢复时开启(航行中关,移动 + DOF = 糊 + 贵)
    if (this.composer.bokeh) {
      const wantDof = !this.lowEnd && !this.downgraded && !this._flight.engaged && (this._focus || this._resume || this._idleNow)
      this.composer.bokeh.enabled = !!wantDof
      if (wantDof) {
        // focus 距离绑到 controls.target(被聚焦的词)与相机之间的距离
        const dist = this.camera.position.distanceTo(this.controls.target)
        this.composer.setFocus(Math.max(8, Math.min(64, dist)))
      }
    }
    if (this._intro) {
      this._updateIntro()
    } else if (this._focus) {
      this._updateFocus() // 运镜聚焦中:接管相机,完后交还
    } else if (this._resume) {
      this._updateResume() // 回航中:平滑接回航路最近点
    } else if (this._flight.engaged) {
      this._updateFlight(dt) // 航行中:滚动驱动,一镜到底
    } else {
      // igloo 式运镜:没人动 4 秒后进入极缓环绕,一碰就交还
      this._idleNow = performance.now() - this._lastAct > 4000
      this.controls.autoRotate = this._idleNow
      this.controls.autoRotateSpeed = 0.12
      this.controls.update()
    }
    if (!this._camPos) this._camPos = new THREE.Vector3()
    this.camera.getWorldPosition(this._camPos)
    this.atrium?.update(t, dt, this._pointerWorld)
    for (const c of this.clusters) c.update(t, dt, this._camPos)
    // 终幕星链逐条绘制 + 呼吸;星火闪亮期把那颗词的柔晕烧到最亮,过期交回 hover
    this._finale?.update(performance.now())
    if (this._haloFlashUntil) {
      if (performance.now() < this._haloFlashUntil) this._updateHaloHover(this._haloFlashId, 3.8)
      else { this._haloFlashUntil = 0; this._updateHaloHover(this.hoverId) }
    }
    this.composer.composer.render()
    this.labelRenderer.render(this.scene, this.camera)
    this.updatePopupPos()
    this.updateFps()
  }

  resize() {
    const w = this.container.clientWidth || 1
    const h = this.container.clientHeight || 1
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(w, h)
    this.labelRenderer.setSize(w, h)
    this.composer.composer.setSize(w, h)
  }

  clearClusters() {
    this.endFinale()
    this._disposeHalo()
    for (const c of this.clusters) {
      this.scene.remove(c.group)
      c.dispose()
    }
    this.clusters = []
  }

  dispose() {
    this.renderer.setAnimationLoop(null)
    this._ro.disconnect()
    window.removeEventListener('wv:flightResume', this._onFlightResume)
    window.removeEventListener('wv:flightJump', this._onFlightJump)
    window.removeEventListener('wv:wordLit', this._onWordLit)
    window.removeEventListener('wv:learnFocus', this._onLearnFocus)
    window.removeEventListener('wv:exportStarmap', this._onExport)
    this.renderer.domElement.removeEventListener('pointerdown', this._onDown)
    this.renderer.domElement.removeEventListener('pointerup', this._onUp)
    this.renderer.domElement.removeEventListener('pointermove', this._onMove)
    this.renderer.domElement.removeEventListener('pointerleave', this._onLeave)
    this.renderer.domElement.removeEventListener('wheel', this._onWheel)
    this.clearClusters()
    this.atrium?.dispose()
    this.nebula?.dispose()
    this.controls.dispose()
    this.labelRenderer.domElement.remove()
    // composer.dispose() 只释放自身两张 RT;Bloom 的 mip 链与 Bokeh 的 depth RT
    // 各有私有 dispose,不调就整块泄漏在显存里
    this.composer.bloom?.dispose?.()
    this.composer.bokeh?.dispose?.()
    this.composer.composer.dispose?.()
    this.popupEl.remove()
    this.tooltipEl.remove()
    this.lockBtnEl.remove()
    this.renderer.domElement.remove()
    this.renderer.dispose()
    // 立即归还 WebGL 上下文:重挂引擎会新建上下文,浏览器全局上限约 16 个,
    // 等 GC 慢慢收的话,HMR/视图重试几次就可能叠加泄漏
    try { this.renderer.forceContextLoss?.() } catch { /* 上下文已失 */ }
  }
}
