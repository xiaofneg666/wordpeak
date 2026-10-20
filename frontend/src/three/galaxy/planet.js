// WordSculpture — 每颗词 = 一只鸟(用户:小方块改成鸟),工厂从雕塑换成鸟几何
// 状态改变不动颜色,只改材质属性(素坯哑光 → 掌握抛光),扇翅在鸟几何顶点着色器里
import * as THREE from 'three'
import { colorForRoot } from './sculpture.js'
import { makeBirdGeometry, applyFlap, nightBase } from './bird.js'
import { readThemeColors } from './theme.js'
import { injectAtmosphere } from './atmosphere.js'

// 鸟统一视觉尺寸(翼展约 1.7,收一点让展位间距从容)
const BASE_SCALE = 0.85

// 确定性伪随机(布局稳定,不闪跳) — 引擎/聚簇/雕塑布局都靠它
export function hash(n) {
  n = Math.imul(n ^ 61, 0x27d4eb2d); n ^= n >>> 15
  n = Math.imul(n, 0x2c1b3c6d); n ^= n >>> 12
  return Math.abs(n) / 2147483647
}

// 大气注入参数(按词根差异化):power/strength/noise 三个维度给不同家族
// 几何身份仍由 sculpture 决定,shader 只做光的差异化;strength 整体降 ~25%,
// 鸟比旧方块表面积大,同强度辉光在鸟身上会连成亮边
function perRootAtmosphereParams(root) {
  const r = String(root || '').toLowerCase()
  // hydro(流体)用得更强一点,mit(送出)用得更柔
  if (r === 'hydro' || r === 'aqua') return { power: 1.9, strength: 0.55, noise: 0.08 }
  if (r === 'mit' || r === 'miss') return { power: 2.8, strength: 0.34, noise: 0.04 }
  if (r === 'struct' || r === 'rupt') return { power: 2.0, strength: 0.48, noise: 0.10 }
  if (r === 'vis' || r === 'spect') return { power: 2.4, strength: 0.42, noise: 0.05 }
  return { power: 2.4, strength: 0.42, noise: 0.06 }
}

// 学习状态 → 材质配方变化
// 注意:不靠颜色,靠 roughness/metalness/几何,符合用户"好看、有质感"的要求
function applyStateStyle(material, state) {
  const s = state?.strength ?? 0
  const isNew = !state || state.is_new
  if (isNew) {
    // 未学:未上釉的素坯——哑光但保持亮银带,别让新号全场发死灰
    material.metalness = 0.3
    material.roughness = 0.45
  } else if (state.due && s < 0.45) {
    // 快忘:中 metalness,稍粗糙
    material.metalness = 0.55
    material.roughness = 0.38
  } else if (state.due) {
    // 待复习:稍亮
    material.metalness = 0.65
    material.roughness = 0.3
  } else if (s > 0.75) {
    // 已掌握:抛光仍在,但收掉铬镜面(0.95/0.08 会让整只鸟变成一颗小太阳)
    material.metalness = 0.85
    material.roughness = 0.18
  } else if (s > 0.45) {
    // 学习中:半哑光
    material.metalness = 0.7
    material.roughness = 0.22
  } else {
    // 衰败:中
    material.metalness = 0.5
    material.roughness = 0.35
  }
  // 物理材质(hydro 等)的清漆高光:已掌握时把"抛光"做实
  if ('clearcoat' in material) {
    if (s > 0.75) { material.clearcoat = 0.5; material.clearcoatRoughness = 0.22 }
    else material.clearcoat = 0
  }
}

// 给定一个 mesh / group,遍历所有 MeshStandardMaterial 应用状态
function applyStateRecursive(root, state) {
  root.traverse((o) => {
    if (o.isMesh && o.material && 'metalness' in o.material) {
      applyStateStyle(o.material, state)
    }
  })
}

