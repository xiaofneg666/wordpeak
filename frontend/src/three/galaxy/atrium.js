// Atrium — 词汇圣殿:HDRI 环境 + 悬浮空间(中央纪念碑/尘埃/光帘/星球壳)+ ACES 调色
// 没有地板:全场悬在星海里,近黑背景、中心一束光、边界交给雾
// 与 3D 引擎解耦,主题切换时重读 envMap,只动材质不被几何影响
import * as THREE from 'three'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { LAMP } from './sculpture.js'

// 展厅标高基准(纪念碑基座/尘埃柱/光帘仍用这个零层做参考;地板已不存在)
export const FLOOR_Y = -1.2
export const PLINTH_TOP_Y = -1.08

// 航路光照关键帧:外环巡航段压暗(星域感),低角英雄位给最重的暖(圣坛感)
const KEY_LIGHT = [
  [0, 1.3], [0.14, 1.12], [0.3, 0.98], [0.46, 1.12], [0.62, 1.32], [0.76, 1.5], [0.88, 1.2], [1, 1.3],
]
function lerpKeys(keys, p) {
  for (let i = 1; i < keys.length; i++) {
    if (p <= keys[i][0]) {
      const [u, a] = keys[i - 1]
      const [v, b] = keys[i]
      return a + (b - a) * ((p - u) / (v - u || 1))
    }
  }
  return keys[keys.length - 1][1]
}
function bump(p, c, w) { const d = (p - c) / w; return Math.exp(-d * d) }

// 加载本地 HDRI;走 PMREM 烘成 envMap(粗糙度预积分,3 帧内完成)
// 缓存按 renderer 隔离:PMREM 纹理绑定生成它的 WebGL 上下文,新引擎(新 renderer)
// 拿旧缓存无法重新上传,反射会静默黑掉且永不重试——重挂必须重烘
const _envCache = new WeakMap()
async function loadHDRI(renderer) {
  if (_envCache.has(renderer)) return _envCache.get(renderer)
  const { RGBELoader } = await import('three/addons/loaders/RGBELoader.js')
  const hdr = new RGBELoader()
  return new Promise((resolve, reject) => {
    hdr.load(
      '/hdri/kiara_1_dawn_1k.hdr',
      (texture) => {
        texture.mapping = THREE.EquirectangularReflectionMapping
        const pmrem = new THREE.PMREMGenerator(renderer)
        const envMap = pmrem.fromEquirectangular(texture).texture
        texture.dispose()
        pmrem.dispose()
        _envCache.set(renderer, envMap)
        resolve(envMap)
      },
      undefined,
      (err) => reject(err),
    )
  })
}

// 兜底环境:用 three 内置 RoomEnvironment(无 HDRI 时给一个柔和的摄影棚)
function fallbackEnv(renderer) {
  const pmrem = new THREE.PMREMGenerator(renderer)
  const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
  pmrem.dispose()
  return env
}

// 地板已整体拆除(用户:去掉底盘,词要悬浮在空间里)——
// 脚下直接是 _sky 的星球壳与下沉辉光,全场没有"地",只有悬浮的星群与纪念碑

// 尘埃/柔光的径向渐晕贴图(共享,engine 的词星柔晕也用)
let _glowTex = null
export function makeGlowTexture() {
  if (_glowTex) return _glowTex
  const S = 64
  const cv = document.createElement('canvas')
  cv.width = cv.height = S
  const ctx = cv.getContext('2d')
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.4, 'rgba(255,255,255,0.45)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, S, S)
  _glowTex = new THREE.CanvasTexture(cv)
  return _glowTex
}

// 展厅基底:光池地板 + 一圈极细边界刻线;没有立柱,深度由雾交代
export class Atrium {
  constructor() {
    this.group = new THREE.Group()
    this.lights = [] // dispose 时统一移除
  }

