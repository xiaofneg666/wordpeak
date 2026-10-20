// Sculpture — 词根家族 → 雕塑形态 + 材质配方
// 关键决定:不同词根 = 不同几何(不是换颜色),状态 = 材质属性变化(不是发不发光)
import * as THREE from 'three'

// 工厂共用附件色(整厅一套"钢与月长石"语汇,不出现随机暖色)
const STEEL = 0x5c6470   // 深钢:栓/环/轴
const GRAPHITE = 0x2e333c // 石墨:哑光配重
const BRIGHT = 0xd6dbe1  // 亮银:抛光附件
const LAMP = 0xf2ead8    // 暖光:唯一的暖点,像展厅射灯落在雕塑上
export { LAMP } // 展厅的灯芯色(纪念碑顶灯共用)

// 工厂:返回一个函数 (envMap, opts) => { group, mesh, material, ... }
const _SCULPTURES = {
  // 锐利多面体:spike + 反光金属(冷蓝白)
  spect: ({ envMap, color }) => {
    const mesh = new THREE.Mesh(
      new THREE.IcosahedronGeometry(1, 0), // 锐利
      new THREE.MeshStandardMaterial({
        color, metalness: 0.85, roughness: 0.22, envMap, envMapIntensity: 1.1,
      }),
    )
    return { mesh }
  },
  // 拉丝金属 + 表面挖槽感(实际用 noise 改 roughness 太重,改用 BoxGeometry 组合做出"端口"感)
  port: ({ envMap, color }) => {
    const g = new THREE.Group()
    // 主体:圆角方块
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(1.6, 1.4, 1.4, 4, 3, 3),
      new THREE.MeshStandardMaterial({
        color, metalness: 0.75, roughness: 0.35, envMap, envMapIntensity: 0.95,
      }),
    )
    g.add(body)
    // 4 个角栓
    for (const dx of [-1, 1]) for (const dy of [-1, 1]) {
      const stud = new THREE.Mesh(
        new THREE.CylinderGeometry(0.12, 0.12, 0.15, 12),
        new THREE.MeshStandardMaterial({
          color: STEEL, metalness: 1.0, roughness: 0.25, envMap, envMapIntensity: 1.0,
        }),
      )
      stud.position.set(dx * 0.78, dy * 0.68, 0.7)
      g.add(stud)
    }
    return { mesh: g, multi: true }
  },
  // 哑光陶俑:多面体 + 米白
  dict: ({ envMap, color }) => {
    const mesh = new THREE.Mesh(
      new THREE.DodecahedronGeometry(0.95, 0),
      new THREE.MeshStandardMaterial({
        color, metalness: 0.05, roughness: 0.7, envMap, envMapIntensity: 0.55,
      }),
    )
    return { mesh }
  },
  // 镜面抛光钛(锥体 + 中心轴)
  duct: ({ envMap, color }) => {
    const g = new THREE.Group()
    // 主体:垂直锥
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(0.6, 1.6, 24, 1),
      new THREE.MeshStandardMaterial({
        color, metalness: 1.0, roughness: 0.05, envMap, envMapIntensity: 1.4,
      }),
    )
    g.add(cone)
    // 中心轴细线
    const axis = new THREE.Mesh(
      new THREE.CylinderGeometry(0.04, 0.04, 2.2, 8),
      new THREE.MeshStandardMaterial({
        color: BRIGHT, metalness: 1.0, roughness: 0.05, envMap, envMapIntensity: 1.3,
      }),
    )
    g.add(axis)
    return { mesh: g, multi: true }
  },
  // 八面体亮红釉面 + 周围 6 颗小粒子
  mit: ({ envMap, color }) => {
    const g = new THREE.Group()
    const core = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.85, 0),
      new THREE.MeshStandardMaterial({
        color, metalness: 0.45, roughness: 0.18, envMap, envMapIntensity: 1.15,
      }),
    )
    g.add(core)
    // 6 颗小卫星
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2
      const sat = new THREE.Mesh(
        new THREE.SphereGeometry(0.08, 12, 12),
        new THREE.MeshStandardMaterial({
          color: BRIGHT, metalness: 0.85, roughness: 0.2, envMap, envMapIntensity: 1.0,
        }),
      )
      sat.position.set(Math.cos(a) * 1.4, 0, Math.sin(a) * 1.4)
      g.add(sat)
    }
    return { mesh: g, multi: true }
  },
  // 棱角八面体(弹头感),银灰
  ject: ({ envMap, color }) => {
    const mesh = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.9, 0),
      new THREE.MeshStandardMaterial({
        color, metalness: 0.95, roughness: 0.12, envMap, envMapIntensity: 1.2,
      }),
    )
    return { mesh }
  },
  // 立方体叠加(钢结构):三个 box 偏移叠加
  struct: ({ envMap, color }) => {
    const g = new THREE.Group()
    const m = new THREE.MeshStandardMaterial({
      color, metalness: 0.85, roughness: 0.4, envMap, envMapIntensity: 0.95,
    })
    const a = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.5, 1.4), m); a.position.y = 0
    const b = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.6, 1.0), m); b.position.set(0.1, 0.55, -0.05); b.rotation.y = 0.18
    const c = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.7, 0.6), m); c.position.set(-0.1, 1.2, 0.08); c.rotation.y = -0.22
    g.add(a, b, c)
    return { mesh: g, multi: true }
  },
  // 球体 + 经纬沟槽(陀螺):CustomGeometry 较重,用 torus 环做
  vert: ({ envMap, color }) => {
    const g = new THREE.Group()
    const core = new THREE.Mesh(
      new THREE.SphereGeometry(0.7, 32, 24),
      new THREE.MeshStandardMaterial({
        color, metalness: 0.8, roughness: 0.18, envMap, envMapIntensity: 1.2,
      }),
    )
    g.add(core)
    // 3 条互相垂直的细环
    for (let i = 0; i < 3; i++) {
      const t = new THREE.Mesh(
        new THREE.TorusGeometry(0.88, 0.025, 8, 64),
        new THREE.MeshStandardMaterial({
          color: STEEL, metalness: 0.9, roughness: 0.2, envMap, envMapIntensity: 1.0,
        }),
      )
      if (i === 1) t.rotation.x = Math.PI / 2
      if (i === 2) t.rotation.x = Math.PI / 4
      if (i === 2) t.rotation.z = Math.PI / 4
      g.add(t)
    }
    return { mesh: g, multi: true }
  },
  // 透明水球:transmission
  hydro: ({ envMap, color }) => {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.9, 48, 36),
      new THREE.MeshPhysicalMaterial({
        color, metalness: 0, roughness: 0.05,
        transmission: 0.92, ior: 1.33, thickness: 0.5,
        envMap, envMapIntensity: 1.2,
      }),
    )
    return { mesh, physical: true }
  },
  // 球体 + 表面"脉络":用 noise 改 normal 太重,改用 IcosahedronGeometry 高细分 + 多面体
  bio: ({ envMap, color }) => {
    const mesh = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.85, 1), // 细分一次,面更密像脉络
      new THREE.MeshStandardMaterial({
        color, metalness: 0.2, roughness: 0.5, envMap, envMapIntensity: 0.85,
      }),
    )
    return { mesh }
  },
  // 球体 + 环绕波纹(喇叭)
  phon: ({ envMap, color }) => {
    const g = new THREE.Group()
    const core = new THREE.Mesh(
      new THREE.SphereGeometry(0.55, 32, 24),
      new THREE.MeshStandardMaterial({
        color, metalness: 0.3, roughness: 0.4, envMap, envMapIntensity: 0.8,
      }),
    )
    g.add(core)
    // 3 道环,逐渐变大
    for (let i = 0; i < 3; i++) {
      const r = 0.85 + i * 0.32
      const t = new THREE.Mesh(
        new THREE.TorusGeometry(r, 0.022, 8, 64),
        new THREE.MeshStandardMaterial({
          color: STEEL, metalness: 0.75, roughness: 0.25, envMap, envMapIntensity: 0.9,
        }),
      )
      if (i % 2 === 1) t.rotation.x = Math.PI / 2
      g.add(t)
    }
    return { mesh: g, multi: true }
  },
  // 留声机:拉丝黑 + 中心小亮
  aud: ({ envMap, color }) => {
    const g = new THREE.Group()
    const body = new THREE.Mesh(
      new THREE.SphereGeometry(0.85, 32, 24),
      new THREE.MeshStandardMaterial({
        color, metalness: 0.6, roughness: 0.45, envMap, envMapIntensity: 0.7,
      }),
    )
    g.add(body)
    // 中心小亮(留声机喇叭口)
    const mouth = new THREE.Mesh(
      new THREE.CylinderGeometry(0.32, 0.45, 0.25, 24, 1, true),
      new THREE.MeshStandardMaterial({
        color: BRIGHT, metalness: 0.95, roughness: 0.08, envMap, envMapIntensity: 1.3,
        side: THREE.DoubleSide,
      }),
    )
    mouth.position.set(0, 0, 0.78)
    mouth.rotation.x = Math.PI / 2
    g.add(mouth)
    return { mesh: g, multi: true }
  },
  // 金属星:8 角多面
  ast: ({ envMap, color }) => {
    const mesh = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.95, 0),
      new THREE.MeshStandardMaterial({
        color, metalness: 0.9, roughness: 0.2, envMap, envMapIntensity: 1.15,
      }),
    )
    return { mesh }
  },
  // 黑粉笔/铅:粗糙低 metalness
  graph: ({ envMap, color }) => {
    const mesh = new THREE.Mesh(
      new THREE.DodecahedronGeometry(0.9, 0),
      new THREE.MeshStandardMaterial({
        color, metalness: 0.1, roughness: 0.85, envMap, envMapIntensity: 0.5,
      }),
    )
    return { mesh }
  },
  // 古铜杯
  vok: ({ envMap, color }) => {
    const mesh = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.9, 0),
      new THREE.MeshStandardMaterial({
        color, metalness: 0.85, roughness: 0.32, envMap, envMapIntensity: 1.0,
      }),
    )
    return { mesh }
  },
  // ton-/tele-/tech- 之类(以 tele 为代表):多面体 + 中心小亮球
  tele: ({ envMap, color }) => {
    const g = new THREE.Group()
    const body = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.85, 0),
      new THREE.MeshStandardMaterial({
        color, metalness: 0.7, roughness: 0.25, envMap, envMapIntensity: 1.0,
      }),
    )
    g.add(body)
    const center = new THREE.Mesh(
      new THREE.SphereGeometry(0.2, 24, 16),
      new THREE.MeshStandardMaterial({
        color: LAMP, metalness: 0.0, roughness: 0.3,
        emissive: LAMP, emissiveIntensity: 1.2, envMap, envMapIntensity: 0.5,
      }),
    )
    g.add(center)
    return { mesh: g, multi: true }
  },
  // 默认:多面体 + 中等金属
  _default: ({ envMap, color }) => {
    const mesh = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.85, 0),
      new THREE.MeshStandardMaterial({
        color, metalness: 0.7, roughness: 0.3, envMap, envMapIntensity: 0.9,
      }),
    )
    return { mesh }
  },
}

