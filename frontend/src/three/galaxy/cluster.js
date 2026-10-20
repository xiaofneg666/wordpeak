// FamilyCluster — 一族词 = 星海里的一个立体星群
// 布展:三环槽位(大族外环/中族中环/小族内环,槽位由引擎按词数排好),
// 每族一个确定性"高度带"(不再有基座/轨道环,词悬在空间里),族内词按黄金角
// 向日葵散布 + y 向铺开,整片星域从"地面摊开"变成有厚度的星群。
// 保留 CSS2D 词根标签 + 标签高亮 + 家族锁定渐隐。
import * as THREE from 'three'
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js'
import { WordSculpture, hash } from './planet.js'
import { colorForRoot } from './sculpture.js'

// 三环半径;每环容量按 idx 分段(引擎按词数降序给 idx:大族 idx 小 → 外环)
const RING_OUT = { r: 31 }
const RING_MID = { r: 21.5 }
const RING_IN = { r: 12.5 }
const GOLDEN = 2.39996 // 黄金角(弧度)

// 家族槽位:外环 45% / 中环 35% / 内环 20%,环间错开半格避免径向对齐
function familySlot(idx, total) {
  const nOut = Math.max(1, Math.round(total * 0.45))
  const nMid = Math.max(1, Math.round(total * 0.35))
  const nIn = Math.max(1, total - nOut - nMid)
  if (idx < nOut) {
    const a = (idx / nOut) * Math.PI * 2
    return [Math.cos(a) * RING_OUT.r, Math.sin(a) * RING_OUT.r, nOut, RING_OUT.r]
  }
  if (idx < nOut + nMid) {
    const i = idx - nOut
    const a = (i / nMid) * Math.PI * 2 + Math.PI / nMid
    return [Math.cos(a) * RING_MID.r, Math.sin(a) * RING_MID.r, nMid, RING_MID.r]
  }
  const i = idx - nOut - nMid
  const a = (i / nIn) * Math.PI * 2 + Math.PI / nIn
  return [Math.cos(a) * RING_IN.r, Math.sin(a) * RING_IN.r, nIn, RING_IN.r]
}

