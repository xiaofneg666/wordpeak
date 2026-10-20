// 官网场景(图一开场 + 图二 hero 巡航变体) —— 用户五张参考图为视觉核心的"活的原画":
//   星辰塔整图 = 真·六面体(前表面与旧正面严格同位:正面观感零变化,环视时侧面
//     显露;加色混合 + 背面剔除,黑天加零贡献,六面互不串影)
//   星云图(白底键控) = 天幕大笔;行星轨道金痕图(黑底) = 加色铺陈的轨道装饰
//   星球图(白底键控) = 大中小三档词星球:真球体 + 打光成体积 —— 暖主光定昼夜线、
//     冷环境光兜夜面,贴图特征随自转绕球身走(图上无文字,悬停出词卡,点击进词卡)。
//     六面体方案已撤:不受光的贴图贴在几个面上都是平面,堆不出立体感
//   星鸟整群队形图(黑底) = 巡航鸟群;另保留 3D 层的椭圆环/能量弧/沿轨星点/星尘
// 3D 不再"仿画",只负责让原画活起来:公转、漂浮、自主呼吸;指针只驱动悬停/点击,
// home 支持拖拽环视(有界 ±34°/±17°,松手回弹)——词星球是真球体,绕到侧面能亲验昼夜线。
// 转场 = 纯物理推近(fov 全程不动):向塔冠星芒直推,无任何光效/星流/辉光涨落;
// home 从推近的末机位起缓落回巡航 —— 硬切点两侧画面严格同构,读作同一镜头的延续。
// 不再挂 Atrium(其紫天幕是历轮"太亮"的底噪),背景即参考图自身的深藏青。
// mode='intro':开场近景;mode='home':同构图后退一档的安静巡航(首页 hero)
import * as THREE from 'three'
import { makeGlowTexture } from '../galaxy/atrium.js'
import { createComposer } from '../galaxy/postfx.js'
import towerUrl from '../../assets/intro/tower.png'
import planetUrl from '../../assets/intro/planet.png'
import nebulaUrl from '../../assets/intro/nebula.png'
import orbitUrl from '../../assets/intro/orbit.jpg'
import flockUrl from '../../assets/intro/flock.png'
import stragglerUrl from '../../assets/intro/straggler.png'

const BG = 0x030611 // 官网深空底色(与塔图自带深藏青同族,加色叠加后无缝)

// 02 星球:大 / 中 / 小三档(贴图自带辉光晕,按序循环 + 微抖)
const PLANET_SIZES = [1.05, 1.7, 2.5]

// 塔尖星芒贴图:暖白光核 + 十字长芒(点睛的呼吸光饰)
function makeStarTexture() {
  const cv = document.createElement('canvas')
  cv.width = 128; cv.height = 128
  const ctx = cv.getContext('2d')
  const core = ctx.createRadialGradient(64, 64, 0, 64, 64, 22)
  core.addColorStop(0, 'rgba(255, 251, 242, 1)')
  core.addColorStop(0.45, 'rgba(255, 243, 220, 0.5)')
  core.addColorStop(1, 'rgba(255, 243, 220, 0)')
  ctx.fillStyle = core
  ctx.fillRect(0, 0, 128, 128)
  const ray = (x0, y0, x1, y1, rx, ry, rw, rh) => {
    const lg = ctx.createLinearGradient(x0, y0, x1, y1)
    lg.addColorStop(0, 'rgba(255, 246, 228, 0)')
    lg.addColorStop(0.5, 'rgba(255, 250, 238, 0.85)')
    lg.addColorStop(1, 'rgba(255, 246, 228, 0)')
    ctx.fillStyle = lg
    ctx.fillRect(rx, ry, rw, rh)
  }
  ray(64, 6, 64, 122, 62, 6, 4, 116) // 竖芒
  ray(6, 64, 122, 64, 6, 62, 116, 4) // 横芒
  const tex = new THREE.CanvasTexture(cv)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.userData.own = true
  return tex
}

