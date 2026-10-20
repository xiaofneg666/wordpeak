<script setup>
// ShelfScene — 轨道书库的 3D 书架:一只书架全收所有馆藏书
// (用户:需要一个 3d 空间模型的书架,书架只要一个,把所有的放在书架上面)
// 视觉方向(用户:继续美化,要好看):
//   · 书脊带竖排书名排版(星等罗马字 + 双细线 + 宋体竖书名 + 鎏金进度带)——书架的
//     美一半来自书脊上的字,不再是纯色块
//   · 书的节奏:宽窄随机、高低微差、行尾平摞两本(真实书架的呼吸感)
//   · 房间氛围:护墙板背景 + 壁灯光晕 + 地板光池 + 暖木层板沿口,不再是黑空孤架
//   · 主题呼应:书架上方两圈缓慢旋转的星点轨道(轨道书库的"轨道")
//   · 交互(用户:双击打开书):拖动环视;悬停/单击看书目(卡可钉住);
//     双击打开(馆藏→夜读舱,纸书指南→摊开用法);窄屏单击弹抽屉、快速双击同样打开
//   · 跳转往返优化(书架⇄夜读舱):场景按「结构/进度」双签名消化更新——数据没变不拆房,
//     只有读进度变就原地重绘那几条书脊的鎏金;首建也让过场先起画,星流不被同步建场冻住
import { ref, computed, watch, onMounted, onUnmounted, onActivated, onDeactivated } from 'vue'
import * as THREE from 'three'

const props = defineProps({
  books: { type: Array, default: () => [] },
  regions: { type: Array, default: () => [] }, // [{key, zh, latin, hueVar, sub}]
})
const emit = defineEmits(['open', 'guide', 'chapter', 'tap'])

const wrapEl = ref(null)
const cardEl = ref(null)
const ROMAN = { 1: 'I', 2: 'II', 3: 'III', 4: 'IV' }
const SPINE_D = 0.46 // 书厚(封面到封面的进深)
const REGION_FALLBACK = { literary: '#a78bfa', science: '#22d3ee', classic: '#f2ead8', paper: '#d9c79a' }

// 星域色从主题 CSS 变量解析(主题切换时整体重建重读)
function themeColor(varName, fallback) {
  if (typeof document === 'undefined') return new THREE.Color(fallback)
  const v = getComputedStyle(document.documentElement).getPropertyValue(varName).trim()
  try { return v ? new THREE.Color(v) : new THREE.Color(fallback) } catch { return new THREE.Color(fallback) }
}
const byRegion = computed(() => {
  const map = {}
  for (const r of props.regions) map[r.key] = []
  for (const b of props.books) if (map[b.region]) map[b.region].push(b)
  // 后端拉取顺序不保证稳定(查询无 ORDER BY,写库后可能漂移):按 id 定序,
  // 同一批书怎么拉都排同一排——跳转往返/重拉进度不会整架重洗
  const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  for (const k of Object.keys(map)) map[k].sort(byId)
  return map
})
const doneCount = (b) => b.chapters.filter((c) => c.read).length

// 场景签名:结构段(影响排版/房间的字段)与进度段(影响鎏金的字段)分开记。
// refreshLibrary 每次都换全新对象数组,靠签名识别"到底变没变",别把房间白白拆了重装;
// 签名按 id 排序后生成,与上架定序同律——拉取顺序漂移不再误判成结构变化
function sceneSig() {
  const st = [], pr = []
  const list = [...props.books].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  for (const b of list) {
    st.push([b.id, b.region, b.level, b.title, b.accentVar || ''].join('~'))
    pr.push(`${b.chapters.filter((c) => c.read).length}/${b.chapters.length}`)
  }
  return { st: st.join(';'), pr: pr.join(';') }
}

// ---- three 资源 ----
// stageRoot:书架/铭牌/墙/星环/书全挂这一个组,buildAll 重建时整组换血,不残留旧架
let renderer = null, scene = null, camera = null, ro = null, stageRoot = null
let booksRoot = null, raf = 0, clock = 0
let bookMeshes = [] // [{ mesh, band, book, baseX, baseY, hover }]
let hovered = null
let pinned = null // 单击钉住的书:书签卡常驻,直到点空白/再点一次/双击翻开
let lastTap = null // { book, t }:双击/双触手动判定(触屏不吃 dblclick)
let tapTimer = 0 // 窄屏单击延迟出抽屉:给双击留出窗口
let ringA = null, ringB = null, dust = null
// 跳转往返:场景双签名(结构段影响排版/房间,进度段影响鎏金)——没变不重建,只进度变就重绘书脊
let lastSig = null
let pendingInitialBuild = true // 首建让一帧:领地过场/淡入先起画,画布纹理的重活落下一帧
const fallbackList = ref(false)

// 环视:拖拽 yaw/pitch(限正面弧);闲时极缓摇,书架"活着"
// RADIUS/TARGET 随书架实际尺寸自适应(每次重建后重设)
let yaw = -0.24, pitch = 0.15
let RADIUS = 10.2
const TARGET = new THREE.Vector3(0, 2.1, 0)
const raycaster = new THREE.Raycaster()
const ndc = new THREE.Vector2()
let dragging = false, moved = false, lastX = 0, lastY = 0, downX = 0, downY = 0

function applyCam(t) {
  const sway = dragging ? 0 : Math.sin(t * 0.1) * 0.035
  const yy = yaw + sway
  camera.position.set(
    TARGET.x + Math.sin(yy) * Math.cos(pitch) * RADIUS,
    TARGET.y + Math.sin(pitch) * RADIUS,
    TARGET.z + Math.cos(yy) * Math.cos(pitch) * RADIUS,
  )
  camera.lookAt(TARGET)
}

// ---------- 颜色小工具 ----------
function shade(col, k) { // k>0 提亮 / k<0 压暗
  const c = new THREE.Color(col)
  c.lerp(new THREE.Color(k >= 0 ? 0xffffff : 0x000000), Math.abs(k))
  return '#' + c.getHexString()
}
function lumOf(col) {
  const c = new THREE.Color(col)
  return 0.3 * c.r + 0.59 * c.g + 0.11 * c.b
}