  async setup(renderer, scene, opts = {}) {
    scene.background = new THREE.Color(0x05070f)

    // envMap:HDRI 优先,失败兜底 RoomEnvironment
    let envMap
    try { envMap = await loadHDRI(renderer) } catch { envMap = fallbackEnv(renderer) }
    // HDRI 加载是异步的:期间引擎可能已 dispose(切走/重挂)。
    // 此时再往 scene 里添灯/网格就再无人清理——CPU/GPU 双泄漏,直接放弃装配
    if (this.disposed) return
    scene.environment = envMap
    // 背景不用 envMap(会糊成一片);纯色 + envMap 只喂给材质做反射

    // 灯光三件套:暖主光(射灯)+ 强冷轮廓光(把雕塑从黑背景里勾出来)+ 微环境
    // 视觉冲击的关键是"亮部更亮、边有勾边",不是整体提亮
    const ambient = new THREE.AmbientLight(0x8ea8c8, 0.2)
    scene.add(ambient)
    const key = new THREE.DirectionalLight(0xffe2c4, 1.3) // 暖:展厅射灯,加档
    key.position.set(12, 18, 10)
    scene.add(key)
    const rim = new THREE.DirectionalLight(0x6b9fe8, 0.55) // 冷:轮廓光,给银灰雕塑勾蓝边
    rim.position.set(-16, 9, -14)
    scene.add(rim)
    // 纪念碑顶的真实暖点光:近处雕塑吃到暖回光,中心成为"壁炉"
    const hearth = new THREE.PointLight(0xf2ead8, 60, 40, 2)
    hearth.position.set(0, 5.2, 0)
    scene.add(hearth)
    this.key = key
    this.hearth = hearth
    this._flightP = null
    this._flowSpeed = 1
    this.lights.push(ambient, key, rim, hearth)

    // 不再有地板:没有"地"这回事,全场悬在星海里,深度由雾和星球壳交代

    this._buildMonument(scene, envMap, !!opts.lowEnd)
    this._buildDust(scene)
    this._buildShaft(scene)
    this._buildBackdrop(scene)
    if (!opts.lowEnd) this._buildFlow(scene) // 中场星流:中高端机才开
  }

  // 星辰大海:全域星球壳(上下都有星)+ 四向暗色星云,整组极慢自转
  _buildBackdrop(scene) {
    this._sky = new THREE.Group()
    this._backdrop = []
    // 星云:深蓝主调 + 紫罗兰/青两笔暗色,像银河的呼吸;极低不透明度,不做霓虹
    // 中景三笔(y 有高有低)夹在雕塑群与星球壳之间 —— 航行时视差比远景明显,
    // 空间因此有了近(星群)/中(星云)/远(星球壳)三层,纵深立得住
    for (const [x, y, z, s, color, op] of [
      [0, 12, -150, 240, 0x24406e, 0.3],   // 主:纪念碑后方深蓝
      [-130, 4, -100, 150, 0x2a1f4e, 0.22], // 紫:品牌 accent-2 的暗味
      [120, -10, -70, 130, 0x0e2e46, 0.18], // 青:品牌 accent 的暗味
      [-50, -18, 60, 120, 0x1c2440, 0.15],  // 背后低位补一笔
      // 脚下:往下看是星海,不是黑底 —— 两笔下沉辉光托住悬浮的星群
      [0, -38, -25, 210, 0x1a2c4e, 0.26],
      [-75, -45, 70, 150, 0x141f3a, 0.2],
      // 中景星云:有厚度的新空间里,中层也需要星气
      [-60, 7, -85, 95, 0x1b2a52, 0.14],
      [72, -8, -68, 110, 0x241f3e, 0.12],
      [-34, -13, 55, 90, 0x10263c, 0.1],
    ]) {
      const spr = new THREE.Sprite(new THREE.SpriteMaterial({
        map: makeGlowTexture(), color, transparent: true, opacity: op,
        depthWrite: false, fog: false,
      }))
      spr.position.set(x, y, z)
      spr.scale.set(s, s * 0.45, 1)
      this._sky.add(spr)
      this._backdrop.push(spr)
    }
    // 星球壳:三层大小/亮度,均匀撒在 130~210 的球壳上(脚下也有)
    // 最亮一层会被 Bloom 挑出来闪 —— "星辰"必须有明暗差才有"大海"的纵深
    for (const [n, size, color, op] of [
      [900, 0.11, 0x9fb2cc, 0.5],
      [300, 0.18, 0xcdd9ea, 0.7],
      [70, 0.34, 0xeef4ff, 0.95],
    ]) {
      const pos = new Float32Array(n * 3)
      for (let i = 0; i < n; i++) {
        const r = 130 + Math.random() * 80
        const u = Math.random() * 2 - 1
        const a = Math.random() * Math.PI * 2
        const s = Math.sqrt(1 - u * u)
        pos[i * 3] = Math.cos(a) * s * r
        pos[i * 3 + 1] = u * r
        pos[i * 3 + 2] = Math.sin(a) * s * r
      }
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
      this._sky.add(new THREE.Points(geo, new THREE.PointsMaterial({
        map: makeGlowTexture(), color, size,
        transparent: true, opacity: op, depthWrite: false,
        blending: THREE.AdditiveBlending, sizeAttenuation: true, fog: false,
      })))
    }
    scene.add(this._sky)
  }

