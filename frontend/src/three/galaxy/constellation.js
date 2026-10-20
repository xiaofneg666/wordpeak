// MyConstellation — 终幕「我的星座」
// 航路尽头,属于当前用户的已学词星之间浮现金色星链,连成一幅
// 只属于这个学习档案的星座(点的集合=states 里非 is_new 的词,谁来看都不一样)。
// 绘制:段终点从起点逐条伸出(stagger),画完后整体呼吸 —— 和开场家族星座同一套语言。
import * as THREE from 'three'

// 全宇宙唯一的暖:词峰之心塔尖灯同一色相,「你的光」和圣殿的心同源
const GOLD = 0xf2ead8
// 词悬在空间里,星链直接用每颗星自己的高度 —— 不再压平到一个平面

export class MyConstellation {
  constructor(scene) {
    this.scene = scene
    this.group = null
    this._segs = []
    this._t0 = 0
    this.count = 0
  }

  // points: [{x, y, z}](已学词的世界坐标)。返回链上的星数。
  // 布链:按绕心方位角排序 → 首尾相连,形成环绕整片星海的星链;
  // 顶点过多抽稀(≤60 段),链才读得清,不会糊成一圈。
  build(points) {
    this.dispose()
    this.count = points.length
    if (points.length < 3) return 0
    const byAngle = [...points].sort((a, b) => Math.atan2(a.z, a.x) - Math.atan2(b.z, b.x))
    const step = Math.max(1, Math.ceil(byAngle.length / 60))
    const chain = byAngle.filter((_, i) => i % step === 0)
    if (chain.length < 3) return 0
    this._segs = []
    for (let i = 0; i < chain.length; i++) {
      const a = chain[i]
      const b = chain[(i + 1) % chain.length]
      this._segs.push([a, b])
    }
    // 初始:每段都缩在起点上,update 里逐条伸出
    const pos = new Float32Array(this._segs.length * 6)
    for (let i = 0; i < this._segs.length; i++) {
      const [a] = this._segs[i]
      pos[i * 6] = a.x; pos[i * 6 + 1] = a.y ?? 0; pos[i * 6 + 2] = a.z
      pos[i * 6 + 3] = a.x; pos[i * 6 + 4] = a.y ?? 0; pos[i * 6 + 5] = a.z
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    this.material = new THREE.LineBasicMaterial({
      color: GOLD, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false,
    })
    this.group = new THREE.LineSegments(geo, this.material)
    this._t0 = performance.now()
    this.scene.add(this.group)
    return chain.length
  }

  update(now) {
    if (!this.group) return
    const el = now - this._t0
    const per = 650, stag = 70
    const attr = this.group.geometry.attributes.position
    for (let i = 0; i < this._segs.length; i++) {
      const p = Math.min(1, Math.max(0, (el - i * stag) / per))
      const e = 1 - Math.pow(1 - p, 3)
      const [a, b] = this._segs[i]
      const j = i * 6
      attr.array[j + 3] = a.x + (b.x - a.x) * e
      attr.array[j + 4] = (a.y ?? 0) + ((b.y ?? 0) - (a.y ?? 0)) * e
      attr.array[j + 5] = a.z + (b.z - a.z) * e
    }
    attr.needsUpdate = true
    // 亮度:画完前随绘制进度升,画完后极缓呼吸(星座是活的,不是一张图)
    const total = (this._segs.length - 1) * stag + per
    const grow = Math.min(1, el / (total + 400))
    this.material.opacity = (0.36 + 0.06 * Math.sin(now * 0.0012)) * grow
  }

  dispose() {
    if (!this.group) return
    this.scene.remove(this.group)
    this.group.geometry.dispose()
    this.material.dispose()
    this.group = null
    this._segs = []
  }
}
