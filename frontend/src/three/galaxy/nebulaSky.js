// 展厅「01 · WebGL 星系」(v1 原样)+「03 · Vanta.js BIRDS」GPGPU 原版移植(v3)
// v1:六千粒子三旋臂星盘垫在词族环下(展厅公式/配色逐行原样,适配三处:
//     尺度×30 / fog:false / 自转按 dt 计时)
// v3:v1 的 700 颗背景星壳(天上的小球)按用户反馈换成天上飞的鸟——
//     直接移植 Vanta.js BIRDS v0.5.24 桌面端 GPGPU 路径(原全屏覆盖层版同源,
//     现在专属于开场幕:聚到镜头前引出正文,播完退役):boids 三规则在 GPU 计算纹理里跑,鸟是
//     9 顶点 3 三角(身体+双翅),翅尖顶点在着色器里扇动,配色 varianceGradient,
//     鼠标是捕食者(150 半径内驱散鸟群)。
//     集成适配只有五处,全部在落点注释:①光标是真 3D 世界点(删 dir.z=0)
//     ②鸟群中心抬到天幕 y=140(相机可达上限约 y 90) ③初值 y 预聚天幕带
//     ④lowEnd 用 8×8 计算纹理 +quantity 2 ⑤frustumCulled=false(位置来自
//     纹理,包围球不随鸟走)
import * as THREE from 'three'
import { GPUComputationRenderer } from 'three/addons/misc/GPUComputationRenderer.js'

function softDot() {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  gr.addColorStop(0, 'rgba(255,255,255,1)')
  gr.addColorStop(0.35, 'rgba(255,255,255,0.55)')
  gr.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = gr
  g.fillRect(0, 0, 64, 64)
  return new THREE.CanvasTexture(c)
}

// ===== Vanta.js BIRDS v0.5.24 GPGPU 路径(源:assets/vendor/vanta.birds.min.js)=====

// vanta getNewCol · colorMode "varianceGradient" 原式结构保留,配色换血:
// 原版默认 color1=0xff0000/color2=0xd1ff → 满屏亮红粉鸟,在暗厅里刺眼(用户:太亮)。
// 改成星系盘自己的两端色做 lerp——金芯 #ffc98f ↔ 冰蓝臂 #5d7bff,鸟群与星盘
// 同一血缘,再整体 ×0.46 压进夜幕:远看是一群暖金/冷蓝的星尘候鸟,不抢戏
function vantaColor() {
  const gold = new THREE.Color(0xffc98f), blue = new THREE.Color(0x5d7bff)
  const c = gold.clone().lerp(blue, Math.random())
  c.multiplyScalar(0.46)
  return c
}