export class FamilyCluster {
  constructor(family, states, hooks = {}) {
    this.family = family
    this.hooks = hooks
    this.fade = 1
    this.fadeTarget = 1
    this.color = colorForRoot(family.root)

    this.group = new THREE.Group()
    this.group.userData.appearAt = performance.now() + family.idx * 55
    this.group.userData.appearDur = 700

    // 入场动画初值
    this.group.scale.setScalar(0.01)

    // ---- 展位:槽位 ----
    const total = family.total || 40
    const [sx, sz, ringN, ringR] = familySlot(family.idx, total)
    this.slot = [sx, sz]
    const n = family.words.length
    // 星图半径:词数决定,但不能挤到隔壁族的星图
    const spacing = (Math.PI * 2 * ringR) / ringN
    const rr = Math.min(1.1 * Math.sqrt(Math.max(1, n - 1)) + 1.3, spacing / 2 - 0.15)
    this.discR = rr

    // 高度带:每族一个确定性中心高度,40 族不在同一层平面上 —— 星群有厚度,3D 才立得起来
    const cy = (hash(family.idx * 101 + 37) - 0.5) * 5
    this.centerY = cy

    // ---- CSS2D 词根标签(每族一个,挂在展位上方) ----
    const labelEl = document.createElement('div')
    labelEl.className = 'family-label'
    labelEl.style.setProperty('--label-accent', '#' + this.color.toString(16).padStart(6, '0'))
    labelEl.innerHTML =
      `<span class="fam-root">${(family.root || '').toUpperCase()}-</span>` +
      `<span class="fam-meaning">${family.meaning || ''}</span>` +
      `<span class="fam-count">${family.words.length} 词</span>`
    this.label = new CSS2DObject(labelEl)
    this.label.position.set(sx, cy + 2.8, sz)
    this.group.add(this.label)
    this._labelTimer = null
    labelEl.addEventListener('click', (e) => {
      e.stopPropagation()
      if (this._labelTimer) {
        clearTimeout(this._labelTimer)
        this._labelTimer = null
        this.hooks.onLock?.(family.root)
        return
      }
      this._labelTimer = setTimeout(() => {
        this._labelTimer = null
        window.dispatchEvent(new CustomEvent('wv:openFamily', { detail: family.root }))
      }, 260)
    })

    // ---- 雕塑:黄金角向日葵散布 + y 向铺开,一族是一团有厚度的星群 ----
    // 节距按轨道半径反推,保证族内词都落在星图里
    const c = n > 1 ? Math.max(0.55, (rr - 1.15) / Math.sqrt(n - 1)) : 0
    this.planets = new Map()
    const pts = [] // 记录词坐标(含 y),给星座连线用
    family.words.forEach((w, i) => {
      const a = i * GOLDEN
      const r = i === 0 ? 0 : c * Math.sqrt(i)
      let x = sx + Math.cos(a) * r
      let z = sz + Math.sin(a) * r
      // 三向轻噪声避免机械感(hash 确定性,不闪跳);
      // y 向铺开 ±3 —— 词不再贴一个平面,俯仰视角都有纵深
      x += (hash(w.id * 13 + 1) - 0.5) * 0.55
      z += (hash(w.id * 29 + 7) - 0.5) * 0.55
      const y = cy + (hash(w.id * 7 + 13) - 0.5) * 6
      pts.push([x, y, z])
      const sc = new WordSculpture(w, states ? states[w.id] : undefined, [x, y, z], { envMap: family._envMap })
      this.planets.set(w.id, sc)
      this.group.add(sc.group)
    })

    // ---- 星座连线:族中心向每颗词的细线,hover/锁定这一族时亮起 ----
    const lpos = []
    for (const [x, y, z] of pts) {
      lpos.push(sx, cy, sz, x, y, z)
    }
    const lgeo = new THREE.BufferGeometry()
    lgeo.setAttribute('position', new THREE.Float32BufferAttribute(lpos, 3))
    this.lines = new THREE.LineSegments(lgeo, new THREE.LineBasicMaterial({
      color: this.color, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }))
    this.group.add(this.lines)
    // 星座绘制素材:族心 + 每颗词的落点(开场"当面绘制"时逐条伸出)
    this._linePts = pts
    this._lineCX = sx
    this._lineCY = cy
    this._lineCZ = sz
    this._draw = null
    this._lineBoost = 0
    this._lineGlow = 0
    this._locked = false
    this._sweepGlow = 0
    this._sweepTarget = 0
  }

  // 开场星座"当面绘制":拉出运镜期间,这一族的星座连线逐条从族心长出去
  // (段终点从族心向词位插值,easeOutCubic;画完自动交回静态坐标)
  beginConstellationDraw(per = 780, stagger = 95) {
    if (!this.lines || !this._linePts?.length) return
    this._draw = { t0: performance.now(), per, stagger }
    this._lineBoost = this._draw.t0 + this._linePts.length * stagger + per + 900
  }

  // 航线扫过:值 0~1,这一族的星图(连线/刻线环/标签)被点亮 —— 像航行中被逐个点读
  setSweep(v) { this._sweepTarget = v || 0 }

  get meshes() {
    const out = []
    for (const p of this.planets.values()) {
      p.group.traverse((o) => { if (o.isMesh) out.push(o) })
    }
    return out
  }

  updateStates(states) {
    for (const [id, p] of this.planets) p.applyState(states ? states[id] : undefined)
  }

  setSelected(id) {
    for (const [pid, p] of this.planets) p.setSelected(pid === id)
  }

  setHovered(id) {
    let anyHit = false
    for (const [pid, p] of this.planets) {
      const hit = pid === id
      p.setHovered(hit)
      if (hit) anyHit = true
    }
    this._hoverLabel = anyHit
    if (this.label?.element) this.label.element.classList.toggle('highlighted', anyHit)
  }

  setFamilyLock(active) {
    this._locked = active
    this.fadeTarget = active ? 1 : 0.05
  }

  applyTheme() {
    // 主题变了家族颜色不变(展厅用固定"钢与月长石"谱系)
  }