// ---------- 程序纹理 ----------
// 木纹:512px,暖底 + 纵向生长纹 + 上下光影,层板/侧板各配深浅
function woodTexture(base) {
  const cv = document.createElement('canvas')
  cv.width = cv.height = 512
  const g = cv.getContext('2d')
  g.fillStyle = base
  g.fillRect(0, 0, 512, 512)
  for (let i = 0; i < 80; i++) {
    g.strokeStyle = 'rgba(22,10,4,' + (0.03 + Math.random() * 0.08).toFixed(3) + ')'
    g.lineWidth = 0.8 + Math.random() * 2.6
    g.beginPath()
    const y = Math.random() * 512
    g.moveTo(0, y)
    for (let x = 64; x <= 512; x += 64) g.lineTo(x, y + Math.sin(x * 0.045 + i * 1.7) * 4 + (Math.random() - 0.5) * 5)
    g.stroke()
  }
  // 结疤:两三处小椭圆环
  for (let i = 0; i < 3; i++) {
    const x = 60 + Math.random() * 390, y = 60 + Math.random() * 390
    g.strokeStyle = 'rgba(20,10,4,0.22)'; g.lineWidth = 1.6
    for (let r = 3; r < 11; r += 3) { g.beginPath(); g.ellipse(x, y, r * 1.5, r, 0.3, 0, Math.PI * 2); g.stroke() }
  }
  const lg = g.createLinearGradient(0, 0, 0, 512)
  lg.addColorStop(0, 'rgba(255,220,170,0.10)')
  lg.addColorStop(1, 'rgba(0,0,0,0.22)')
  g.fillStyle = lg
  g.fillRect(0, 0, 512, 512)
  const tex = new THREE.CanvasTexture(cv)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  return tex
}