export class WordSculpture {
  constructor(word, state, position, { envMap } = {}) {
    this.word = word
    this.root = word.root
    this._state = state
    this.envMap = envMap
    this.selected = false
    this.hovered = false
    this.pulseUntil = 0

    this.group = new THREE.Group()
    this.group.position.set(position[0], position[1], position[2])
    this._baseY = position[1] // 归位基准(每颗词的悬停高度不同,hover 上浮后要回到自己那层)
    this.group.userData.wordId = word.id

    const color = colorForRoot(word.root)
    this.mesh = new THREE.Mesh(
      makeBirdGeometry(color),
      new THREE.MeshStandardMaterial({
        color: 0xffffff, vertexColors: true, // 各部件颜色走顶点色(身体=家族色/喙=灯芯暖)
        // envMap 反射从 0.9 收到 0.42:全库词鸟同时映环境,是整片晃眼的主源
        metalness: 0.7, roughness: 0.3, envMap, envMapIntensity: 0.42,
      }),
    )
    this.mesh.scale.setScalar(BASE_SCALE)
    this._s = 1 // hover/selected 相对缩放,匀速趋近
    // 每只鸟一个确定性朝向:整群不朝一个方向,像真的栖在星群里的鸟
    this.mesh.rotation.y = hash(word.id * 31 + 5) * Math.PI * 2

    // 记录材质基准值:聚簇渐隐按基准 × fade 走,不再把 per-材质 envMapIntensity 冲掉
    this.mesh.traverse((o) => {
      if (o.isMesh && o.material) {
        if ('envMapIntensity' in o.material && o.material._baseEnvI == null) o.material._baseEnvI = o.material.envMapIntensity
        if ('opacity' in o.material && o.material._baseOpacity == null) o.material._baseOpacity = o.material.opacity
      }
    })

    // mesh 可能有 .userData.wordId(单 mesh);group 是 built 时给 group 加
    if (this.mesh.userData) this.mesh.userData.wordId = word.id
    this.group.add(this.mesh)
    // 大气注入:Fresnel rim + 极轻 hash 噪波扰 roughness(月长石质感)
    // 不同根家族给不同 rim 强度——身份仍靠家族色差,shader 只做光增强。
    // rim 色取夜色基(与鸟体同源压暗):亮银族色直接上 rim 会让全库词鸟
    // 各带一圈亮光环,是"整群晃眼"的隐藏主源(用户:太亮)
    this.mesh.traverse((o) => {
      if (o.isMesh && o.material && 'metalness' in o.material && !o.material._atm) {
        const c = nightBase(color).multiplyScalar(0.6)
        const params = perRootAtmosphereParams(word.root)
        injectAtmosphere(o.material, { color: c.getHex(), power: params.power, strength: params.strength, noiseAmp: params.noise })
      }
    })
    // 扇翅注入放在 atmosphere 之后:applyFlap 会包住已有钩子链式共存
    // (基准频率按 word.id 微差,挂到 update 里喂时间)

    // 应用初始状态
    this._stateClass = this._classify(state)
    applyStateRecursive(this.group, state)

    // 选中视觉组(双圈倾斜环 + 底部光柱) — 仅 selected 时挂载
    this.selectGroup = null

    // 自转:每只鸟按 word.id 决定性微差(缓慢换向张望,不翻滚)
    const sp = (word.id * 1103515245 + 12345) % 1000
    this.spinSpeedY = 0.0011 + (sp % 17) * 0.00005
    this.spinSpeedX = 0 // 鸟不绕横轴滚
    this._flapVar = (sp % 13) * 0.09
    this._flapU = applyFlap(this.mesh.material, { speed: 4.1 + this._flapVar })
    // 不做上下浮动:悬停的星不"振动",位置稳定由外层布局给(族高度带 + y 向散布)
  }

  _classify(state) {
    if (!state || state.is_new) return 'new'
    const s = state.strength ?? 0
    if (state.due && s < 0.45) return 'critical'
    if (state.due) return 'due'
    if (s > 0.75) return 'mastered'
    if (s > 0.45) return 'learning'
    return 'fading'
  }

  applyState(state) {
    this._state = state
    this._stateClass = this._classify(state)
    applyStateRecursive(this.group, state)
  }

  // 降级路径:卸掉 rim 强度(变成 0,渲染时不再触发 fragment 变化)
  applyDowngrade() {
    this.mesh.traverse((o) => {
      if (o.isMesh && o.material?.userData?.atmUniforms) {
        const u = o.material.userData.atmUniforms
        u.uAtmStrength.value = 0
        u.uNoiseAmp.value = 0
      }
    })
  }

  setSelected(sel) {
    this.selected = sel
    if (sel && !this.selectGroup) this._buildSelectGroup()
    if (!sel && this.selectGroup) {
      this.group.remove(this.selectGroup)
      this.selectGroup.traverse((o) => {
        o.geometry?.dispose()
        o.material?.dispose()
      })
      this.selectGroup = null
    }
  }

