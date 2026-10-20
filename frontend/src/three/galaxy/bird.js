// WordBird — 每颗词 = 一只低模鸟(用户:小方块改成鸟的样子,可以点)
// 一族一几何(按家族色缓存共享,全库词只占 40 份几何),身体/头/喙/尾/双翼合并成
// 一个 BufferGeometry:整鸟一次 draw call,翼面顶点带 aWing 属性,扇翅走
// MeshStandardMaterial 的 onBeforeCompile 顶点注入(与 atmosphere 的注入链式
// 共存——applyFlap 包住已存在的钩子再补自己的),状态机(哑光素坯→抛光)照旧
// 由 planet.applyStateStyle 消费,选中/悬停/只看已点亮/柔晕全部原样保留。
import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { LAMP } from './sculpture.js'

// 翼标记属性名(0=身体,1=翼):扇翅幅度乘 (0.18 + |x|),翼尖摆幅大于翼根
const WING_ATTR = 'aWing'

// 单件鸟几何:合并 6 个低模件。partColor 走顶点色(身体=家族色,翼亮一档,
// 尾暗一档,喙=展厅灯芯暖 LAMP),材质 color 留白让顶点色直出。
// 家族色是"亮银带"(HSL 亮度 0.66~0.79),直接当羽毛色整群晃眼(用户:太亮);
// 单靠 lerp 压不进夜幕:先往暮色钢蓝 #12182a 拉 0.42,再把 HSL 明度钳到 0.46
// (夜航带)——色相身份不变,亮度落到中灰以下,像入夜的候鸟。rim 也取同一基色
const NIGHT = new THREE.Color(0x12182a)
export function nightBase(familyColorHex) {
  const c = new THREE.Color(familyColorHex).lerp(NIGHT, 0.42)
  const hsl = { h: 0, s: 0, l: 0 }
  c.getHSL(hsl)
  if (hsl.l > 0.46) c.setHSL(hsl.h, hsl.s * 0.85, 0.46)
  return c
}
function buildBirdGeometry(familyColorHex) {
  const base = nightBase(familyColorHex)
  const wingC = base.clone().lerp(new THREE.Color(0xffffff), 0.14)
  const tailC = base.clone().lerp(new THREE.Color(0x0a0d14), 0.42)
  const beakC = new THREE.Color(LAMP)

  function part(geo, colorHex, isWing) {
    geo.deleteAttribute('uv') // 各件统一属性集(position/normal/color/aWing)
    const n = geo.attributes.position.count
    const col = new Float32Array(n * 3)
    const c = new THREE.Color(colorHex)
    for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3))
    geo.setAttribute(WING_ATTR, new THREE.BufferAttribute(new Float32Array(n).fill(isWing ? 1 : 0), 1))
    return geo
  }

  // 身体:椭球,头朝 +z
  const body = new THREE.SphereGeometry(0.42, 12, 9)
  body.scale(0.92, 0.8, 1.28)
  // 头
  const head = new THREE.SphereGeometry(0.26, 12, 9)
  head.translate(0, 0.34, 0.44)
  // 喙:锥尖转向 +z
  const beak = new THREE.ConeGeometry(0.078, 0.24, 7)
  beak.rotateX(Math.PI / 2)
  beak.translate(0, 0.325, 0.72)
  // 尾:薄板,尾端上翘
  const tail = new THREE.BoxGeometry(0.27, 0.05, 0.5)
  tail.rotateX(-0.45)
  tail.translate(0, 0.16, -0.66)
  // 双翼:薄板后掠,翼根贴身;扇翅只认 aWing 顶点
  const wingL = new THREE.BoxGeometry(0.78, 0.042, 0.4)
  wingL.rotateY(-0.34); wingL.rotateZ(0.1); wingL.translate(-0.52, 0.17, -0.02)
  const wingR = new THREE.BoxGeometry(0.78, 0.042, 0.4)
  wingR.rotateY(0.34); wingR.rotateZ(-0.1); wingR.translate(0.52, 0.17, -0.02)

  const geo = mergeGeometries([
    part(body, base.getHex(), false),
    part(head, base.getHex(), false),
    part(beak, beakC.getHex(), false),
    part(tail, tailC.getHex(), false),
    part(wingL, wingC.getHex(), true),
    part(wingR, wingC.getHex(), true),
  ], false)
  geo.userData.shared = true // 家族内共享,dispose 时不得释放
  return geo
}

// 家族色 → 共享几何缓存(40 族 = 40 份几何,全库词复用)
const _geoCache = new Map()
export function makeBirdGeometry(familyColorHex) {
  const key = familyColorHex
  if (!_geoCache.has(key)) _geoCache.set(key, buildBirdGeometry(familyColorHex))
  return _geoCache.get(key)
}

// 扇翅注入:包住材质上已有的 onBeforeCompile(如 atmosphere 的 rim),再补
// 自己的 uniform + 顶点位移。返回 uniforms 引用供每帧喂时间/幅度/频率。
export function applyFlap(material, { speed = 4.2, amp = 0.26 } = {}) {
  const uniforms = {
    uFlapTime: { value: 0 },
    uFlapPhase: { value: Math.random() * Math.PI * 2 },
    uFlapSpeed: { value: speed },
    uFlapAmp: { value: amp },
  }
  const prev = material.onBeforeCompile ? material.onBeforeCompile.bind(material) : null
  material.onBeforeCompile = (shader, renderer) => {
    prev?.(shader, renderer)
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader =
      `attribute float ${WING_ATTR};
       uniform float uFlapTime;
       uniform float uFlapPhase;
       uniform float uFlapSpeed;
       uniform float uFlapAmp;
      ` + shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         transformed.y += sin(uFlapSpeed * uFlapTime + uFlapPhase) * uFlapAmp * ${WING_ATTR} * (0.18 + abs(transformed.x));`,
      )
  }
  material.needsUpdate = true
  return uniforms
}