// 词根 → 雕塑工厂
export function getSculptureFactory(root) {
  const key = (root || '').toLowerCase().replace(/[^a-z]/g, '')
  return _SCULPTURES[key] || _SCULPTURES._default
}

// 家族色:冷调银灰谱系(Lusion/Igloo 式单色纪律)
// 全厅同属"钢与月长石"一个色族:206~240° 蓝带,低饱和,亮银带;差别在明度不在色相
// 词根身份靠几何形态区分,色相只做极轻的"温差";家族标签取同色作 accent,整厅统一
function _hashString(str) {
  let n = 2166136261
  for (let i = 0; i < str.length; i++) { n ^= str.charCodeAt(i); n = Math.imul(n, 16777619) }
  return (n >>> 0) / 4294967295
}
export function colorForRoot(root) {
  const k = (root || '').toLowerCase().replace(/[^a-z]/g, '') || 'x'
  const h = _hashString(k)
  const hue = (206 + h * 34) / 360          // 206~240°:钢蓝 → 冰蓝
  const sat = 0.05 + ((h * 97) % 1) * 0.09  // 5~14%:低饱和
  const lig = 0.66 + ((h * 13) % 1) * 0.13  // 66~79%:亮银带
  return new THREE.Color().setHSL(hue, sat, lig).getHex()
}