// 护墙板背景:竖板条 + 顶部微亮的暖调深底
function wallTexture() {
  const cv = document.createElement('canvas')
  cv.width = cv.height = 512
  const g = cv.getContext('2d')
  const bg = g.createLinearGradient(0, 0, 0, 512)
  bg.addColorStop(0, '#20263c')
  bg.addColorStop(0.6, '#171b2c')
  bg.addColorStop(1, '#121520')
  g.fillStyle = bg
  g.fillRect(0, 0, 512, 512)
  // 竖板条缝:每 128px 一道暗缝 + 一道受光线
  for (let x = 0; x <= 512; x += 128) {
    g.fillStyle = 'rgba(0,0,0,0.34)'; g.fillRect(x - 1.5, 0, 3, 512)
    g.fillStyle = 'rgba(190,210,255,0.05)'; g.fillRect(x + 1.5, 0, 1.5, 512)
  }
  // 极轻横纹
  for (let i = 0; i < 26; i++) {
    g.strokeStyle = 'rgba(255,255,255,0.015)'
    g.lineWidth = 1
    g.beginPath(); const y = Math.random() * 512; g.moveTo(0, y); g.lineTo(512, y + (Math.random() - 0.5) * 6); g.stroke()
  }
  const tex = new THREE.CanvasTexture(cv)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.repeat.set(2.5, 1)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

// 柔光团(壁灯光晕/地板光池/星环用)
function glowTexture() {
  const cv = document.createElement('canvas')
  cv.width = cv.height = 128
  const g = cv.getContext('2d')
  const gr = g.createRadialGradient(64, 64, 6, 64, 64, 64)
  gr.addColorStop(0, 'rgba(255,200,140,0.5)')
  gr.addColorStop(0.5, 'rgba(150,120,220,0.14)')
  gr.addColorStop(1, 'rgba(0,0,0,0)')
  g.fillStyle = gr
  g.fillRect(0, 0, 128, 128)
  const tex = new THREE.CanvasTexture(cv)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

// 铜牌:暖深底 + 双描边 + 四角铆钉(分区铭牌/顶牌共用)
function plateTexture(zh, latin, accentCss, big = false) {
  const W = big ? 1024 : 640, H = big ? 176 : 128
  const cv = document.createElement('canvas')
  cv.width = W; cv.height = H
  const g = cv.getContext('2d')
  const r = H * 0.24
  g.beginPath()
  g.moveTo(r + 8, 8)
  g.arcTo(W - 8, 8, W - 8, H - 8, r)
  g.arcTo(W - 8, H - 8, r + 8, H - 8, r)
  g.arcTo(r + 8, H - 8, r + 8, 8, r)
  g.arcTo(r + 8, 8, W - 8, 8, r)
  g.closePath()
  const bg = g.createLinearGradient(0, 0, 0, H)
  bg.addColorStop(0, '#2a2136')
  bg.addColorStop(1, '#181220')
  g.fillStyle = bg; g.fill()
  g.strokeStyle = accentCss; g.lineWidth = big ? 4 : 3; g.stroke()
  g.strokeStyle = 'rgba(255,244,220,0.22)'; g.lineWidth = 1
  g.strokeRect(12, 12, W - 24, H - 24)
  // 四角铆钉
  for (const [x, y] of [[24, 24], [W - 24, 24], [24, H - 24], [W - 24, H - 24]]) {
    g.beginPath(); g.arc(x, y, big ? 7 : 5, 0, Math.PI * 2)
    g.fillStyle = '#c9b083'; g.fill()
    g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = 1.5; g.stroke()
  }
  g.textAlign = 'center'
  g.fillStyle = '#eee5d3'
  g.font = `600 ${big ? 78 : 48}px "Times New Roman", "Songti SC", "STZhongsong", serif`
  g.fillText(zh, W / 2, H * 0.46)
  g.fillStyle = 'rgba(196,206,226,0.8)'
  g.font = `500 ${big ? 26 : 19}px ui-monospace, Menlo, monospace`
  try { g.letterSpacing = '5px' } catch { /* 旧浏览器无字距 */ }
  g.fillText('★ ' + latin + ' ★', W / 2, H * 0.8)
  const tex = new THREE.CanvasTexture(cv)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  return tex
}

// 书脊排版:星等罗马字 + 双细线 + 宋体竖排书名 + 底部星饰 + 鎏金进度区
// —— 书架的美一半来自书脊上的字;深浅底自动换墨色,读完的书整面罩金纱
function spineTexture(b, colCss, pct) {
  const W = 128, H = 512
  const cv = document.createElement('canvas')
  cv.width = W; cv.height = H
  const g = cv.getContext('2d')
  // 底色:纵向渐变(上亮下暗,圆弧面感)
  const bg = g.createLinearGradient(0, 0, 0, H)
  bg.addColorStop(0, shade(colCss, 0.16))
  bg.addColorStop(0.5, colCss)
  bg.addColorStop(1, shade(colCss, -0.2))
  g.fillStyle = bg; g.fillRect(0, 0, W, H)
  // 两侧弧面压暗 + 中线微高光(书脊圆角)
  const side = g.createLinearGradient(0, 0, W, 0)
  side.addColorStop(0, 'rgba(0,0,0,0.4)')
  side.addColorStop(0.16, 'rgba(0,0,0,0)')
  side.addColorStop(0.5, 'rgba(255,248,230,0.08)')
  side.addColorStop(0.84, 'rgba(0,0,0,0)')
  side.addColorStop(1, 'rgba(0,0,0,0.4)')
  g.fillStyle = side; g.fillRect(0, 0, W, H)
  // 顶头带 / 底脚带
  g.fillStyle = 'rgba(0,0,0,0.3)'
  g.fillRect(0, 0, W, 14); g.fillRect(0, H - 48, W, 48)
  g.fillStyle = 'rgba(255,244,220,0.16)'
  g.fillRect(0, 14, W, 2); g.fillRect(0, H - 48, W, 2)
  // 墨色:亮底用深墨,深底用暖纸色;读完的书整体压成深金墨
  const dark = lumOf(colCss) > 0.52
  const ink = pct >= 1 ? '#33250f' : dark ? '#221909' : '#f3ead6'
  const gold = '#e8cf9a'
  const acc = b.accentCss || null // 纸书指南:星等/饰线/星饰用分类主题色
  // 星等罗马字 + 双细线
  g.textAlign = 'center'
  g.fillStyle = pct >= 1 ? '#5c431a' : (acc || gold)
  g.font = '700 26px "Times New Roman", serif'
  g.fillText(ROMAN[b.level] || 'I', W / 2, 46)
  g.fillRect(W / 2 - 30, 60, 60, 2)
  g.fillRect(W / 2 - 24, 66, 48, 1.2)
  // 竖排书名(宋体,字距按长度自适应)
  const title = String(b.title || '')
  const fs = title.length <= 4 ? 42 : title.length <= 6 ? 36 : title.length <= 8 ? 31 : 26
  g.font = `600 ${fs}px "Songti SC", "STSong", "SimSun", "Microsoft YaHei", serif`
  g.fillStyle = ink
  g.shadowColor = 'rgba(0,0,0,0.5)'; g.shadowBlur = 4; g.shadowOffsetY = 2
  let y = 100 + fs * 0.5
  for (const ch of title) { g.fillText(ch, W / 2, y); y += fs * 1.14 }
  g.shadowBlur = 0; g.shadowOffsetY = 0
  // 底部星饰
  g.fillStyle = pct >= 1 ? '#5c431a' : (acc || gold)
  g.font = '16px serif'
  g.fillText('★', W / 2, H - 66)
  // 已读:进度带区微暗(鎏金带落位处);读完:整面鎏金纱
  if (pct > 0) { g.fillStyle = 'rgba(0,0,0,0.24)'; g.fillRect(0, H - 42, W, 42) }
  if (pct >= 1) { g.fillStyle = 'rgba(242,234,216,0.32)'; g.fillRect(0, 0, W, H) }
  const tex = new THREE.CanvasTexture(cv)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  return tex
}

// ---------- 版面:每星域一层,书宽窄/高低/倾角随机,行尾平摞两本 ----------
function hashStr(s) {
  let n = 2166136261
  s = String(s)
  for (let i = 0; i < s.length; i++) { n ^= s.charCodeAt(i); n = Math.imul(n, 16777619) }
  return (n >>> 0) / 4294967295
}
function layoutRows() {
  const plans = props.regions.map((reg) => {
    const list = byRegion.value[reg.key] || []
    const stand = []
    let cursor = 0
    for (const b of list) {
      const paper = b.region === 'paper' // 纸书指南:小一号的平装本,排得密而齐
      const w = paper ? 0.18 + hashStr(b.id + 'w') * 0.06 : 0.3 + hashStr(b.id + 'w') * 0.13
      const h = paper
        ? 0.4 + (b.level || 1) * 0.024 + (hashStr(b.id + 'h') - 0.5) * 0.04
        : 0.64 + (b.level || 1) * 0.058 + (hashStr(b.id + 'h') - 0.5) * 0.05
      const gap = paper ? 0.014 + hashStr(b.id + 'g') * 0.014 : 0.018 + hashStr(b.id + 'g') * 0.026
      stand.push({ b, w, h, x: cursor + w / 2, tilt: paper ? 0 : (hashStr(b.id + 't') - 0.5) * 0.09, zOff: (hashStr(b.id + 'z') - 0.5) * 0.05 })
      cursor += w + gap
    }
    return { reg, stand, span: cursor, list }
  })
  // 行尾平摞:挑空隙最大的两行,把末两本书平躺摞起来(真实书架的呼吸感)
  const spans = plans.map((p) => p.span)
  const maxSpan = Math.max(...spans, 0)
  plans.forEach((p) => {
    p.lie = []
    if (maxSpan - p.span > 1.0 && p.list.length >= 6 && p.reg.key !== 'paper') {
      p.lie = p.stand.splice(-2)
      p.span -= p.lie.reduce((n, it) => n + it.w + 0.03, 0)
      p.span += 0.18 + Math.max(...p.lie.map((it) => it.h)) + 0.1
    }
  })
  return plans
}

// ---------- 一只书架(木框 + 层板沿口 + 灯带 + 铭牌 + 墙 + 星环) ----------
function buildShelf({ SW, boardYs, SH }) {
  const SD = 0.66
  // 木框:侧板/顶盖/檐口/柜底/背板
  const sideMat = new THREE.MeshStandardMaterial({ map: woodTexture('#5e3f2b'), roughness: 0.8 })
  const backMat = new THREE.MeshStandardMaterial({ map: woodTexture('#3c2718'), roughness: 0.9 })
  const corniceMat = new THREE.MeshStandardMaterial({ map: woodTexture('#4e3320'), roughness: 0.82 })
  const shelf = new THREE.Group()
  const slab = (w, h, d, mat, x, y, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat)
    m.position.set(x, y, z)
    shelf.add(m)
    return m
  }
  const H = SH + 0.1
  slab(0.15, H, SD, sideMat, -(SW / 2 - 0.075), H / 2 + 0.03, 0)
  slab(0.15, H, SD, sideMat, (SW / 2 - 0.075), H / 2 + 0.03, 0)
  slab(SW, 0.15, SD + 0.06, sideMat, 0, SH + 0.08, 0.01)
  slab(SW + 0.3, 0.09, SD + 0.17, corniceMat, 0, SH + 0.2, 0.02)
  slab(SW + 0.26, 0.22, SD + 0.2, corniceMat, 0, 0.1, 0.02)
  slab(SW - 0.3, H - 0.16, 0.05, backMat, 0, H / 2 + 0.03, -SD / 2 + 0.04)

  // 层板:深浅交替 + 前沿口亮木条 + 板下暖灯带
  const boardTones = ['#7d5535', '#86603c']
  const lipMat = new THREE.MeshStandardMaterial({ color: 0xa9795a, roughness: 0.55, metalness: 0.05 })
  const stripMat = new THREE.MeshBasicMaterial({ color: 0xffc98a })
  props.regions.forEach((reg, i) => {
    const by = boardYs[i]
    const boardMat = new THREE.MeshStandardMaterial({ map: woodTexture(boardTones[i % 2]), roughness: 0.72 })
    slab(SW - 0.4, 0.085, SD - 0.12, boardMat, 0, by, 0.01)
    const lip = new THREE.Mesh(new THREE.BoxGeometry(SW - 0.42, 0.026, 0.026), lipMat)
    lip.position.set(0, by + 0.0425 + 0.013, SD / 2 - 0.07)
    shelf.add(lip)
    const strip = new THREE.Mesh(new THREE.BoxGeometry(SW - 0.7, 0.012, 0.026), stripMat)
    strip.position.set(0, by - 0.05, SD / 2 - 0.06)
    shelf.add(strip)
    // 分区铭牌贴背板:星域名 + 拉丁小字,描边用该星域主题色
    const accentCss = (getComputedStyle(document.documentElement).getPropertyValue(reg.hueVar).trim() || REGION_FALLBACK[reg.key] || '#a78bfa')
    const plate = new THREE.Mesh(
      new THREE.PlaneGeometry(2.1, 0.42),
      new THREE.MeshBasicMaterial({ map: plateTexture(reg.zh, reg.latin, accentCss), transparent: true }),
    )
    plate.position.set(-(SW / 2) + 1.42, by + 0.66, -SD / 2 + 0.08)
    stageRoot.add(plate)
  })
  // 顶牌:轨道书库
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(3.5, 0.6),
    new THREE.MeshBasicMaterial({ map: plateTexture('轨道书库', 'ORBITAL LIBRARY', '#f2ead8', true), transparent: true }),
  )
  sign.position.set(0, SH + 0.55, SD / 2 + 0.07)
  stageRoot.add(sign)

  // ---------- 房间氛围 ----------
  const wallTex = wallTexture()
  const wall = new THREE.Mesh(
    new THREE.PlaneGeometry(36, 15),
    new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.96 }),
  )
  wall.position.set(0, 6.6, -SD / 2 - 1.75)
  stageRoot.add(wall)
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(48, 28),
    new THREE.MeshStandardMaterial({ color: 0x0c0f1a, roughness: 0.95 }),
  )
  floor.rotation.x = -Math.PI / 2
  stageRoot.add(floor)
  const pool = new THREE.Mesh(
    new THREE.PlaneGeometry(15, 8.5),
    new THREE.MeshBasicMaterial({ map: glowTexture(), transparent: true, depthWrite: false }),
  )
  pool.rotation.x = -Math.PI / 2
  pool.position.y = 0.02
  stageRoot.add(pool)
  // 壁灯光晕:顶牌后的柔光 + 两侧暖点
  const mkGlow = (x, y, z, s, o) => {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture(), transparent: true, opacity: o, depthWrite: false,
      blending: THREE.AdditiveBlending,
    }))
    sp.position.set(x, y, z)
    sp.scale.set(s, s, 1)
    stageRoot.add(sp)
  }
  mkGlow(0, SH + 0.7, -SD / 2 - 1.5, 8, 0.34)
  mkGlow(-SW * 0.52, SH + 0.9, -SD / 2 - 1.55, 3.6, 0.5)
  mkGlow(SW * 0.52, SH + 0.9, -SD / 2 - 1.55, 3.6, 0.5)

  // 星环:两圈缓慢反向旋转的金/紫星点,绕着书架上方(轨道书库的"轨道")
  const mkRing = (a, b, count, hex, size, opacity, y, tilt) => {
    const pos = []
    for (let i = 0; i < count; i++) {
      const t = (i / count) * Math.PI * 2
      pos.push(Math.cos(t) * a, 0, Math.sin(t) * b)
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({
      color: hex, size, transparent: true, opacity,
      blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
    }))
    pts.position.set(0, y, 0)
    pts.rotation.z = tilt
    stageRoot.add(pts)
    return pts
  }
  ringA = mkRing(SW * 0.82, SW * 0.36, 72, 0xf2d9a6, 0.085, 0.85, SH + 1.5, 0.1)
  ringB = mkRing(SW * 0.6, SW * 0.98, 30, 0x8b7bd8, 0.13, 0.4, SH + 2.2, -0.14)

  // 光尘:灯光柱里缓缓上浮的微尘
  {
    const N = 90
    const pos = new Float32Array(N * 3)
    for (let i = 0; i < N; i++) {
      pos[i * 3] = (Math.random() - 0.5) * SW * 1.3
      pos[i * 3 + 1] = 1 + Math.random() * (SH + 1.2)
      pos[i * 3 + 2] = Math.random() * 2.4 - 0.4
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    dust = new THREE.Points(geo, new THREE.PointsMaterial({
      color: 0xffd9b0, size: 0.028, transparent: true, opacity: 0.3,
      blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
    }))
    stageRoot.add(dust)
  }
  stageRoot.add(shelf)
}