export class IntroScene {
  constructor(el, { words = [], lowEnd = false, mode = 'intro', onHover = null, onHoverMove = null, onPick = null, onReady = null } = {}) {
    this.el = el
    this.lowEnd = lowEnd
    this.mode = mode
    this._speedScale = mode === 'home' ? 0.55 : 1 // 首页巡航:更慢的公转与鸟群,安静感
    this.disposed = false
    this.ready = false
    this.onHover = onHover
    this.onHoverMove = onHoverMove
    this.onPick = onPick
    this.onReady = onReady
    this.hovered = -1
    this._trans = null        // 转场状态 { t } —— null 表示常规巡航
    this._orbitSpeed = 1
    this._birdSpeed = 1
    this.clock = new THREE.Clock()
    this._ray = new THREE.Raycaster()
    this._ndc = new THREE.Vector2()
    this._vec = new THREE.Vector3() // projectHover 每帧复用,零分配
    this._pointer = { nx: 0, ny: 0 }
    this._paral = new THREE.Vector3()

    // 不开 preserveDrawingBuffer:它每帧强制拷贝整个绘制缓冲,是实测卡顿源之一
    const renderer = new THREE.WebGLRenderer({ antialias: !lowEnd, powerPreference: 'high-performance' })
    renderer.setPixelRatio(lowEnd ? 1 : Math.min(window.devicePixelRatio || 1, 2))
    const w = Math.max(1, el.clientWidth || 1)
    const h = Math.max(1, el.clientHeight || 1)
    renderer.setSize(w, h)
    el.appendChild(renderer.domElement)
    this.renderer = renderer

    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color(BG)

    this.camera = new THREE.PerspectiveCamera(47, w / h, 0.1, 460)
    // 构图(塔占画面中央偏右,左侧留给文案):
    //   intro = 塔板近景(塔尖辉光压着画面上沿);home = 同构图后退一档,读作"巡航远景"
    if (mode === 'home') {
      this._camBase = new THREE.Vector3(0.9, 3.2, 14.9)
      this._camAim = new THREE.Vector3(-3.7, 2.8, 0)
    } else {
      this._camBase = new THREE.Vector3(0.8, 2.9, 12.6)
      this._camAim = new THREE.Vector3(-3.2, 2.8, 0)
    }
    this._camNow = this._camBase.clone()
    this._aimNow = this._camAim.clone()
    this.camera.position.copy(this._camBase)
    this.camera.lookAt(this._camAim)
    if (mode === 'home') {
      // 转场落位衔接:从推近的末机位起(与开场硬切点同画面),tick 阻尼缓落回巡航
      this.camera.position.set(-0.4, 10.5, -12)
      this._aimNow.set(0.1, 17, -30)
      this.camera.lookAt(this._aimNow)
      // 拖拽环视(仅 home):词星球已升级为真球体,拖拽绕巡航瞄准点小角度旋转,
      // 能绕到侧面看到昼夜线与暗面 —— 平面时代的"指针视差"已撤,这是显式手势,有界且松手回弹
      this._orbit = { yaw: 0, pitch: 0, tYaw: 0, tPitch: 0, dragging: false }
    }
    // 环视的临时向量(绕轴旋转用)
    this._ov1 = new THREE.Vector3()
    this._ov2 = new THREE.Vector3()
    this._oup = new THREE.Vector3(0, 1, 0)

    this.group = new THREE.Group() // 全部自建内容,dispose 时统一清理
    this.scene.add(this.group)

    // 纹理即参考图本体;塔图就绪即整个画面就绪(失败也照常放行,rails/星尘仍在)
    this._loader = new THREE.TextureLoader()
    this._tex = {}
    this._readyTimer = setTimeout(() => this._markReady(), 3000)

    this._buildBackdrop()
    this._buildTower()
    this._buildPlanets(words)
    this._buildBirds()
    this._buildStardust()

    this._bindInput()

    // 后期:只留 Bloom(把塔尖/金轨/星鸟的亮部托成辉光);DOF 面前已全是无深度精灵,撤
    this.fx = lowEnd ? null : createComposer(renderer, this.scene, this.camera, {
      w, h, pixelRatio: renderer.getPixelRatio(), bloom: true, dof: false,
    })
    if (this.fx?.bloom) {
      this.fx.bloom.strength = 0.38
      this.fx.bloom.threshold = 0.72 // 只让塔尖/金彗头这类真热核泛光,银灰塔身不参与
    }

    this._resizeObs = new ResizeObserver(() => this._resize())
    this._resizeObs.observe(el)

    this._tickRef = () => this._tick()
    renderer.setAnimationLoop(this._tickRef)
  }