  // 词汇之心:中央纪念碑 —— 拉长八面晶体 + 顶点暖灯 + 双轨道环,落在纪念章上
  // 空广场有了视觉锚,三环展厅有了"众星拱月"的构图
  _buildMonument(scene, envMap, lowEnd) {
    const g = new THREE.Group()
    this.monument = g

    // 基座:高一级的阶梯感,石墨
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(1.7, 2.0, 0.5, 48),
      new THREE.MeshStandardMaterial({ color: 0x11151f, roughness: 0.5, metalness: 0.4, envMapIntensity: 0.5 }),
    )
    base.position.y = FLOOR_Y + 0.25
    g.add(base)

    // 晶体:拉长八面体。低端机不开 transmission(那是整场景再渲一遍的代价),换抛光钢
    const crystalGeo = new THREE.OctahedronGeometry(1.05, 0)
    const crystalMat = lowEnd
      ? new THREE.MeshStandardMaterial({ color: 0xc9d2dd, metalness: 0.95, roughness: 0.12, envMapIntensity: 1.3, envMap })
      : new THREE.MeshPhysicalMaterial({
          color: 0xd9dfe8, metalness: 0.1, roughness: 0.06, envMap, envMapIntensity: 1.25,
          transmission: 0.62, ior: 1.45, thickness: 1.4,
        })
    this.crystal = new THREE.Mesh(crystalGeo, crystalMat)
    this.crystal.scale.set(1, 2.55, 1)
    this.crystal.position.y = 2.1
    g.add(this.crystal)

    // 顶点暖灯:像塔尖的信号灯,全场唯一的暖光源落点(Bloom 会给它柔晕)
    const beacon = new THREE.Mesh(
      new THREE.SphereGeometry(0.11, 16, 12),
      new THREE.MeshStandardMaterial({
        color: LAMP, emissive: LAMP, emissiveIntensity: 1.8, roughness: 0.4,
      }),
    )
    beacon.position.y = 2.1 + 2.55 * 1.05
    g.add(beacon)