// ---------- 书:立着的书脊 + 行尾平摞两本 + 底部镀金进度条 ----------
function buildBooks(plans, { SW, boardYs }) {
  booksRoot = new THREE.Group()
  stageRoot.add(booksRoot)
  bookMeshes = []
  const pageMat = () => new THREE.MeshStandardMaterial({ color: 0xe6dcc4, roughness: 0.9, metalness: 0 })
  plans.forEach((plan, si) => {
    const reg = plan.reg
    if (!plan.list.length) return
    const isPaper = reg.key === 'paper'
    const base = reg.hueVar
      ? themeColor(reg.hueVar, REGION_FALLBACK[reg.key] || '#a78bfa')
      : new THREE.Color(REGION_FALLBACK[reg.key] || '#a78bfa')
    // 纸书指南:奶油纸平装(和馆藏的深宝石色一眼分开);馆藏压暗一点,贴木架不飘
    const col = isPaper
      ? new THREE.Color(0xe9dfc4)
      : base.clone().lerp(new THREE.Color(0x201a30), 0.24)
    if (isPaper) for (const it of plan.stand) {
      // 指南书脊上的星等/饰线用分类主题色(主题切换重建时随色重读)
      it.b.accentCss = '#' + themeColor(it.b.accentVar || '--accent', '#f472b6').getHexString()
    }
    const colCss = '#' + col.getHexString()
    const startX = -SW / 2 + 0.3
    const boardY = boardYs[si] + 0.043
    const addSpine = (item, x, y, z, rotZ, rotY, lying) => {
      const b = item.b
      const pct = b.chapters.length ? b.chapters.filter((c) => c.read).length / b.chapters.length : 0
      const w = item.w, h = item.h
      const coverMat = new THREE.MeshStandardMaterial({ color: col.clone().lerp(new THREE.Color(0x120d1c), 0.3), roughness: 0.55, metalness: 0.12 })
      const backMat = new THREE.MeshStandardMaterial({ color: col.clone().lerp(new THREE.Color(0x120d1c), 0.45), roughness: 0.8 })
      const faceMat = new THREE.MeshStandardMaterial({ map: spineTexture(b, colCss, pct), roughness: 0.48, metalness: 0.16 })
      const spine = new THREE.Mesh(new THREE.BoxGeometry(w, h, SPINE_D), [coverMat, coverMat, pageMat(), pageMat(), faceMat, backMat])
      spine.position.set(x, y, z)
      spine.rotation.z = rotZ
      spine.rotation.y = rotY
      // 鎏金进度带(挂书脊上,悬停一起动);整本读完通体鎏金
      let band = null
      if (pct > 0) {
        const bh = Math.max(0.05, h * pct)
        band = new THREE.Mesh(
          new THREE.BoxGeometry(w - 0.07, bh, 0.016),
          new THREE.MeshStandardMaterial({ color: 0xf2ead8, emissive: 0xd9c79a, emissiveIntensity: 0.25, roughness: 0.3, metalness: 0.6 }),
        )
        band.position.set(0, -h / 2 + bh / 2, SPINE_D / 2 + 0.009)
        spine.add(band)
      }
      if (pct >= 1) {
        for (const m of [coverMat, backMat, faceMat]) m.color.lerp(new THREE.Color(0xf2ead8), 0.42)
        faceMat.emissive = new THREE.Color(0x8a744a)
        faceMat.emissiveIntensity = 0.2
      }
      spine.userData = { book: b, region: reg }
      booksRoot.add(spine)
      // 记全重绘要用的材料/尺寸/底色:只有进度变时 refreshGilding 原地换纹理,不拆这本能立着的书
      bookMeshes.push({ mesh: spine, band, book: b, baseX: x, baseY: y, baseZ: z, hover: 0, lying, w, h, pct, colCss, faceMat, coverMat, backMat })
    }
    // 立书:左起排开,带随机倾角与前后错落
    plan.stand.forEach((item) => {
      addSpine(item, startX + item.x, boardY + item.h / 2, 0.02 + item.zOff, item.tilt, 0, false)
    })
    // 平摞:行尾两本侧躺摞起(书脊面朝前,标题横读)
    if (plan.lie.length) {
      const long = Math.max(...plan.lie.map((it) => it.h))
      let lx = startX + plan.stand.reduce((n, it) => n + it.w + 0.018 + hashStr(it.b.id + 'g') * 0.026, 0.12)
      let ly = boardY
      plan.lie.forEach((item, k) => {
        ly += item.w / 2 + (k ? 0.012 : 0.005)
        addSpine(item, lx + long / 2, ly, 0.02, (Math.PI / 2) * (k % 2 ? -1 : 1), (hashStr(item.b.id + 'r') - 0.5) * 0.1, true)
        ly += item.w / 2
      })
    }
  })
}