  // 每帧:渐隐 + 入场 + 标签距离退隐 + 雕塑自身动画
  update(t, dt, camPos) {
    const now = performance.now()
    if (now < this.group.userData.appearAt) {
      this.group.scale.setScalar(0.01); this.group.visible = false; return
    } else if (this.group.scale.x < 1) {
      this.group.visible = true
      const p = Math.min((now - this.group.userData.appearAt) / this.group.userData.appearDur, 1)
      const e = 1 - Math.pow(1 - p, 3)
      this.group.scale.setScalar(0.01 + e * 0.99)
    }
    this.fade += (this.fadeTarget - this.fade) * Math.min(1, dt * 4)
    if (Math.abs(this.fade - this.fadeTarget) < 0.002) this.fade = this.fadeTarget
    // 渐隐:整个族 group 透明化(基座/刻线也一起),envMapIntensity 同步降,显得"退到后台"
    this.group.traverse((o) => {
      if (o.isMesh && o.material && 'opacity' in o.material) {
        o.material.opacity = (o.material._baseOpacity ?? 1) * this.fade
        o.material.transparent = true
        if ('envMapIntensity' in o.material) o.material.envMapIntensity = (o.material._baseEnvI ?? 1) * this.fade
      }
    })
    // 标签距离退隐:只亮"面前一弧"的展位,远处压到近隐形 ——
    // 40 个标签不同时喊话,视线才能落在雕塑上(hover 到词时强制亮)
    let labelAlpha = this.fade
    if (camPos) {
      const dx = this.slot[0] - camPos.x
      const dz = this.slot[1] - camPos.z
      const d = Math.sqrt(dx * dx + dz * dz)
      const k = Math.min(1, Math.max(0, (48 - d) / 24))
      labelAlpha = this.fade * (0.05 + 0.95 * k)
    }
    if (this._hoverLabel) labelAlpha = this.fade
    // 航线扫过:标签随星图浮现,不受距离退隐压制
    this._sweepGlow += (this._sweepTarget - this._sweepGlow) * Math.min(1, dt * 5)
    labelAlpha = Math.max(labelAlpha, this.fade * this._sweepGlow)
    if (this.label?.element) this.label.element.style.opacity = String(labelAlpha)
    this.label.visible = labelAlpha > 0.15

    // 星座连线:hover 到词 / 家族锁定 / 航线扫过时浮现,像星图被点读;
    // 绘制期(_lineBoost)保持高亮,当着用户画完才慢慢收
    if (this.lines) {
      let target = (this._hoverLabel || this._locked) ? 0.3 : Math.min(0.28, this._sweepGlow * 0.25)
      if (now < (this._lineBoost || 0)) target = Math.max(target, 0.38)
      this._lineGlow += (target - this._lineGlow) * Math.min(1, dt * 5)
      this.lines.material.opacity = this._lineGlow * this.fade
    }
    // 星座绘制中:段终点从族心逐条伸出,画完交回静态坐标
    if (this._draw && this.lines) {
      const el = now - this._draw.t0
      const attr = this.lines.geometry.attributes.position
      let done = true
      for (let i = 0; i < this._linePts.length; i++) {
        const p = Math.min(1, Math.max(0, (el - i * this._draw.stagger) / this._draw.per))
        if (p < 1) done = false
        const e = 1 - Math.pow(1 - p, 3)
        const [x, y, z] = this._linePts[i]
        const j = i * 6
        attr.array[j + 3] = this._lineCX + (x - this._lineCX) * e
        attr.array[j + 4] = this._lineCY + (y - this._lineCY) * e
        attr.array[j + 5] = this._lineCZ + (z - this._lineCZ) * e
      }
      attr.needsUpdate = true
      if (done) this._draw = null
    }

    for (const p of this.planets.values()) p.update(t)
  }

  dispose() {
    if (this._labelTimer) { clearTimeout(this._labelTimer); this._labelTimer = null }
    for (const p of this.planets.values()) p.dispose()
    for (const m of [this.lines]) {
      m.geometry?.dispose()
      if (m.material) (Array.isArray(m.material) ? m.material : [m.material]).forEach((x) => x.dispose())
    }
    this.label.element.remove()
  }
}