    // 双轨道环:一正一反慢慢转,让纪念碑"活着"
    this.rings = []
    for (const [r, y, tiltX] of [[2.3, 1.35, 0.28], [1.55, 3.15, -0.42]]) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(r, 0.03, 8, 96),
        new THREE.MeshStandardMaterial({
          color: 0x5c6470, metalness: 0.95, roughness: 0.2, envMapIntensity: 1.0, envMap,
        }),
      )
      ring.rotation.x = Math.PI / 2 + tiltX
      ring.position.y = y
      g.add(ring)
      this.rings.push(ring)
    }
    scene.add(g)
  }

  // 尘埃:光柱里慢慢上浮的微尘,展厅的"空气感"(参考站的必备一粒盐)
  _buildDust(scene) {
    const N = 220
    const pos = new Float32Array(N * 3)
    this._dust = []
    for (let i = 0; i < N; i++) {
      const r = 0.5 + Math.random() * 2.4
      const a = Math.random() * Math.PI * 2
      this._dust.push({
        x: Math.cos(a) * r, z: Math.sin(a) * r,
        y: FLOOR_Y + Math.random() * 11,
        vy: 0.08 + Math.random() * 0.22,
        va: 0.01 + Math.random() * 0.05, // 绕柱缓旋
        a,
      })
      pos[i * 3] = this._dust[i].x
      pos[i * 3 + 1] = this._dust[i].y
      pos[i * 3 + 2] = this._dust[i].z
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    this.dust = new THREE.Points(geo, new THREE.PointsMaterial({
      map: makeGlowTexture(), color: 0xcfd8e6, size: 0.16,
      transparent: true, opacity: 0.5, depthWrite: false,
      blending: THREE.AdditiveBlending, sizeAttenuation: true,
    }))
    scene.add(this.dust)
  }

  // 中场星流:铺在雕塑群之间的 1000 粒微星(介于雕塑和远星空之间的景深层)
  // 灵感来自 Lusion 的「场景回应你」:光标扫过时星尘被推开,松手后慢慢回流
  // 纯 CPU 力场(绕心缓旋 + 光标斥力 + 阻尼),1000 粒每帧毫无压力
  _buildFlow(scene) {
    const N = 1000
    const pos = new Float32Array(N * 3)
    this._flow = []
    for (let i = 0; i < N; i++) {
      const r = 5 + Math.random() * 40
      const a = Math.random() * Math.PI * 2
      const p = {
        x: Math.cos(a) * r, z: Math.sin(a) * r,
        y: -5 + Math.random() * 19, // 铺满星群的新厚度(±5.5),不是只有上半场
        vx: 0, vy: 0, vz: 0,
        ph: Math.random() * Math.PI * 2,
      }
      this._flow.push(p)
      pos[i * 3] = p.x
      pos[i * 3 + 1] = p.y
      pos[i * 3 + 2] = p.z
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    this.flow = new THREE.Points(geo, new THREE.PointsMaterial({
      map: makeGlowTexture(), color: 0xaec3e0, size: 0.09,
      transparent: true, opacity: 0.4, depthWrite: false,
      blending: THREE.AdditiveBlending, sizeAttenuation: true,
    }))
    scene.add(this.flow)
  }

  // _flow 每帧积分:绕心缓旋(天体漂移感)+ 光标斥力(场景回应)+ 阻尼回流
  _updateFlow(t, dt, pointer) {
    if (!this.flow || !this._flow) return
    const attr = this.flow.geometry.attributes.position
    const arr = attr.array
    const px = pointer ? pointer.x : 0
    const pz = pointer ? pointer.z : 0
    for (let i = 0; i < this._flow.length; i++) {
      const p = this._flow[i]
      // 绕心切向漂移:离中心越远越慢,像整体在极慢旋转(航行时随航速加速)
      const drift = 0.14 * this._flowSpeed
      const rx = p.x, rz = p.z
      const rl = Math.max(2, Math.sqrt(rx * rx + rz * rz))
      p.vx += (-rz / rl) * drift * dt
      p.vz += (rx / rl) * drift * dt
      // 上下微呼吸
      p.vy += Math.sin(t * 0.5 + p.ph) * 0.02 * dt
      // 光标斥力:半径 9 内被推开,越近越强
      if (pointer) {
        const dx = p.x - px, dz = p.z - pz
        const d2 = dx * dx + dz * dz
        if (d2 < 81) {
          const d = Math.max(0.6, Math.sqrt(d2))
          const f = (1 - d / 9) * 3.2 * dt
          p.vx += (dx / d) * f
          p.vz += (dz / d) * f
          p.vy += 0.2 * f
        }
      }
      // 阻尼 + 积分
      p.vx *= 0.94; p.vy *= 0.96; p.vz *= 0.94
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt
      // 边界:高度环绕,半径拉回
      if (p.y > 14) p.y = -5
      if (p.y < -5.2) p.y = 13.8
      const r2 = p.x * p.x + p.z * p.z
      if (r2 > 2209) { // 47²
        const k = 47 / Math.sqrt(r2)
        p.x *= k; p.z *= k
      }
      arr[i * 3] = p.x
      arr[i * 3 + 1] = p.y
      arr[i * 3 + 2] = p.z
    }
    attr.needsUpdate = true
  }

  // 天光:纪念碑上方一道极淡的锥形光帘(假体积光,加色混合,几乎只是"气氛")
  _buildShaft(scene) {
    const cv = document.createElement('canvas')
    cv.width = 4; cv.height = 128
    const ctx = cv.getContext('2d')
    const grad = ctx.createLinearGradient(0, 0, 0, 128)
    grad.addColorStop(0, 'rgba(215,226,245,0.5)')
    grad.addColorStop(0.5, 'rgba(215,226,245,0.16)')
    grad.addColorStop(1, 'rgba(215,226,245,0)')
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, 4, 128)
    const tex = new THREE.CanvasTexture(cv)
    this.shaft = new THREE.Mesh(
      new THREE.CylinderGeometry(1.5, 2.6, 12, 48, 1, true),
      new THREE.MeshBasicMaterial({
        map: tex, transparent: true, opacity: 0.4, depthWrite: false,
        blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      }),
    )
    this.shaft.position.y = FLOOR_Y + 6.2
    this.shaft._materialTex = tex
    scene.add(this.shaft)
  }

  // 航路驱动:p=航程进度(光照/光帘/壁炉沿航路呼吸),null=回基础值(自由漫游)
  setFlight(p) { this._flightP = p }

  // 星流速度倍率:航行中随航速加速,静止回落 1
  setFlowSpeed(v) { this._flowSpeed = v || 1 }

  _applyFlightLight(p) {
    if (!this.key || !this.hearth) return
    if (p == null) {
      this.key.intensity = 1.3
      this.hearth.intensity = 60
      if (this.shaft) this.shaft.material.opacity = 0.4
      return
    }
    this.key.intensity = lerpKeys(KEY_LIGHT, p)
    this.hearth.intensity = 60 * (1 + 0.5 * bump(p, 0.76, 0.1))
    if (this.shaft) this.shaft.material.opacity = 0.4 * (1 + 0.45 * bump(p, 0.82, 0.12))
  }

  // 每帧:晶体慢转、双环反向、尘埃上浮绕柱、星空整体极慢自转、中场星流回应光标
  update(t, dt, pointerWorld) {
    this._applyFlightLight(this._flightP)
    if (this._sky) this._sky.rotation.y = t * 0.004
    if (this.crystal) {
      this.crystal.rotation.y = t * 0.12
      this.crystal.position.y = 2.1 + Math.sin(t * 0.45) * 0.12
    }
    if (this.rings?.length) {
      this.rings[0].rotation.z = t * 0.25
      this.rings[1].rotation.z = -t * 0.18
    }
    if (this.flow) this._updateFlow(t, dt, pointerWorld)
    if (this.dust && this._dust) {
      const attr = this.dust.geometry.attributes.position
      const arr = attr.array
      for (let i = 0; i < this._dust.length; i++) {
        const p = this._dust[i]
        p.y += p.vy * dt
        if (p.y > FLOOR_Y + 11.5) p.y = FLOOR_Y
        p.a += p.va * dt
        arr[i * 3] = p.x * Math.cos(p.a)
        arr[i * 3 + 2] = p.z * Math.sin(p.a)
        arr[i * 3 + 1] = p.y
      }
      attr.needsUpdate = true
    }
  }

  applyTheme() {
    // 空间色是固定舞台,不跟主题换;主题色只在雕塑选中态/HUD 上出现
  }

  dispose() {
    this.disposed = true
    for (const l of this.lights) l.parent?.remove(l)
    this.lights = []
    // 纪念碑 + 尘埃 + 光帘 + 星空 + 中场星流
    for (const obj of [this.monument, this.dust, this.shaft, this.flow, this._sky]) obj?.parent?.remove(obj)
    this.flow?.geometry.dispose()
    this.flow?.material.dispose()
    this.flow = null
    this._flow = null
    this._sky?.traverse((o) => {
      o.geometry?.dispose()
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose())
    })
    this._sky = null
    this._backdrop = []
    this.monument?.traverse((o) => {
      o.geometry?.dispose()
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose())
    })
    this.dust?.geometry.dispose()
    // 尘埃材质的 map 是模块级共享纹理(halo/星球壳都在用),不在这里单方 dispose;
    // GPU 侧内存随 renderer 的 forceContextLoss 一并归还
    this.dust?.material.dispose()
    this.shaft?._materialTex?.dispose()
    this.shaft?.material.dispose()
    this.shaft?.geometry.dispose()
    this.monument = this.dust = this.shaft = null
  }
}