// ---------- 悬停书签卡 ----------
const cardBook = ref(null)
const cardStyle = ref({ left: '0px', top: '0px', visibility: 'hidden' })
let lastCardCalc = null // __shelfDebug.cardCalc() 用:两翼停靠的实时判定值
let frameN = 0
const canHover = () => typeof window !== 'undefined'
  && window.matchMedia('(hover: hover) and (min-width: 641px)').matches
const cardState = computed(() => {
  const b = cardBook.value
  if (!b) return null
  if (!b.chapters.length) return { done: false, reading: false } // 纸书指南:无章节,不走已读态
  const d = doneCount(b)
  return { done: d >= b.chapters.length, reading: d > 0 && d < b.chapters.length }
})
function projectCard(rec) {
  if (!cardEl.value) return
  const wrap = wrapEl.value.getBoundingClientRect()
  const cw = cardEl.value.offsetWidth || 252
  const ch = cardEl.value.offsetHeight || 220
  // 书架的屏幕投影带:逐本量真实外沿(立书=书厚半宽,躺书=身长半宽,躺书
  // 书心偏左时只看中心会把翼宽错估)再取全体最左/最右——卡放进带外空白两翼
  let minX = Infinity, maxX = -Infinity
  for (const r of bookMeshes) {
    const half = (r.lying ? r.h : r.w) / 2
    const a = new THREE.Vector3(r.baseX - half, r.baseY, r.baseZ).project(camera)
    const b = new THREE.Vector3(r.baseX + half, r.baseY, r.baseZ).project(camera)
    minX = Math.min(minX, (a.x * 0.5 + 0.5) * wrap.width)
    maxX = Math.max(maxX, (b.x * 0.5 + 0.5) * wrap.width)
  }
  if (isFinite(minX)) { minX -= 12; maxX += 12 } // 层板比书略宽,给翼再留 12px
  // 悬停书的书心(卡竖向与书对齐)
  const v = new THREE.Vector3(rec.baseX, rec.baseY, rec.baseZ + SPINE_D / 2)
  v.project(camera)
  const cx = (v.x * 0.5 + 0.5) * wrap.width
  const cy = (-v.y * 0.5 + 0.5) * wrap.height
  let left
  if (isFinite(minX)) {
    // 两翼停靠:书在哪半边,卡放同侧翼(眼动距离最短)——整个书架零遮挡,
    // 旧版骑在书头顶,高卡一被顶边夹住就把上面几排书、区牌连同悬停的书整块盖掉
    const leftWing = minX - 24
    const rightWing = wrap.width - 24 - maxX
    const wantLeft = cx * 2 < wrap.width
    if (wantLeft && leftWing >= cw) left = 12
    else if (!wantLeft && rightWing >= cw) left = wrap.width - cw - 12
    else if (rightWing >= cw) left = wrap.width - cw - 12
    else if (leftWing >= cw) left = 12
  }
  if (left == null) {
    // 两翼都放不下(窄画布):退回贴身侧放——立在书的左肩或右肩,哪边空放哪
    const GAP = 24
    const rightRoom = wrap.width - 12 - cx - GAP
    const leftRoom = cx - 12 - GAP
    left = rightRoom >= leftRoom
      ? Math.min(cx + GAP, wrap.width - cw - 12)
      : Math.max(12, cx - GAP - cw)
  }
  const top = Math.min(Math.max(12, cy - ch / 2), Math.max(12, wrap.height - ch - 12))
  cardStyle.value = { left: left + 'px', top: top + 'px', visibility: 'visible' }
  lastCardCalc = { minX: +minX.toFixed(1), maxX: +maxX.toFixed(1), cx: +cx.toFixed(1), cy: +cy.toFixed(1), left, cw, ch }
}