  // 参考图纹理:统一 sRGB + own 标记(dispose 时释放);tower 的就绪回调驱动 onReady
  // 未传回调时必须给 undefined 而非 null —— three 判 `onLoad !== undefined`,null 会被当函数调用
  _loadTex(url, key, ready = false) {
    const onLoad = ready ? () => this._markReady() : undefined
    const tex = this._loader.load(url, onLoad, undefined, onLoad)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.userData.own = true
    this._tex[key] = tex
    return tex
  }

  _markReady() {
    if (this.disposed || this.ready) return
    clearTimeout(this._readyTimer)
    this.ready = true
    this.onReady?.()
  }

  // ===== 05 星云与光效 + 04 金色轨道光痕:最远两层天幕 =====
  _buildBackdrop() {
    // 星云(参考 05 键控稿,资产已整体压暗到深空紫):紫蓝大笔 + 粉芯,左下天幕;右上一枚淡镜像收平衡
    const nebTex = this._loadTex(nebulaUrl, 'nebula')
    const main = new THREE.Sprite(new THREE.SpriteMaterial({
      map: nebTex, transparent: true, opacity: 0.5, depthWrite: false, fog: false,
    }))
    main.position.set(-16, -9, -118)
    main.scale.set(128, 82, 1)
    this.group.add(main)
    const echo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: nebTex, transparent: true, opacity: 0.09, depthWrite: false, fog: false, rotation: Math.PI,
    }))
    echo.position.set(52, 24, -128)
    echo.scale.set(80, 52, 1)
    this.group.add(echo)
    // 金色轨道光痕(参考 04 原图,黑底加色零贡献):一条主对角 + 一条淡镜像,压两档只做点缀
    const orbTex = this._loadTex(orbitUrl, 'orbit')
    const streak = new THREE.Sprite(new THREE.SpriteMaterial({
      map: orbTex, transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    }))
    streak.position.set(6, 1, -86)
    streak.scale.set(112, 86, 1)
    streak.material.rotation = -0.16
    this.group.add(streak)
    const streak2 = new THREE.Sprite(new THREE.SpriteMaterial({
      map: orbTex, transparent: true, opacity: 0.08, blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    }))
    streak2.position.set(-38, -16, -96)
    streak2.scale.set(74, 57, 1)
    streak2.material.rotation = Math.PI - 0.4
    this.group.add(streak2)
  }

  // ===== 01 中央星辰塔:参考图整板贴真六面体(羽化边缘 + 加色混合 = 原画的构图/配色/辉光全继承) =====
  _buildTower() {
    const tex = this._loadTex(towerUrl, 'tower', true)
    // 塔 = 真六面体:参考图同贴六面,正面与前平面严格同位 —— 正面观感零变化;
    // 推近时视角变化读出真实体积(贴面随视角透视),不再是锁死正面的平面贴片。
    // 加色混合 + 背面剔除:背面永远不可见,黑天加零贡献,六面互不串扰
    const box = new THREE.Mesh(
      new THREE.BoxGeometry(46, 46, 46),
      new THREE.MeshBasicMaterial({
        map: tex, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending,
        depthWrite: false, fog: false, side: THREE.FrontSide,
      }),
    )
    // 前表面保持在旧平面 z=-30 上,盒体只向场景深处生长(z: -76..-30):
    // 巡航/推近/硬切两侧的画面构图与已验证的转场几何全部保持不变
    box.position.set(-1.5, 1.6, -53)
    this.tower = box
    this.group.add(box)
    // 塔尖星芒(点睛):对齐塔图尖冠的十字辉光,呼吸起伏
    this.jewel = new THREE.Sprite(new THREE.SpriteMaterial({
      map: makeStarTexture(), color: 0xfff3e0, transparent: true, opacity: 0.3,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    }))
    this.jewel.position.set(0.1, 17.2, -29)
    this.jewel.scale.set(6.5, 6.5, 1)
    this.group.add(this.jewel)
  }

  // ===== 02 词星球(参考图键控稿) + 04 椭圆环/能量弧/沿轨星点 =====
  _buildPlanets(words) {
    const planetTex = this._loadTex(planetUrl, 'planet')
    // 行星光影:全场其余材质是 Basic/Sprite 不受光,这两盏灯只伺候星球。
    // 暖主光从右上前方定昼夜线,冷环境光把夜面压暗并染深空蓝;物理光单位配平
    // (受光面辐照合计 ≈ π),贴图原色不漂白不发灰 —— 立体感由"正球 + 明暗线"读出
    const key = new THREE.DirectionalLight(0xffe8cf, 2.4)
    key.position.set(16, 20, 26)
    this.group.add(key)
    this.group.add(new THREE.AmbientLight(0x5a6b9e, 1.6))
    // 贴图裁进盘心采样(repeat<1 不越界,极区/接缝不夹键控边);球体/材质全场共享
    planetTex.repeat.set(0.92, 0.92)
    planetTex.offset.set(0.04, 0.04)
    this._sphereGeo = new THREE.SphereGeometry(0.5, 28, 20)
    this._planetMat = new THREE.MeshStandardMaterial({ map: planetTex, roughness: 0.92, metalness: 0.02, fog: false })
    this.rings = []
    this._pickables = []
    this.planets = []
    // 椭圆规格:ax/az 为椭圆缩放;arc 为能量弧主色(暖白金/暖白/银)
    const ringSpec = [
      { r: 4.9, tx: 0.38, tz: 0.0, ax: 1.32, az: 0.82, arc: 0xffd8a0 },
      { r: 6.9, tx: -0.24, tz: 0.16, ax: 1.58, az: 0.72, arc: 0xefe4e1 },
      { r: 9.1, tx: 0.12, tz: -0.26, ax: 1.45, az: 0.66, arc: 0xd2d8e6 },
    ]
    let pi = 0
    for (const spec of ringSpec) {
      const ring = new THREE.Group()
      ring.rotation.set(spec.tx, 0, spec.tz)
      ring.position.set(0, 1.0, 0)
      // 轨道环带:细到像一枚光圈,不抢星球
      const rail = new THREE.Mesh(
        new THREE.TorusGeometry(spec.r, 0.014, 6, 150),
        new THREE.MeshBasicMaterial({ color: 0x4a68a8, transparent: true, opacity: 0.28, fog: false }),
      )
      rail.rotation.x = Math.PI / 2
      rail.scale.set(spec.ax, spec.az, 1)
      ring.add(rail)
      // 能量弧:暖白金彗头(短亮)+ 玫红拖尾(长淡),沿椭圆巡行
      const arcHolder = new THREE.Group()
      arcHolder.scale.set(spec.ax, spec.az, 1)
      const head = new THREE.Mesh(
        new THREE.TorusGeometry(spec.r, 0.05, 6, 26, 0.42),
        new THREE.MeshBasicMaterial({ color: spec.arc, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }),
      )
      head.rotation.x = Math.PI / 2
      arcHolder.add(head)
      const trail = new THREE.Mesh(
        new THREE.TorusGeometry(spec.r, 0.034, 6, 40, 1.5),
        new THREE.MeshBasicMaterial({ color: 0xb98ba0, transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }),
      )
      trail.rotation.x = Math.PI / 2
      trail.rotation.y = -0.55
      arcHolder.add(trail)
      ring.add(arcHolder)
      ring.userData.arc = arcHolder
      // 沿轨细星点:贴着椭圆撒一圈微亮尘
      const N = 26
      const pos = new Float32Array(N * 3)
      for (let k = 0; k < N; k++) {
        const a = (k / N) * Math.PI * 2 + pi
        const jr = 1 + (Math.random() - 0.5) * 0.05
        pos[k * 3] = Math.cos(a) * spec.r * spec.ax * jr
        pos[k * 3 + 1] = (Math.random() - 0.5) * 0.16
        pos[k * 3 + 2] = Math.sin(a) * spec.r * spec.az * jr
      }
      const dustGeo = new THREE.BufferGeometry()
      dustGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
      ring.add(new THREE.Points(dustGeo, new THREE.PointsMaterial({
        size: 0.1, map: makeGlowTexture(), color: 0xe8eeff, transparent: true, opacity: 0.45,
        blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
      })))
      // 星球:大中小三档循环 + 每颗微抖(参考 02:同族不同号);贴图无文字
      const items = words.slice(pi, pi + 4)
      for (let k = 0; k < items.length; k++) {
        const idx = pi + k
        const planet = this._makePlanet(items[k], idx)
        const a = (k / items.length) * Math.PI * 2 + pi * 1.9
        planet.position.set(Math.cos(a) * spec.r * spec.ax, Math.sin(a * 0.7) * 0.35, Math.sin(a) * spec.r * spec.az)
        ring.add(planet)
        pi++
      }
      ring.userData.speed = 0.05 + spec.r * 0.004 // 外环更慢,层级拉开
      ring.userData.arcSpeed = 0.16 + spec.r * 0.012
      this.rings.push(ring)
      this.group.add(ring)
    }
  }

  _makePlanet(word, idx) {
    // 大中小三档循环 + 每颗微抖;真球体 + 受光材质:轮廓任何角度都是圆,
    // 主光定出昼夜线,自转让贴图特征绕球身走 —— 立体感来自体积与光影,
    // 不是把同一张贴图糊在几个平面上(那只是"会翻面的贴纸",六面体方案已撤)
    const r = PLANET_SIZES[idx % 3] * (0.95 + ((idx * 31) % 7) / 7 * 0.12)
    const mesh = new THREE.Mesh(this._sphereGeo, this._planetMat)
    mesh.scale.setScalar(r)
    mesh.rotation.y = ((idx * 47) % 30 - 15) / 100 // 初始朝向错开,各颗受光面不重样
    // 柔晕:径向渐晕,悬停时增亮(只做悬停反馈层,不承担体积感)
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: makeGlowTexture(), color: 0x8f6cff, transparent: true, opacity: 0.1,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    }))
    glow.scale.setScalar(r * 3.2)
    mesh.add(glow)
    mesh.userData = { word, glow, baseR: r, phase: ((word.id ?? idx) % 10) / 10 * Math.PI * 2, spin: (idx % 2 ? 1 : -1) * (0.12 + (idx % 3) * 0.05) }
    this._pickables.push(mesh)
    this.planets.push(mesh)
    return mesh
  }

  // ===== 03 星鸟群:参考图原生队形整群巡航(贴图自带钢青辉光) =====
  _buildBirds() {
    this.birds = []
    const flockTex = this._loadTex(flockUrl, 'flock')
    const singleTex = this._loadTex(stragglerUrl, 'straggler')
    const mk = (tex, x, y, z, s, op) => {
      const spr = new THREE.Sprite(new THREE.SpriteMaterial({
        map: tex, transparent: true, opacity: op, blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
      }))
      spr.position.set(x, y, z)
      spr.userData = { baseOp: op, baseS: s, cx: x, cy: y, cz: z, a: Math.random() * Math.PI * 2, speed: 0.04 + Math.random() * 0.03, bob: Math.random() * Math.PI * 2 }
      this.group.add(spr)
      this.birds.push(spr)
      return spr
    }
    // 整群(参考 03 的原生编队)在上层空域缓巡;两只孤鸟在近处错层伴飞
    // 全场只允许塔一个主导层:鸟群/光痕/星云一律压成点缀,叠加总和才是"太亮"的真相
    this.flock = mk(flockTex, 10.5, 8.6, -14, 13.5, 0.42)
    this.flock.userData.rx = 4.5; this.flock.userData.ry = 1.6
    const s1 = mk(singleTex, -9, 6.8, -9, 3.1, 0.4)
    s1.userData.rx = 7; s1.userData.ry = 2.2
    const s2 = mk(singleTex, 14, 3.6, -17, 2.4, 0.32)
    s2.userData.rx = 5.5; s2.userData.ry = 1.8
  }

  // 星尘:塔周缓升的微亮尘埃(空气感)
  _buildStardust() {
    const N = this.lowEnd ? 50 : 130
    const pos = new Float32Array(N * 3)
    for (let i = 0; i < N; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 28
      pos[i * 3 + 1] = -2 + Math.random() * 11
      pos[i * 3 + 2] = (Math.random() - 0.5) * 28
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    this.stardust = new THREE.Points(geo, new THREE.PointsMaterial({
      size: 0.13, map: makeGlowTexture(), color: 0xdfe8ff, transparent: true, opacity: 0.2,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    }))
    this.group.add(this.stardust)
  }

  _bindInput() {
    const el = this.renderer.domElement
    this._onMove = (e) => {
      // 环视拖拽(home):按住拖动 = 绕巡航瞄准点旋转视角 —— 词星球是真球体,
      // 拖到侧面能看到昼夜线与暗面;有界(±34°/±17°),松手回弹
      if (this._orbit?.dragging) {
        const dx = e.clientX - this._drag.x
        const dy = e.clientY - this._drag.y
        this._drag = { x: e.clientX, y: e.clientY }
        this._orbit.tYaw = Math.max(-0.6, Math.min(0.6, this._orbit.tYaw - dx * 0.0035))
        this._orbit.tPitch = Math.max(-0.3, Math.min(0.3, this._orbit.tPitch - dy * 0.0028))
      }
      const rect = el.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top
      this._pointer.nx = (x / rect.width) * 2 - 1
      this._pointer.ny = (y / rect.height) * 2 - 1
      this._ray.setFromCamera(this._ndc.set(this._pointer.nx, -this._pointer.ny), this.camera)
      const hit = this._ray.intersectObjects(this._pickables, false)[0]
      const idx = hit ? this._pickables.indexOf(hit.object) : -1
      if (idx !== this.hovered) {
        this.hovered = idx
        el.style.cursor = idx >= 0 ? 'pointer' : 'default'
        this.onHover?.(idx >= 0 ? this._pickables[idx].userData.word : null, this.hovered)
      }
    }
    this._onDown = (e) => {
      this._downAt = { x: e.clientX, y: e.clientY, t: performance.now() }
      if (this._orbit) {
        this._orbit.dragging = true
        this._drag = { x: e.clientX, y: e.clientY }
        el.style.cursor = 'grabbing'
      }
    }
    this._onUp = (e) => {
      if (this._orbit?.dragging) {
        this._orbit.dragging = false
        el.style.cursor = 'default'
      }
      if (!this._downAt || performance.now() - this._downAt.t > 400) return
      if (Math.hypot(e.clientX - this._downAt.x, e.clientY - this._downAt.y) > 9) return
      if (this.hovered >= 0 && !this._trans) {
        this.onPick?.(this._pickables[this.hovered].userData.word)
      }
    }
    this._onLeave = () => {
      if (this._orbit) this._orbit.dragging = false
      this._onMove({ clientX: -1e4, clientY: -1e4 })
    }
    el.addEventListener('pointermove', this._onMove)
    el.addEventListener('pointerdown', this._onDown)
    el.addEventListener('pointerup', this._onUp)
    el.addEventListener('pointerleave', this._onLeave)
  }

  // DOM 悬停信息卡跟随星球:投影当前世界坐标到屏幕
  projectHover() {
    if (this.hovered < 0) return null
    const v = this._vec.setFromMatrixPosition(this._pickables[this.hovered].matrixWorld).project(this.camera)
    if (v.z > 1) return null
    return { x: (v.x * 0.5 + 0.5) * this.el.clientWidth, y: (-v.y * 0.5 + 0.5) * this.el.clientHeight }
  }

  // 发起转场:纯镜头推近(1.3s 推满,fov 全程不动),无任何光效;DOM 侧同一节奏换场
  beginTransition() {
    if (this._trans) return
    if (this._orbit) { this._orbit.dragging = false; this._orbit.tYaw = 0; this._orbit.tPitch = 0 }
    this._trans = { t: 0 }
  }

  _tick() {
    if (this.disposed) return
    const dt = Math.min(this.clock.getDelta(), 0.05)
    const t = this.clock.elapsedTime

    // 转场进度:1.3s 内推满(1300ms 走完并定格,1330ms DOM 侧换场 —— 切点两侧机位严格相同)
    let ease = 0
    if (this._trans) {
      this._trans.t = Math.min(1, this._trans.t + dt / 1.3)
      ease = Math.pow(this._trans.t, 2)
      this._orbitSpeed = 1 + 7 * ease
      this._birdSpeed = 1 + 3 * ease
      if (this._trans.t >= 1) this._trans = { t: 1, hold: true } // 保持末帧,由 DOM 侧收尾
    }

    // 镜头:巡航 = 基准机位 + 极慢自主漂移(不跟指针);转场 = 向塔冠星芒的纯物理推近
    if (this._trans) {
      // 推近终点 = home 落位机位(严格一致):塔冠星芒居中、塔图占满画幅,硬切零跳变
      this._camNow.set(0.8 + (-0.4 - 0.8) * ease, 2.9 + (10.5 - 2.9) * ease, 12.6 + (-12 - 12.6) * ease)
      this._aimNow.set(-3.2 + (0.1 + 3.2) * ease, 2.8 + (17 - 2.8) * ease, -30 * ease)
      // 推近直接走参数曲线:阻尼追踪加速目标会有 ~40% 路径的稳态滞后(帧率相关、切点对不齐),
      // copy 则零滞后、逐帧确定 —— 换场时刻的机位可精确预测,硬切点两侧画面严格同构
      this.camera.position.copy(this._camNow)
    } else {
      // 巡航:基准机位 + 极慢的自主漂移,画面静中有动;指针不再驱动镜头
      // (平面原画不做 3D 视差,鼠标大幅滑动只会把"贴图感"放大)
      const ix = Math.sin(t * 0.12) * 0.35
      const iy = Math.cos(t * 0.09) * 0.18
      this._camNow.copy(this._camBase).add(this._paral.set(ix, iy, 0))
      // 拖拽环视(home):拖拽把镜头绕巡航瞄准点小角度旋转 —— 词星球的球体轮廓
      // 与昼夜线得以被真正看见;松手后目标角缓慢衰减,镜头自己荡回巡航构图
      if (this._orbit) {
        const o = this._orbit
        if (!o.dragging) { o.tYaw *= 0.965; o.tPitch *= 0.965 }
        o.yaw += (o.tYaw - o.yaw) * 0.1
        o.pitch += (o.tPitch - o.pitch) * 0.1
        if (o.yaw !== 0 || o.pitch !== 0) {
          this._ov1.copy(this._camNow).sub(this._camAim)
          this._ov1.applyAxisAngle(this._oup, o.yaw)
          this._ov2.crossVectors(this._oup, this._ov1).normalize()
          this._ov1.applyAxisAngle(this._ov2, o.pitch)
          this._camNow.copy(this._camAim).add(this._ov1)
        }
      }
      // home 落位回落的起步:阻尼增益在 0.55s 内从 0 缓升至满 —— 硬切后第一步不至于
      // 瞬间跳 4% 步长(那会在切点后一帧弹一下);intro 巡航一开始就收敛在基准,恒满增益
      const g = this.mode === 'home' ? Math.min(0.04, 0.04 * t / 0.55) : 0.04
      // aim 同样阻尼跟随:home 落位时从推近末瞄准点缓缓摆回巡航基准,回落一气呵成
      this._aimNow.lerp(this._camAim, g)
      // 拖拽中跟手一些:0.04 的巡航阻尼追不上手势,会显得"拖不动"
      this.camera.position.lerp(this._camNow, this._orbit?.dragging ? Math.max(g, 0.14) : g)
    }
    this.camera.lookAt(this._aimNow)

    // 星尘:缓慢上升,出顶回底;整体亮度轻轻呼吸(空气感的"活")
    if (this.stardust) {
      const arr = this.stardust.geometry.attributes.position.array
      for (let i = 1; i < arr.length; i += 3) {
        arr[i] += 0.14 * dt
        if (arr[i] > 9) arr[i] = -2
      }
      this.stardust.geometry.attributes.position.needsUpdate = true
      this.stardust.material.opacity = 0.18 + Math.sin(t * 0.7) * 0.06
    }

    // 椭圆轨道进给 / 能量弧巡行 / 词星球呼吸
    for (const ring of this.rings) {
      ring.rotation.y += ring.userData.speed * this._orbitSpeed * this._speedScale * dt
      ring.userData.arc.rotation.y -= ring.userData.arcSpeed * this._speedScale * dt
    }
    for (const p of this.planets) {
      const d = p.userData
      const hovered = this.planets[this.hovered] === p
      const s = hovered ? 1.09 : 1
      const now = p.scale.x + (s * d.baseR - p.scale.x) * 0.12
      p.scale.setScalar(now) // 三轴等比:球体整体呼吸
      p.rotation.y += d.spin * this._speedScale * dt // 真自转:贴图特征绕球身走,昼夜线留在受光方向
      d.glow.material.opacity = (hovered ? 0.26 : 0.1) + Math.sin(t * 1.3 + d.phase) * 0.03
    }

    // 塔尖星芒:只做呼吸;推近时它就在塔冠上,透视放大是天然的,无需人工涨光
    if (this.jewel) {
      this.jewel.material.opacity = 0.26 + Math.sin(t * 0.9) * 0.09
      const js = 6.5 * (1 + Math.sin(t * 0.9) * 0.05)
      this.jewel.scale.set(js, js, 1)
    }

    // 悬停词卡跟随:投影星球当前屏幕坐标给 DOM
    if (this.hovered >= 0 && this.onHoverMove) {
      const p = this.projectHover()
      if (p) this.onHoverMove(this._pickables[this.hovered].userData.word, p.x, p.y)
    }

    // 星鸟:缓巡 + 正弦起伏,扇翅以纵向微缩读出(贴图群自带编队)
    for (const b of this.birds) {
      const d = b.userData
      d.a += d.speed * this._birdSpeed * this._speedScale * dt
      const rx = d.rx || 3, ry = d.ry || 1.4
      b.position.set(
        d.cx + Math.cos(d.a) * rx,
        d.cy + Math.sin(d.a * 0.7) * ry + Math.sin(t * 1.6 + d.bob) * 0.35,
        d.cz,
      )
      b.material.opacity = d.baseOp + Math.sin(t * 1.7 + d.bob) * 0.05
      b.scale.set(d.baseS, d.baseS * (1 + Math.sin(t * 2.2 + d.bob) * 0.045), 1)
    }
    // 鸟群整体轻微摆动:原生队形不再是一块刚性贴图
    if (this.flock) this.flock.material.rotation = Math.sin(t * 0.35) * 0.06

    if (this.fx) this.fx.composer.render()
    else this.renderer.render(this.scene, this.camera)
  }

  _resize() {
    if (this.disposed) return
    const w = Math.max(1, this.el.clientWidth || 1)
    const h = Math.max(1, this.el.clientHeight || 1)
    this.renderer.setSize(w, h)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.fx?.composer.setSize(w, h)
  }

  pause() { if (!this.disposed) this.renderer.setAnimationLoop(null) }
  resume() { if (!this.disposed) this.renderer.setAnimationLoop(this._tickRef) }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    clearTimeout(this._readyTimer)
    this._resizeObs?.disconnect()
    const el = this.renderer.domElement
    el.removeEventListener('pointermove', this._onMove)
    el.removeEventListener('pointerdown', this._onDown)
    el.removeEventListener('pointerup', this._onUp)
    el.removeEventListener('pointerleave', this._onLeave)
    this.renderer.setAnimationLoop(null)
    // 自建资源全量释放;跳过共享件:three.Sprite 的内部几何是模块级共享,makeGlowTexture 单例
    this.scene.traverse((o) => {
      if (o.geometry && !o.isSprite && !o.geometry.userData?.shared) o.geometry.dispose?.()
      const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : []
      for (const m of mats) {
        if (m.map?.userData?.own) m.map.dispose()
        m.dispose?.()
      }
    })
    this.fx?.composer.dispose?.()
    this.renderer.dispose()
    this.scene.environment = null
    el.remove()
  }
}