// vanta 鸟几何(9 顶点 3 三角:竖直身体 + 左右翅),wingSpan/birdSize 是展厅 03
// 的入参(26 / 1.1);reference/birdVertex 按原版循环填——含原版逐三角采样的
// 行为,开场鸟群幕长什么样,这里就是什么样
function vantaBirdGeometry({ wingSpan, birdSize, quantity }) {
  const z = Math.pow(2, quantity) // quantity 3 → 纹理 8,鸟 64 只
  const S = z * z
  const tri = 3 * S
  const vert = 3 * tri
  const pos = new Float32Array(vert * 3)
  const col = new Float32Array(vert * 3)
  const ref = new Float32Array(vert * 2)
  const bv = new Float32Array(vert)
  let li = 0
  const push = (...a) => { for (const v of a) pos[li++] = v }
  const c2 = wingSpan, d = birdSize
  for (let b = 0; b < S; b++) {
    push(0, -0, -20 * d, 0, 4 * d, -20 * d, 0, 0, 30 * d) // 身体(头 +z 尾 -z)
    push(0, 0, -15 * d, -c2 * d, 0, 0, 0, 0, 15 * d)      // 左翅
    push(0, 0, 15 * d, c2 * d, 0, 0, 0, 0, -15 * d)       // 右翅
  }
  for (let l = 0; l < vert; l++) {
    const t = ~~(l / 3)
    const c = vantaColor()
    col[l * 3] = c.r; col[l * 3 + 1] = c.g; col[l * 3 + 2] = c.b
    ref[l * 2] = (t % z) / z
    ref[l * 2 + 1] = ~~(t / z) / z
    bv[l] = l % 9
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  geo.setAttribute('birdColor', new THREE.BufferAttribute(col, 3))
  geo.setAttribute('reference', new THREE.BufferAttribute(ref, 2))
  geo.setAttribute('birdVertex', new THREE.BufferAttribute(bv, 1))
  geo.scale(0.2, 0.2, 0.2) // vanta 原版的整体 0.2 缩放
  return geo
}

// vanta textureVelocity 计算着色器(boids 三规则 + 捕食者驱散 + 向心聚集)
const VEL_SHADER = `
uniform float time;
uniform float testing;
uniform float delta; // about 0.016
uniform float separationDistance; // 20
uniform float alignmentDistance; // 40
uniform float cohesionDistance;
uniform float speedLimit;
uniform float freedomFactor;
uniform vec3 predator;
uniform vec3 flockCenter;

const float width = resolution.x;
const float height = resolution.y;

const float PI = 3.141592653589793;
const float PI_2 = PI * 2.0;

float zoneRadius = 40.0;
float zoneRadiusSquared = 1600.0;

float separationThresh = 0.45;
float alignmentThresh = 0.65;

const float UPPER_BOUNDS = BOUNDS;
const float LOWER_BOUNDS = -UPPER_BOUNDS;

float rand(vec2 co){
  return fract(sin(dot(co.xy ,vec2(12.9898,78.233))) * 43758.5453);
}

void main() {

  zoneRadius = separationDistance + alignmentDistance + cohesionDistance;
  separationThresh = separationDistance / zoneRadius;
  alignmentThresh = ( separationDistance + alignmentDistance ) / zoneRadius;
  zoneRadiusSquared = zoneRadius * zoneRadius;

  vec2 uv = gl_FragCoord.xy / resolution.xy;
  vec3 birdPosition, birdVelocity;

  vec3 selfPosition = texture2D( texturePosition, uv ).xyz;
  vec3 selfVelocity = texture2D( textureVelocity, uv ).xyz;

  float dist;
  vec3 dir; // direction
  float distSquared;

  float separationSquared = separationDistance * separationDistance;
  float cohesionSquared = cohesionDistance * cohesionDistance;

  float f;
  float percent;

  vec3 velocity = selfVelocity;

  float limit = speedLimit;

  dir = predator * UPPER_BOUNDS - selfPosition;
  // 适配①:删掉原版这行 dir.z = 0.——vanta 的鼠标是 2D 屏幕点,圣殿的光标
  // 是真 3D 世界坐标,驱散按完整三维距离算
  dist = length( dir );
  distSquared = dist * dist;

  float preyRadius = 150.0;
  float preyRadiusSq = preyRadius * preyRadius;

  // move birds away from predator
  if (dist < preyRadius) {

    f = ( distSquared / preyRadiusSq - 1.0 ) * delta * 100.;
    velocity += normalize( dir ) * f;
    limit += 5.0;
  }

  // Attract flocks to the center
  // 适配②:中心改 uniform(默认 0,140,0 天幕带——圣殿相机够不到的高度;
  // 开场幕由引擎驱动:聚到镜头前引出正文,播完升回天幕并整体退役)
  vec3 central = flockCenter;
  dir = selfPosition - central;
  dist = length( dir );

  dir.y *= 2.5;
  velocity -= normalize( dir ) * delta * 5.;

  for (float y=0.0;y<height;y++) {
    for (float x=0.0;x<width;x++) {

      vec2 ref = vec2( x + 0.5, y + 0.5 ) / resolution.xy;
      birdPosition = texture2D( texturePosition, ref ).xyz;

      dir = birdPosition - selfPosition;
      dist = length(dir);

      if (dist < 0.0001) continue;

      distSquared = dist * dist;

      if (distSquared > zoneRadiusSquared ) continue;

      percent = distSquared / zoneRadiusSquared;

      if ( percent < separationThresh ) { // low

        // Separation - Move apart for comfort
        f = (separationThresh / percent - 1.0) * delta;
        velocity -= normalize(dir) * f;

      } else if ( percent < alignmentThresh ) { // high

        // Alignment - fly the same direction
        float threshDelta = alignmentThresh - separationThresh;
        float adjustedPercent = ( percent - separationThresh ) / threshDelta;

        birdVelocity = texture2D( textureVelocity, ref ).xyz;

        f = ( 0.5 - cos( adjustedPercent * PI_2 ) * 0.5 + 0.5 ) * delta;
        velocity += normalize(birdVelocity) * f;

      } else {

        // Attraction / Cohesion - move closer
        float threshDelta = 1.0 - alignmentThresh;
        float adjustedPercent = ( percent - alignmentThresh ) / threshDelta;

        f = ( 0.5 - ( cos( adjustedPercent * PI_2 ) * -0.5 + 0.5 ) ) * delta;

        velocity += normalize(dir) * f;

      }
    }
  }

  // Speed Limits
  if ( length( velocity ) > limit ) {
    velocity = normalize( velocity ) * limit;
  }

  gl_FragColor = vec4( velocity, 1.0 );

}`

// vanta texturePosition 计算着色器(积分 + 翅膀相位:飞得越快扇得越快)
const POS_SHADER = `
uniform float time;
uniform float delta;

void main() {

  vec2 uv = gl_FragCoord.xy / resolution.xy;
  vec4 tmpPos = texture2D( texturePosition, uv );
  vec3 position = tmpPos.xyz;
  vec3 velocity = texture2D( textureVelocity, uv ).xyz;

  float phase = tmpPos.w;

  phase = mod( ( phase + delta +
    length( velocity.xz ) * delta * 3. +
    max( velocity.y, 0.0 ) * delta * 6. ), 62.83 );

  gl_FragColor = vec4( position + velocity * delta * 15. , phase );

}`

// vanta 鸟渲染着色器(翅尖扇动 + 按速度定向)
const BIRD_VERT = `
attribute vec2 reference;
attribute float birdVertex;

attribute vec3 birdColor;

uniform sampler2D texturePosition;
uniform sampler2D textureVelocity;

varying vec4 vColor;
varying float z;

uniform float time;
uniform float birdSize;

void main() {

  vec4 tmpPos = texture2D( texturePosition, reference );
  vec3 pos = tmpPos.xyz;
  vec3 velocity = normalize(texture2D( textureVelocity, reference ).xyz);

  vec3 newPosition = position;

  if ( birdVertex == 4.0 || birdVertex == 7.0 ) {
    // flap wings
    newPosition.y = sin( tmpPos.w ) * 5. * birdSize;
  }

  newPosition = mat3( modelMatrix ) * newPosition;

  velocity.z *= -1.;
  float xz = length( velocity.xz );
  float xyz = 1.;
  float x = sqrt( 1. - velocity.y * velocity.y );

  float cosry = velocity.x / xz;
  float sinry = velocity.z / xz;

  float cosrz = x / xyz;
  float sinrz = velocity.y / xyz;

  mat3 maty =  mat3(
    cosry, 0, -sinry,
    0    , 1, 0     ,
    sinry, 0, cosry
  );

  mat3 matz =  mat3(
    cosrz , sinrz, 0,
    -sinrz, cosrz, 0,
    0     , 0    , 1
  );

  newPosition =  maty * matz * newPosition;
  newPosition += pos;
  z = newPosition.z;

  vColor = vec4( birdColor, 1.0 );
  gl_Position = projectionMatrix *  viewMatrix  * vec4( newPosition, 1.0 );
}`

// vanta 鸟片元着色器(远暗近亮的深度层次;0.2 亮度地板压到 0.08——
// 原地板把每只鸟垫成半透明白,是"太亮"的另一半来源)
const BIRD_FRAG = `
varying vec4 vColor;
varying float z;
uniform vec3 color;
void main() {
  // Fake colors for now
  float rr = 0.08 + ( 1000. - z ) / 1000. * vColor.x;
  float gg = 0.08 + ( 1000. - z ) / 1000. * vColor.y;
  float bb = 0.08 + ( 1000. - z ) / 1000. * vColor.z;
  gl_FragColor = vec4( rr, gg, bb, 1. );
}`

// 展厅 03 的入参原值:BIRDS({ birdSize: 1.1, wingSpan: 26, speedLimit: 5,
// separation: 22 })(alignment/cohesion 用 vanta 默认 20)
const FLOCK_OPTS = { birdSize: 1.1, wingSpan: 26, speedLimit: 5, separation: 22, alignment: 20, cohesion: 20 }

function createVantaFlock(renderer, { lowEnd = false, center = [0, 140, 0], spread = 100 } = {}) {
  const BOUNDS = 800   // vanta 原值:世界 ±400,捕食者半径 150
  // 适配④:lowEnd 用 8×8 计算纹理(64 boid)+ quantity 2(16 只);
  // 桌面端与 vanta 一致:32×32(1024 boid,只显示 64 只的三角)
  const TEX = lowEnd ? 8 : 32
  const quantity = lowEnd ? 2 : 3

  const gpu = new GPUComputationRenderer(TEX, TEX, renderer)

  // 初始纹理:vanta 原式(位置随机立方 / 速度 ±5);
  // 适配③:位置预聚到 center±spread(默认天幕带 y=140,相机够不到,近距鸟
  // 不会糊屏;开场幕传开场中心,鸟群第一帧就在镜头里)
  const posTex = gpu.createTexture()
  const velTex = gpu.createTexture()
  {
    const a = posTex.image.data
    const v = velTex.image.data
    for (let i = 0; i < a.length; i += 4) {
      a[i] = center[0] + (Math.random() - 0.5) * spread * 2
      a[i + 1] = center[1] + (Math.random() - 0.5) * spread
      a[i + 2] = center[2] + (Math.random() - 0.5) * spread * 2
      a[i + 3] = 1
      v[i] = (Math.random() - 0.5) * 10
      v[i + 1] = (Math.random() - 0.5) * 10
      v[i + 2] = (Math.random() - 0.5) * 10
      v[i + 3] = 1
    }
  }

  const velVar = gpu.addVariable('textureVelocity', VEL_SHADER, velTex)
  const posVar = gpu.addVariable('texturePosition', POS_SHADER, posTex)
  gpu.setVariableDependencies(velVar, [posVar, velVar])
  gpu.setVariableDependencies(posVar, [posVar, velVar])

  const velU = velVar.material.uniforms
  const posU = posVar.material.uniforms
  posU.time = { value: 0 }
  posU.delta = { value: 0 }
  velU.time = { value: 1 }
  velU.delta = { value: 0 }
  velU.testing = { value: 1 }
  velU.separationDistance = { value: FLOCK_OPTS.separation }
  velU.alignmentDistance = { value: FLOCK_OPTS.alignment }
  velU.cohesionDistance = { value: FLOCK_OPTS.cohesion }
  velU.speedLimit = { value: FLOCK_OPTS.speedLimit }
  velU.freedomFactor = { value: 1 }
  velU.predator = { value: new THREE.Vector3() }
  velU.flockCenter = { value: new THREE.Vector3(center[0], center[1], center[2]) }
  velVar.material.defines.BOUNDS = BOUNDS.toFixed(2) // vanta 原式
  velVar.wrapS = velVar.wrapT = posVar.wrapS = posVar.wrapT = THREE.RepeatWrapping

  const err = gpu.init()
  if (err) throw new Error(err) // float 纹理不支持等:让外层 try/catch 静默降级

  const birdGeo = vantaBirdGeometry({ ...FLOCK_OPTS, quantity })
  const birdU = {
    color: { value: new THREE.Color(16720384) }, // vanta 原值
    texturePosition: { value: null },
    textureVelocity: { value: null },
    time: { value: 1 },
    delta: { value: 0 },
    birdSize: { value: FLOCK_OPTS.birdSize },
  }
  const birdMat = new THREE.ShaderMaterial({
    uniforms: birdU,
    vertexShader: BIRD_VERT,
    fragmentShader: BIRD_FRAG,
    side: THREE.DoubleSide,
  })
  const mesh = new THREE.Mesh(birdGeo, birdMat)
  mesh.rotation.y = Math.PI / 2 // vanta 原式的朝向补偿
  mesh.matrixAutoUpdate = false
  mesh.updateMatrix()
  mesh.frustumCulled = false // 适配⑤:位置来自计算纹理,包围球不随鸟走

  const group = new THREE.Group()
  group.add(mesh)

  const predator = new THREE.Vector3()
  function update(dt, pointerWorld) {
    const d = Math.min(dt, 1)
    const now = performance.now()
    posU.time.value = now; posU.delta.value = d
    velU.time.value = now; velU.delta.value = d
    birdU.time.value = now; birdU.delta.value = d
    // vanta 原语义:鼠标 = 捕食者(shader 内 ×BOUNDS 还原世界坐标,150 内驱散);
    // 光标离开 → 抛到 1e4(无穷远,不驱散)
    if (pointerWorld) predator.set(pointerWorld.x / BOUNDS, pointerWorld.y / BOUNDS, pointerWorld.z / BOUNDS)
    else predator.set(1e4, 1e4, 1e4)
    velU.predator.value.copy(predator)
    gpu.compute()
    birdU.texturePosition.value = gpu.getCurrentRenderTarget(posVar).texture
    birdU.textureVelocity.value = gpu.getCurrentRenderTarget(velVar).texture
  }

  function dispose() {
    gpu.dispose?.()
    birdGeo.dispose()
    birdMat.dispose()
  }

  // 开场幕驱动:聚集中心由外部接管(开场聚到镜头前,播完升回天幕带)
  function setCenter(x, y, z) { velU.flockCenter.value.set(x, y, z) }

  return { group, update, dispose, setCenter }
}

// ===== 圣殿装配:星系盘(v1 原样)+ 鸟群(星壳小球的替身) =====
export function createNebulaSky({ lowEnd = false, renderer = null } = {}) {
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
  const root = new THREE.Group()
  const dotTex = softDot()
  let rotSpeed = 0.096 // 展厅 0.0016/帧 @60fps
  if (reduceMotion) rotSpeed = 0
  const SCALE = 30
  const COUNT = (lowEnd || reduceMotion) ? 2600 : 6000
  const pos = new Float32Array(COUNT * 3)
  const col = new Float32Array(COUNT * 3)
  const cIn = new THREE.Color('#ffc98f'), cOut = new THREE.Color('#5d7bff')
  const rnd = (m) => (Math.random() - 0.5) * m
  for (let i = 0; i < COUNT; i++) {
    const r = Math.pow(Math.random(), 1.5) * 5.6
    const branch = ((i % 3) / 3) * Math.PI * 2
    const spin = r * 0.9
    const spread = 0.55 + r * 0.12
    const i3 = i * 3
    pos[i3] = (Math.cos(branch + spin) * r + rnd(spread)) * SCALE
    pos[i3 + 1] = rnd(0.5) * (1 - r / 7) * SCALE
    pos[i3 + 2] = (Math.sin(branch + spin) * r + rnd(spread)) * SCALE
    const c = cIn.clone().lerp(cOut, Math.min(1, r / 5.6))
    col[i3] = c.r; col[i3 + 1] = c.g; col[i3 + 2] = c.b
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3))
  const galaxy = new THREE.Points(geo, new THREE.PointsMaterial({
    size: 0.7, map: dotTex, vertexColors: true, transparent: true,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  }))
  const disc = new THREE.Group()
  disc.position.y = -30
  disc.rotation.x = 0.16
  disc.add(galaxy)
  root.add(disc)

  // 天上的鸟群:GPGPU 原版移植(失败静默降级,星系盘不受影响)
  let flock = null
  if (!reduceMotion && renderer) {
    try { flock = createVantaFlock(renderer, { lowEnd }) } catch { flock = null }
  }
  if (flock) root.add(flock.group)

  return {
    group: root,
    hasFlock: !!flock,
    update(dt, pointerWorld) {
      galaxy.rotation.y += rotSpeed * dt
      flock?.update(dt, pointerWorld)
    },
    // 聚集中心(开场幕引出用):默认已驻天幕带
    setFlockCenter(x, y, z) { flock?.setCenter(x, y, z) },
    // 开场幕:把鸟群重新聚到指定中心(原群退役重建,第一帧就在镜头里);
    // 不可用(GPGPU 不支持)返回 false,引擎据此跳过鸟群幕
    restartFlock(cx, cy, cz, spread = 120) {
      if (reduceMotion || !renderer) return false
      if (flock) { root.remove(flock.group); flock.dispose(); flock = null }
      try {
        flock = createVantaFlock(renderer, { lowEnd, center: [cx, cy, cz], spread })
        root.add(flock.group)
        return true
      } catch { flock = null; return false }
    },
    // 开场播完:鸟群整体退役(用户:开场用了就不用常驻展示)
    retireFlock() {
      if (!flock) return
      root.remove(flock.group)
      flock.dispose()
      flock = null
    },
    dispose() {
      root.removeFromParent?.()
      geo.dispose()
      galaxy.material.dispose()
      dotTex.dispose()
      flock?.dispose()
    },
  }
}