// ---------- 指针:拖拽环视 / 悬停 / 点击 ----------
function setHovered(rec) {
  if (hovered === rec) return
  hovered = rec
  // 悬停优先,离开后钉住的卡继续留在台上
  if (canHover()) cardBook.value = (rec || pinned)?.book || null
  if (!rec && !pinned) cardStyle.value = { ...cardStyle.value, visibility: 'hidden' }
  if (renderer) renderer.domElement.style.cursor = rec ? 'pointer' : ''
}
function pick(e) {
  const rct = renderer.domElement.getBoundingClientRect()
  ndc.x = ((e.clientX - rct.left) / rct.width) * 2 - 1
  ndc.y = -((e.clientY - rct.top) / rct.height) * 2 + 1
  raycaster.setFromCamera(ndc, camera)
  const meshes = booksRoot ? booksRoot.children.filter((c) => c.userData?.book) : []
  const hits = raycaster.intersectObjects(meshes, false)
  return hits.length ? bookMeshes.find((m) => m.mesh === hits[0].object) : null
}
function onDown(e) {
  dragging = true; moved = false
  if (tapTimer) { clearTimeout(tapTimer); tapTimer = 0 } // 第二击落笔:先撤掉待弹的抽屉
  lastX = downX = e.clientX; lastY = downY = e.clientY
}
function onMove(e) {
  if (dragging) {
    const dx = e.clientX - lastX, dy = e.clientY - lastY
    lastX = e.clientX; lastY = e.clientY
    if (Math.abs(e.clientX - downX) + Math.abs(e.clientY - downY) > 6) moved = true
    yaw = Math.min(0.72, Math.max(-0.72, yaw - dx * 0.004))
    pitch = Math.min(0.5, Math.max(0.08, pitch + dy * 0.003))
    return
  }
  setHovered(pick(e))
}
function onUp(e) {
  if (dragging && !moved) {
    const rec = pick(e)
    const now = performance.now()
    if (rec) {
      // 双击/双触:任何屏宽都直接翻开(用户:双击打开书)
      if (lastTap && lastTap.book?.id === rec.book?.id && now - lastTap.t < 450) {
        lastTap = null; pinned = null
        if (tapTimer) { clearTimeout(tapTimer); tapTimer = 0 }
        // 双击打开:馆藏 → 夜读舱;纸书指南 → 摊开用法抽屉
        emit(rec.book.guide ? 'guide' : 'open', rec.book)
        dragging = false
        return
      }
      lastTap = { book: rec.book, t: now }
      if (canHover()) {
        // 桌面单击:钉住/收起这张书签卡,翻开交给双击,不再一碰就跳走
        pinned = pinned?.mesh === rec.mesh ? null : rec
        cardBook.value = (hovered || pinned)?.book || null
        if (!pinned && !hovered) cardStyle.value = { ...cardStyle.value, visibility: 'hidden' }
      } else {
        // 窄屏:单击延迟半拍弹抽屉(给双击留窗),双击就不用见抽屉直接翻开
        const b = rec.book
        if (tapTimer) clearTimeout(tapTimer)
        tapTimer = setTimeout(() => { tapTimer = 0; emit('tap', b) }, 460)
      }
    } else if (canHover()) {
      // 点空白:收起钉住的卡
      lastTap = null; pinned = null; cardBook.value = null
      cardStyle.value = { ...cardStyle.value, visibility: 'hidden' }
    }
  }
  dragging = false
}
const onCancel = () => { dragging = false }
let cleanupDom = null, onTheme = null

// ---------- 重建(馆配齐/主题换色/读完一章回来刷新镀金) ----------
function disposeTree(o) {
  o.traverse?.((x) => {
    x.geometry?.dispose()
    if (x.material) (Array.isArray(x.material) ? x.material : [x.material]).forEach((m) => { m.map?.dispose(); m.dispose() })
  })
}
function buildAll() {
  if (!scene || !stageRoot) return
  pendingInitialBuild = false
  for (const o of [...stageRoot.children]) {
    stageRoot.remove(o)
    disposeTree(o)
  }
  ringA = ringB = dust = null
  booksRoot = null
  bookMeshes = []
  hovered = null
  pinned = null
  lastTap = null
  if (tapTimer) { clearTimeout(tapTimer); tapTimer = 0 }
  cardBook.value = null
  const plans = layoutRows()
  const spans = plans.map((p) => p.span)
  const SW = Math.min(6.2, Math.max(4.4, Math.max(...spans, 0) + 0.95))
  const boardYs = props.regions.map((_, i) => 0.66 + i * 1.08)
  const SH = boardYs[boardYs.length - 1] + 1.3
  buildShelf({ SW, boardYs, SH })
  buildBooks(plans, { SW, boardYs })
  // 取景:书架实际尺寸自适应,顶牌与星环入画
  TARGET.set(0, SH * 0.5 + 0.1, 0)
  RADIUS = Math.min(11.2, Math.max(9.0, SW * 1.72))
  setHovered(null)
  lastSig = sceneSig()
}

// 只有已读进度变(读完一章回来/夜读舱里交卷):房间、书架、排版全都不动,
// 原地重绘变了的那几条书脊(纹理里的进度暗带/读完金纱 + 鎏金带 + 封面罩金)。
// 返回 false = 遇到结构变化或进度回退,那不是这函数的活,交回 buildAll 整场重建
function refreshGilding() {
  const byId = new Map(props.books.map((b) => [b.id, b]))
  for (const rec of bookMeshes) {
    const nb = byId.get(rec.book.id)
    if (!nb || !rec.faceMat) return false
    const pct = nb.chapters.length ? nb.chapters.filter((c) => c.read).length / nb.chapters.length : 0
    if (pct < rec.pct) return false // 进度只会增长;回退=数据异常,整场重建兜底
    if (pct === rec.pct) {
      rec.book = nb // 对象换新了但进度没动:只把引用换成新数据,书签卡跟着新鲜
      rec.mesh.userData.book = nb
      // cardBook 也得跟着换引用:frame 里按书找 rec,引用断链卡片就冻在原地
      if (cardBook.value?.id === nb.id) cardBook.value = nb
      continue
    }
    // 重绘书脊面:墨色/进度暗带/整本读完的金纱全画在纹理里
    rec.faceMat.map?.dispose()
    rec.faceMat.map = spineTexture(nb, rec.colCss, pct)
    rec.faceMat.needsUpdate = true
    // 鎏金带:旧的长短不对了,拆掉按新进度立一根
    if (rec.band) { rec.mesh.remove(rec.band); rec.band.geometry.dispose(); rec.band.material.dispose(); rec.band = null }
    if (pct > 0) {
      const bh = Math.max(0.05, rec.h * pct)
      const band = new THREE.Mesh(
        new THREE.BoxGeometry(rec.w - 0.07, bh, 0.016),
        new THREE.MeshStandardMaterial({ color: 0xf2ead8, emissive: 0xd9c79a, emissiveIntensity: 0.25, roughness: 0.3, metalness: 0.6 }),
      )
      band.position.set(0, -rec.h / 2 + bh / 2, SPINE_D / 2 + 0.009)
      rec.mesh.add(band)
      rec.band = band
    }
    // 跨过读完线:封面/封底也罩金(与 buildBooks 同款)
    if (pct >= 1 && rec.pct < 1) {
      for (const m of [rec.coverMat, rec.backMat, rec.faceMat]) m.color.lerp(new THREE.Color(0xf2ead8), 0.42)
      rec.faceMat.emissive = new THREE.Color(0x8a744a)
      rec.faceMat.emissiveIntensity = 0.2
    }
    rec.pct = pct
    rec.book = nb
    rec.mesh.userData.book = nb
    if (cardBook.value?.id === nb.id) cardBook.value = nb // 钉着的书签卡同步换新数据
  }
  return true
}