  setHovered(v) { this.hovered = v }

  // 「只看已点亮」:未学的雕塑整体压到近隐。
  // 走材质 _baseOpacity —— 聚簇每帧算 opacity = _baseOpacity × fade,设完即被自然消费
  setLearnDim(v) {
    v = !!v
    if (this._learnDim === v) return
    this._learnDim = v
    this.mesh.traverse((o) => {
      if (!o.isMesh || !o.material) return
      const mats = Array.isArray(o.material) ? o.material : [o.material]
      for (const m of mats) {
        if (!('opacity' in m)) continue
        if (m._dimFull == null) m._dimFull = m._baseOpacity ?? m.opacity ?? 1
        m._baseOpacity = v ? 0.14 : m._dimFull
        m.transparent = true
      }
    })
  }

  pulse() { this.pulseUntil = performance.now() + 1200 }

  _buildSelectGroup() {
    const accent = readThemeColors().accent.getHex()
    const g = new THREE.Group()
    // 双圈:水平白 + 60° 倾斜品牌青,细到只剩"仪器感"
    const r1 = new THREE.Mesh(
      new THREE.TorusGeometry(1.4, 0.015, 8, 64),
      new THREE.MeshBasicMaterial({ color: 0xe8eef4, transparent: true, opacity: 0.85 }),
    )
    r1.rotation.x = Math.PI / 2
    g.add(r1)
    const r2 = new THREE.Mesh(
      new THREE.TorusGeometry(1.65, 0.012, 8, 64),
      new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.55 }),
    )
    r2.rotation.x = Math.PI / 3
    r2.rotation.z = Math.PI / 6
    g.add(r2)
    // 底部光柱(细窄,朝下,品牌色)
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.02, 0.3, 5, 16, 1, true),
      new THREE.MeshBasicMaterial({
        color: accent, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false,
      }),
    )
    beam.position.y = -2.5
    g.add(beam)
    for (const m of [r1.material, r2.material, beam.material]) m._baseOpacity = m.opacity
    this.group.add(g)
    this.selectGroup = g
  }

  update(t) {
    // 选中时 ring 慢转 + beam 呼吸
    if (this.selectGroup) {
      this.selectGroup.rotation.y = t * 0.6
      const beam = this.selectGroup.children[2]
      if (beam) beam.material.opacity = 0.12 + 0.06 * Math.sin(t * 2.2)
    }
    // 本体慢自转(换向张望);位置稳定,不再上下浮动
    this.mesh.rotation.y += this.spinSpeedY
    this.mesh.rotation.x += this.spinSpeedX
    // 扇翅:悬停/选中时扇得更快更猛(被点中的鸟激动),平时轻扑
    if (this._flapU) {
      const hot = this.hovered || this.selected
      this._flapU.uFlapTime.value = t
      this._flapU.uFlapAmp.value += ((hot ? 0.52 : 0.26) - this._flapU.uFlapAmp.value) * 0.12
      this._flapU.uFlapSpeed.value += ((hot ? 7.5 : 4.1 + this._flapVar) - this._flapU.uFlapSpeed.value) * 0.1
    }
    // hover/selected:上浮 + 轻放大(回到自己的基准高度,不是 0)
    if (this.hovered || this.selected) {
      const targetY = this._baseY + (this.selected ? 0.35 : 0.18)
      this.group.position.y += (targetY - this.group.position.y) * 0.08
    } else if (this.group.position.y !== this._baseY) {
      this.group.position.y += (this._baseY - this.group.position.y) * 0.08
    }
    const sTarget = this.selected ? 1.12 : this.hovered ? 1.05 : 1
    this._s += (sTarget - this._s) * 0.1
    this.mesh.scale.setScalar(BASE_SCALE * this._s)
  }

  dispose() {
    this.mesh.traverse((o) => {
      if (o.isMesh) {
        // 鸟几何按家族色共享(bird.js 缓存),清场时不能释放
        if (!o.geometry?.userData?.shared) o.geometry?.dispose()
        if (o.material) {
          if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose())
          else o.material.dispose()
        }
      }
    })
    if (this.selectGroup) {
      this.selectGroup.traverse((o) => {
        o.geometry?.dispose(); o.material?.dispose()
      })
    }
  }
}

// 兼容旧引用(老代码还在用 WordPlanet)
export const WordPlanet = WordSculpture
