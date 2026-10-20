// FlightPath — 圣殿航路:滚动 = 航行
// 预烘焙相机航路(位置曲线 + 注视曲线,弧长参数化保匀速),
// 滚动累积目标进度、显示进度带惯性追赶 —— 与开场运镜终点闭环,一镜到底。
import * as THREE from 'three'

// 航路关键帧:[相机位置, 注视点](场景坐标:三环 31/21.5/12.5,纪念碑在心,地板 -1.2)
// 走向:全览 → 切入外环 → 逆时针巡游 → 视线扫回中心 → 低角英雄位仰视晶体 → 拔升俯瞰 → 终幕星图位
const STOPS = [
  [[0, 13.5, 50], [0, 1, 0]],        // 全览(= 开场运镜终点,运镜落地即上航路)
  [[34, 5.5, 14], [14, 2, -20]],     // 切入外环星域
  [[18, 4.2, -34], [-14, 2.4, -12]], // 巡外环
  [[-30, 6.5, -12], [-6, 2.6, 14]],  // 外环另一侧,视线扫回中心
  [[-16, 4, 16], [0, 3.4, 0]],       // 收进中场,望向词峰之心
  [[0, 2, 10.5], [0, 3.2, 0]],       // 低角度英雄位:仰视晶体,光池在前
  [[0, 15, 18], [0, 2, 0]],          // 沿光帘拔升,俯瞰圣坛
  [[0, 31, 15], [0, 0.5, 0]],        // 终幕星图位:足够高,整片星海摊成一张星图
]

// 章节边界(按进度):HUD 章节字幕 + 右侧航路刻度点的依据
export const CHAPTERS = [
  { from: 0, label: '第一幕 · 启程' },
  { from: 0.14, label: '第二幕 · 巡游星域' },
  { from: 0.55, label: '第三幕 · 词峰之心' },
  { from: 0.85, label: '第四幕 · 回望' },
  { from: 0.9, label: '第五幕 · 我的星座' },
]

export function chapterAt(p) {
  let idx = 0
  for (let i = 0; i < CHAPTERS.length; i++) if (p >= CHAPTERS[i].from) idx = i
  return idx
}

const V = (a) => new THREE.Vector3(a[0], a[1], a[2])

export class FlightPath {
  constructor() {
    this.posCurve = new THREE.CatmullRomCurve3(STOPS.map((s) => V(s[0])), false, 'centripetal', 0.5)
    this.lookCurve = new THREE.CatmullRomCurve3(STOPS.map((s) => V(s[1])), false, 'centripetal', 0.5)
    this._pos = new THREE.Vector3()
    this._look = new THREE.Vector3()
  }

  // 弧长参数采样:滚动格数 → 世界距离恒定,不会有的段快有的段慢
  sample(p, outPos, outLook) {
    const u = Math.min(1, Math.max(0, p))
    this.posCurve.getPointAt(u, outPos || this._pos)
    this.lookCurve.getPointAt(u, outLook || this._look)
    return p
  }

  // 从任意位置回航:采样 64 点找最近航路点(自由漫游 → 继续航行的接入位)
  nearestProgress(pos) {
    let best = 0, bestD = Infinity
    const v = new THREE.Vector3()
    for (let i = 0; i <= 64; i++) {
      this.posCurve.getPointAt(i / 64, v)
      const d = v.distanceToSquared(pos)
      if (d < bestD) { bestD = d; best = i / 64 }
    }
    return best
  }
}

// 航行控制:目标进度(滚动累积) + 显示进度(惯性 lerp 追赶)
// 引擎每帧 update() 取 {p, speed},speed 供星流加速(航行感)
export class FlightController {
  constructor() {
    this.path = new FlightPath()
    this.target = 0
    this.p = 0
    this.speed = 0
    this.engaged = false
  }

  // 滚轮一格(deltaY≈100)约推进 4% 航程;触控板小步平滑积累
  scroll(deltaY) {
    if (!this.engaged) return
    this.target = Math.min(1, Math.max(0, this.target + deltaY * 0.00042))
  }

  update(dt) {
    const prev = this.p
    this.p += (this.target - this.p) * Math.min(1, dt * 3)
    this.speed = dt > 0 ? Math.abs(this.p - prev) / dt : 0
  }
}