// ---------- 渲染循环(KeepAlive 切走停,回来续) ----------
function frame() {
  if (!renderer) return
  frameN++
  const t = (performance.now() - clock) / 1000
  applyCam(t)
  // 星环反旋 + 光尘浮动
  if (ringA) ringA.rotation.y += 0.0022
  if (ringB) ringB.rotation.y -= 0.0013
  if (dust) { dust.rotation.y += 0.0004; dust.position.y = Math.sin(t * 0.25) * 0.18 }
  for (const m of bookMeshes) {
    const hot = m === hovered
    m.hover += ((hot ? 1 : 0) - m.hover) * 0.14
    const pull = m.lying ? 0.06 : 0.09 // 平摞的书拔出少一点,不穿层板
    m.mesh.position.z = m.baseZ + m.hover * pull
    m.mesh.position.y = m.baseY + m.hover * (m.lying ? 0.02 : 0.035)
    const s = 1 + m.hover * 0.05
    m.mesh.scale.set(s, s, 1)
    if (m.band) m.band.material.emissiveIntensity = 0.25 + m.hover * 0.5
  }
  if ((hovered || pinned) && cardBook.value) {
    // 按 id 找,不按引用:后台刷新库会换 book 对象,引用判定会把卡冻在旧书位
    const rec = bookMeshes.find((m) => m.book?.id === cardBook.value?.id)
    if (rec) projectCard(rec)
  }
  renderer.render(scene, camera)
  raf = requestAnimationFrame(frame)
}
function startLoop() {
  if (raf || !renderer) return
  clock = performance.now()
  raf = requestAnimationFrame(frame)
}
function stopLoop() {
  if (raf) cancelAnimationFrame(raf)
  raf = 0
}

onMounted(() => {
  const wrap = wrapEl.value
  if (!wrap) return
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true })
  } catch { fallbackList.value = true; return }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.1
  wrap.appendChild(renderer.domElement)
  scene = new THREE.Scene()
  scene.background = new THREE.Color(0x0b0e18)
  scene.fog = new THREE.FogExp2(0x0b0e18, 0.032)
  stageRoot = new THREE.Group()
  scene.add(stageRoot)
  camera = new THREE.PerspectiveCamera(40, 1, 0.1, 90)

  // 灯:暖主光斜落 + 冷轮廓勾边 + 柜前暖点光(书脊的"读灯"),层板灯带由自发光条出
  scene.add(new THREE.AmbientLight(0x333a58, 1.05))
  const key = new THREE.DirectionalLight(0xffe4bd, 1.35); key.position.set(4.5, 7.5, 6.5); scene.add(key)
  const rim = new THREE.DirectionalLight(0x5d7bff, 0.42); rim.position.set(-5, 4.5, -4); scene.add(rim)
  const lamp = new THREE.PointLight(0xffb37a, 1.15, 10); lamp.position.set(0, 4.6, 2.8); scene.add(lamp)
  const fill = new THREE.PointLight(0xffc9a0, 0.5, 9); fill.position.set(0, 2.2, 3.4); scene.add(fill)

  // 首建让过场先起画:书脊/木纹全是画布纹理,一口气画完会冻住领地过场与视图淡入;
  // 推迟两帧让入场先出一帧画,空场底色与卡壳同色,这一两帧看不出来
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (pendingInitialBuild && renderer) { buildAll(); applyCam(0) }
  }))

  // 调试钩子(同引擎 window.__engineDebug 的先例):外部可查装配数/定点拾取
  window.__shelfDebug = {
    info: () => ({
      books: bookMeshes.length,
      byRegion: bookMeshes.reduce((m, r) => { m[r.book.region] = (m[r.book.region] || 0) + 1; return m }, {}),
      radius: RADIUS, targetY: TARGET.y,
    }),
    pickAt: (x, y) => {
      const hit = pick({ clientX: x, clientY: y })
      return hit ? { title: hit.book.title, region: hit.book.region, guide: !!hit.book.guide } : null
    },
    cardCalc: () => lastCardCalc,
    frameProbe: () => ({
      n: frameN,
      hovered: hovered?.book?.title ?? null,
      cardId: cardBook.value?.id ?? null,
      matched: bookMeshes.find((m) => m.book?.id === cardBook.value?.id)?.book?.id ?? null,
    }),
  }

  ro = new ResizeObserver(() => {
    const w = wrap.clientWidth || 1, h = wrap.clientHeight || 1
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
  })
  ro.observe(wrap)

  const dom = renderer.domElement
  dom.addEventListener('pointerdown', onDown)
  dom.addEventListener('pointermove', onMove)
  dom.addEventListener('pointerup', onUp)
  dom.addEventListener('pointercancel', onCancel)
  dom.addEventListener('pointerleave', () => { setHovered(null); dragging = false })
  cleanupDom = () => {
    dom.removeEventListener('pointerdown', onDown)
    dom.removeEventListener('pointermove', onMove)
    dom.removeEventListener('pointerup', onUp)
    dom.removeEventListener('pointercancel', onCancel)
  }
  onTheme = () => buildAll()
  window.addEventListener('wv:themechange', onTheme)
  startLoop()
})

// 数据更新按签名分流:没变不拆房(回书架/切视图往返零成本),只进度变就重绘书脊,
// 结构真变(增删书/改星等/换主题色)才整场重建。夜读舱交卷时书架在后台走的就是前两条
watch(() => props.books, () => {
  if (!scene || !stageRoot) return // WebGL 兜底态走按钮列表,列表本身响应式
  const sig = sceneSig()
  if (sig.st === lastSig?.st && sig.pr === lastSig?.pr) return
  if (sig.st === lastSig?.st && refreshGilding()) { lastSig = sig; return }
  buildAll()
})

onDeactivated(() => {
  stopLoop()
  // 切走清钉住/双击计时/待弹抽屉,回来不带旧状态
  // hovered 也要清:不清的话回来第一次悬停同本书,setHovered 会早退,书签卡不弹
  pinned = null; lastTap = null; hovered = null
  if (tapTimer) { clearTimeout(tapTimer); tapTimer = 0 }
  cardBook.value = null
})
onActivated(startLoop)
onUnmounted(() => {
  stopLoop()
  if (tapTimer) clearTimeout(tapTimer)
  cleanupDom?.()
  window.removeEventListener('wv:themechange', onTheme)
  ro?.disconnect()
  if (scene) disposeTree(scene)
  renderer?.forceContextLoss?.()
  renderer?.dispose?.()
  renderer = null
})

const shelfHint = '按住拖动 · 环视　—　悬停/单击 · 看书目　—　双击 · 翻开'
</script>

<template>
  <div ref="wrapEl" class="shelf-scene" :class="{ fail: fallbackList }">
    <!-- WebGL 不可用:书目按钮列表兜底,点开照样走抽屉 -->
    <div v-if="fallbackList" class="shelf-fallback">
      <button v-for="b in books" :key="b.id" class="sf-book" @click="emit('tap', b)">
        {{ ROMAN[b.level] }} · {{ b.title }}
      </button>
    </div>
    <div v-else class="shelf-hint mono">{{ shelfHint }}</div>

    <!-- 悬停/钉住书签卡:馆藏=章节直达,纸书指南=简介 + 双击摊开用法 -->
    <div
      v-if="cardBook && cardState" ref="cardEl"
      class="star-card" :class="{ done: cardState.done, reading: cardState.reading, guide: !!cardBook.guide }"
      :style="cardStyle"
    >
      <template v-if="cardBook.chapters.length">
        <span class="sc-kicker mono">MAGNITUDE {{ ROMAN[cardBook.level] }} · {{ cardBook.chapters.length }} 章 · 已读 {{ doneCount(cardBook) }}/{{ cardBook.chapters.length }}</span>
        <div class="sc-title">{{ cardBook.title }}</div>
        <span class="sc-en">{{ cardBook.en_title }}</span>
        <p class="sc-line">{{ cardBook.one_line }}</p>
        <div class="sc-roots mono">{{ cardBook.word_focus.map((r) => r.toUpperCase()).join(' · ') }}</div>
        <ol class="sc-chapters">
          <li v-for="c in cardBook.chapters" :key="c.no">
            <button class="sc-ch unstyled-btn" :class="{ lit: c.read }" @click="emit('chapter', { book: cardBook, chapter: c })">
              <i class="ch-dot" aria-hidden="true" />
              <span class="ch-no mono">{{ c.no }}</span>
              <span class="ch-title">{{ c.title }}</span>
              <span class="ch-state">{{ c.read ? '已读' : '进入' }}</span>
            </button>
          </li>
        </ol>
        <button class="btn small sc-open" @click="emit('open', cardBook)">翻开这本书 →</button>
      </template>
      <template v-else>
        <span class="sc-kicker mono">PAPER GUIDE · {{ cardBook.guide.badge }}</span>
        <div class="sc-title">{{ cardBook.title }}</div>
        <span class="sc-en">{{ cardBook.en_title }}</span>
        <p class="sc-line">{{ cardBook.one_line }}</p>
        <div class="sc-roots mono">{{ cardBook.guide.category }} · 难度 {{ cardBook.guide.difficulty }}/5</div>
        <div class="sc-guide-tip mono">双击 · 摊开这本指南的用法</div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.shelf-scene {
  position: relative; height: clamp(520px, 66vh, 780px);
  border-radius: 18px; overflow: hidden;
  border: 1px solid var(--line-strong);
  background: #0b0e18;
  box-shadow: var(--shadow-scene, 0 18px 44px -24px rgba(0, 0, 0, 0.6));
  touch-action: pan-y; /* 横向拖拽留给环视,纵向页面照常滚 */
}
.shelf-scene :deep(canvas) { display: block; width: 100%; height: 100%; }
/* 取景暗角:四周轻压,视线聚到书架 */
.shelf-scene::after {
  content: ''; position: absolute; inset: 0; z-index: 1; pointer-events: none;
  border-radius: inherit;
  background: radial-gradient(120% 90% at 50% 42%, transparent 58%, rgba(4, 6, 12, 0.42) 100%);
}
.shelf-scene.fail { display: flex; flex-wrap: wrap; gap: 8px; align-content: flex-start; padding: 14px; background: var(--bg); }
.shelf-fallback { display: flex; flex-wrap: wrap; gap: 8px; }
.sf-book {
  padding: 6px 12px; border-radius: 8px; cursor: pointer;
  background: var(--surface); border: 1px solid var(--line); color: var(--text-2);
  font-size: var(--fs-xs); font-family: inherit;
}
.sf-book:hover { border-color: var(--line-accent); color: var(--text); }
.shelf-hint {
  position: absolute; left: 50%; bottom: 12px; transform: translateX(-50%);
  z-index: 2; font-size: var(--fs-2xs); letter-spacing: 0.12em; color: rgba(190, 200, 220, 0.72);
  pointer-events: none; white-space: nowrap;
  padding: 5px 14px; border-radius: 999px;
  background: rgba(10, 13, 24, 0.55); backdrop-filter: blur(6px);
  border: 1px solid rgba(190, 200, 220, 0.12);
}
@media (max-width: 640px) { .shelf-hint { display: none; } }

/* 书签卡(悬停摊开;与书库抽屉同源样式,窄屏不渲染走抽屉) */
.star-card {
  position: absolute; z-index: 12; width: 252px; padding: 16px 18px;
  background: color-mix(in srgb, var(--surface) 92%, transparent);
  border: 1px solid var(--line-strong);
  border-radius: 12px;
  box-shadow: var(--shadow-lg);
  backdrop-filter: blur(10px);
}
.sc-kicker { font-size: var(--fs-2xs); letter-spacing: 2px; color: var(--accent); display: block; }
.sc-title { font-size: var(--fs-md); font-weight: 700; margin: 5px 0 2px; }
.star-card.done .sc-title { color: var(--gold); }
.sc-en { font-size: var(--fs-2xs); font-style: italic; color: var(--text-3); display: block; }
.sc-line { font-size: var(--fs-xs); color: var(--text-2); line-height: 1.65; margin: 8px 0; }
.sc-roots {
  font-size: var(--fs-2xs); letter-spacing: 1.8px; color: var(--text-3);
  border-top: 1px solid var(--line); padding-top: 8px; margin-bottom: 6px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
/* 章节列表设上限:十来章的书别把卡撑到 350+,侧放后卡越矮压到的邻书越少 */
.sc-chapters { list-style: none; margin: 0; padding: 0 2px 0 0; display: flex; flex-direction: column; gap: 2px;
  max-height: 168px; overflow-y: auto; overscroll-behavior: contain; scrollbar-width: thin; }
.sc-chapters::-webkit-scrollbar { width: 5px; }
.sc-chapters::-webkit-scrollbar-thumb { background: var(--line-strong); border-radius: 3px; }
.sc-ch {
  display: flex; align-items: center; gap: 9px; width: 100%;
  padding: 6px 8px; border-radius: 8px; font-size: var(--fs-xs); color: var(--text-2);
  text-align: left; transition: background 0.2s, color 0.2s;
}
.sc-ch:hover { background: color-mix(in srgb, var(--accent) 10%, transparent); color: var(--text); }
.ch-dot { flex: 0 0 auto; width: 5px; height: 5px; border-radius: 50%; background: var(--text-3); opacity: 0.5; }
.sc-ch.lit .ch-dot { background: var(--gold); box-shadow: 0 0 6px color-mix(in srgb, var(--gold) 60%, transparent); }
.ch-no { font-size: var(--fs-2xs); color: var(--text-3); width: 16px; }
.ch-title { flex: 1; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.sc-ch.lit .ch-title { color: var(--text); }
.ch-state { font-size: var(--fs-2xs); color: var(--text-3); letter-spacing: 1px; }
.sc-ch.lit .ch-state { color: var(--gold-dim); }
.sc-open { width: 100%; justify-content: center; margin-top: 10px; }
/* 纸书指南卡:双击摊开用法的提示签 */
.sc-guide-tip {
  margin-top: 10px; padding: 7px 10px; border-radius: 8px; text-align: center;
  font-size: var(--fs-2xs); letter-spacing: 0.16em; color: var(--accent);
  background: color-mix(in srgb, var(--accent) 8%, transparent);
  border: 1px dashed color-mix(in srgb, var(--accent) 32%, transparent);
}
[data-theme='light'] .sc-ch.lit .ch-dot { box-shadow: none; }
</style>
