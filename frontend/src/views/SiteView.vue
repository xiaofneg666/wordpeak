<script setup>
// 官网首页(SiteView):双场景电影式开场 —— 结构对齐用户参考稿
//   图一(开场):3D 词之心塔+轨道词星球(introScene.js 复用圣殿件),左侧压暗,白色大标题区
//   转场:纯镜头推近(无任何光效)→ 推到塔冠跟前同机位硬切 → 图二从末机位缓落回巡航(一镜穿塔)
//   图二(首页):全幅 Hero(同款 3D 宇宙巡航,文案浮于画面之上) + 六大训练舱(6 列大图卡)
//             + 学习航线(真实航线 API) + 核心功能(浅色区 4 列) + 页脚(真实统计)
// 开场只在会话内首次播放(sessionStorage),跳过/返回/降级路径全部直进图二。
import { ref, computed, onMounted, onBeforeUnmount, onActivated, onDeactivated, nextTick, watch } from 'vue'
import { useUniverse, SESSION_MODES } from '../stores/universe'

const store = useUniverse()
const rootEl = ref(null)
const canvasEl = ref(null)

// ===== 阶段机 =====
const introOn = ref(true)      // 图一场景在场
const introLeaving = ref(false) // 文案左移淡出(转场中)
const homeOn = ref(false)       // 图二 DOM 在场
const heroAnim = ref(false)     // 图二入场编排开关
const sceneReady = ref(false)   // 3D 就绪(canvas 淡入)
const sceneFailed = ref(false)  // WebGL 不可用 → CSS 静态降级
const hoverWord = ref(null)     // 悬停词卡 { word, ipa, meaning, x, y }

const reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
const isMobile = !!(window.matchMedia && window.matchMedia('(max-width: 720px)').matches)
const lowEnd = isMobile
  || (navigator.hardwareConcurrency || 8) <= 4
  || (navigator.deviceMemory || 8) <= 3

let scene = null
let timers = []
function later(fn, ms) { timers.push(setTimeout(fn, ms)) }
function clearTimers() { timers.forEach(clearTimeout); timers = [] }

const INTRO_SEEN = 'wv_site_intro'
const INTRO_DWELL = 4000 // 开场停留:看得到塔与词星球,又不至于久等

// 展示词:优先挑有画面感的真词(在知识库里真实存在),不足 12 颗用已学词补齐
const SHOWCASE = ['dream', 'explore', 'future', 'learn', 'freedom', 'wonder', 'star',
  'light', 'hope', 'journey', 'moon', 'galaxy', 'brave', 'shine', 'create', 'sky']
function pickIntroWords() {
  const pool = store.words || []
  const byText = new Map(pool.map((w) => [String(w.word || '').toLowerCase(), w]))
  const picked = []
  for (const s of SHOWCASE) { const w = byText.get(s); if (w) picked.push(w) }
  if (picked.length < 12) {
    for (const w of pool) {
      if (picked.length >= 12) break
      if (!picked.includes(w)) picked.push(w)
    }
  }
  return picked.slice(0, 12)
}

async function mountScene() {
  if (reduceMotion || sceneFailed.value) return
  await nextTick()
  if (!canvasEl.value || scene || disposed) return
  try {
    const { IntroScene } = await import('../three/landing/introScene.js')
    if (disposed || !canvasEl.value) return
    scene = new IntroScene(canvasEl.value, {
      words: pickIntroWords(),
      lowEnd,
      onHover: (w) => { if (!w) hoverWord.value = null },
      onHoverMove: (w, x, y) => {
        hoverWord.value = { word: w.word, ipa: w.ipa, meaning: w.meaning, root: w.root, x, y }
      },
      onPick: (w) => { if (w?.id != null) store.openWordInGalaxy(w.id) },
      onReady: () => { sceneReady.value = true },
    })
    later(() => { if (introOn.value && !entering) enterUniverse() }, INTRO_DWELL)
  } catch {
    sceneFailed.value = true // 无 WebGL:留在 CSS 星空,文案/按钮照常可用
  }
}

let entering = false
function enterUniverse() {
  if (entering || !introOn.value) return
  entering = true
  clearAuto()
  try { sessionStorage.setItem(INTRO_SEEN, '1') } catch {}
  introLeaving.value = true
  scene?.beginTransition()
  // 编排(纯推镜转场,全程无光效):
  //   0ms     文案左移淡出;镜头向塔冠星芒加速推近(1.3s,fov 不动,画面被塔图越占越满)
  //   900ms   图二先挂到视口下方(锁滚动,不可见),首页 3D 幕后预热(纹理全在缓存,秒就绪)
  //   1330ms 推近已在 1300ms 走完并定格(末机位)→ 拆开场;图二顶上,首页 3D 从同一末机位
  //           起、增益缓升地回落巡航 —— 硬切点两侧画面严格同构,读作同一镜头穿过了塔冠
  //   1370ms 首页文案/导航分层浮现(与镜头回落同一拍);首屏以下区块随后再淡入
  later(() => { homeOn.value = true; heroPrewarm.value = true; ensureHeroScene() }, 900)
  later(() => {
    scene?.dispose(); scene = null
    introOn.value = false
    hoverWord.value = null
    heroScene?.resume() // 幕下预热的 3D 当帧接管画面,不等 IO 回调(免去切点后 1-3 帧 CSS 星空闪现)
  }, 1330)
  later(() => { heroAnim.value = true }, 1370)
  later(() => { introLeaving.value = false; entering = false }, 3000)
}

function skipIntro() {
  if (!introOn.value) return
  clearAuto()
  clearTimers()
  try { sessionStorage.setItem(INTRO_SEEN, '1') } catch {}
  scene?.dispose(); scene = null
  introOn.value = false
  hoverWord.value = null
  homeOn.value = true
  heroAnim.value = true
  entering = false
  later(() => { ensureHeroScene() }, 350)
}
let autoT = 0
function clearAuto() { clearTimeout(autoT) }
function armAuto() {
  clearAuto()
  if (!reduceMotion && introOn.value) autoT = setTimeout(enterUniverse, INTRO_DWELL)
}

// 图一顶栏:锚点项入内后滚动到位;领地项直跳(跳过开场是明确意图)
function introNav(item) {
  if (item.view) { skipIntro(); store.setView(item.view); return }
  if (item.anchor) {
    if (introOn.value) { skipIntro() }
    later(() => { document.getElementById(item.anchor)?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth' }) }, 60)
  }
}

// ===== 图二:导航 / 主题 / 搜索 =====
const THEMES = ['dark', 'light', 'violet', 'catppuccin']
const themeLabel = { dark: '深空', light: '宣纸', violet: '紫罗兰', catppuccin: '暖夜' }
function cycleTheme() {
  const cur = store.settings.theme || 'dark'
  store.settings.theme = THEMES[(THEMES.indexOf(cur) + 1) % THEMES.length]
}
function openSearch() { window.dispatchEvent(new CustomEvent('wv:toggleCommand')) }

const NAV = [
  { label: '首页', act: () => scrollToTop() },
  { label: '学习航线', act: () => goto('#site-routes') },
  { label: '词汇星系', act: () => store.setView('galaxy') },
  { label: '轨道书库', act: () => store.setView('bookshelf') },
  { label: '训练舱', act: () => goto('#site-modules') },
  { label: '个人中心', act: () => store.setView('settings') },
]
function goto(sel) {
  document.querySelector(sel)?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth' })
}
function scrollToTop() { rootEl.value?.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' }) }

// ===== 真实数据 =====
const learnedCount = computed(() =>
  store.stats?.learned ?? Object.values(store.states).filter((s) => !s.is_new).length)
const constellationPct = computed(() =>
  Math.max(1, Math.round((learnedCount.value / Math.max(1, store.words.length)) * 100)))

// 推荐航线:与观星台同一启发式(深夜→快闪;周末+有基础→远征;默认标准)
const recommended = computed(() => {
  const h = new Date().getHours()
  if (h >= 22 || h < 6) return 'cruise'
  const dow = new Date().getDay()
  if (learnedCount.value >= 60 && (dow === 0 || dow === 6)) return 'expedition'
  return 'route'
})
function launch(mode) {
  if (store.session) store.sessionGo(store.session.step)
  else store.startSession(mode || recommended.value)
}

// 六大训练舱(全部真实可进入的领地,计数取自真实数据;art 渐变对齐参考稿配色)
const MODULES = computed(() => [
  { key: 'phonetics', n: '01', zh: '发音舱', latin: 'PHONETICS POD', to: 'phonetics', art: 'art-1',
    chip: `${store.phonemes.length || 48} 个音标 · 口型示范`,
    desc: '每个国际音标一颗专属星球,最小对立词帮你把差别听出来。' },
  { key: 'grammar', n: '02', zh: '语法机械城', latin: 'MACHINE CITY', to: 'grammar', art: 'art-2',
    chip: `${store.grammar.length || 21} 个语法点 · 189 道练习`,
    desc: '齿轮咬合式闯关:每拧动一个语法点,机械城就亮起一格。' },
  { key: 'listening', n: '03', zh: '回声谷', latin: 'ECHO CANYON', to: 'listening', art: 'art-3',
    chip: `${store.passages.length || 12} 篇语料 · 波形可视化`,
    desc: '语料听写与波形回放,山谷会把你的每一次发声弹回来。' },
  { key: 'speaking', n: '04', zh: '口语竞技场', latin: 'SPEAKING ARENA', to: 'speaking', art: 'art-4',
    chip: '跟读评分 · 星级反馈',
    desc: '对着星幕跟读,系统打分,星数入账——今日挑战每天一局。' },
  { key: 'reading', n: '05', zh: '阅读号列车', latin: 'READING RAILS', to: 'reading', art: 'art-5',
    chip: '分级阅读 · WPM 速度计',
    desc: '列车开到哪读到哪,速度仪表实时显示你的每分钟词数。' },
  { key: 'writing', n: '06', zh: '写作工坊', latin: 'WRITING WORKSHOP', to: 'writing', art: 'art-6',
    chip: '造句练习 · 作文提升',
    desc: '从用今天的词造一个句子开始,一路写到成文,AI 带回暖批注。' },
])

const ROUTE_STYLE = {
  cruise: { symbol: 'ϟ', cls: 'route-cyan' },
  route: { symbol: '◎', cls: 'route-blue' },
  expedition: { symbol: '✦', cls: 'route-purple' },
}
const ROUTES = Object.entries(SESSION_MODES).map(([key, m]) => ({ key, ...m, ...ROUTE_STYLE[key] }))

const FEATURES = computed(() => [
  { key: 'galaxy', zh: '词汇星殿', symbol: '✧', cls: 'feature-galaxy', to: 'galaxy',
    desc: `${store.words.length || 888} 颗词汇星球 · 词根家族` },
  { key: 'library', zh: '轨道书库', symbol: '▤', cls: 'feature-library', to: 'bookshelf',
    desc: `${store.books.length || 4} 本英文原著 · 分章阅读` },
  { key: 'explain', zh: 'AI 讲解', symbol: '✳', cls: 'feature-ai', to: 'galaxy',
    desc: '单词释义 · 句法透镜' },
  { key: 'milestone', zh: '星轨里程碑', symbol: '✦', cls: 'feature-milestone', to: 'dashboard',
    desc: '学习连胜 · 点亮专属星座' },
])

// ===== Hero 3D 巡航场景(复用开场 IntroScene 的 home 变体) =====
// 首页 hero 就是开场那个宇宙:同一套塔/轨道词星球/星鸟,后退一档的安静巡航机位。
// 全端启用(低端机跑 MeshStandardMaterial/无后期的低配变体,与开场同一降级);
// 减动效不跑 3D;无 WebGL 时留在 CSS 星空底上。
const heroSceneOn = ref(false)      // canvas 宿主是否挂出
const heroSceneReady = ref(false)    // 3D 就绪(淡入,盖过 CSS 星空底)
const heroPrewarm = ref(false)        // 转场预热:就绪即显(在视口下方完成,落位时已满亮)
const heroSceneFailed = ref(false)   // WebGL 不可用 → CSS 星空底常驻
const heroHover = ref(null)         // 3D 词星球悬停卡 { word, ipa, meaning, x, y }
const heroCanvasEl = ref(null)
let heroScene = null
let heroIO = null

async function ensureHeroScene() {
  if (disposed || heroScene || heroSceneOn.value) return
  if (reduceMotion) return // 减动效:CSS 星空即画面,不跑 3D
  heroSceneOn.value = true
  await nextTick()
  if (!heroCanvasEl.value || heroCanvasEl.value.isConnected === false) return
  try {
    const { IntroScene } = await import('../three/landing/introScene.js')
    if (disposed || !heroCanvasEl.value || !heroCanvasEl.value.isConnected) return
    heroScene = new IntroScene(heroCanvasEl.value, {
      words: pickIntroWords(), // 与开场同一批真实词 → 转场后是"同一个宇宙"
      mode: 'home',
      lowEnd,
      onHover: (w) => { if (!w) heroHover.value = null },
      onHoverMove: (w, x, y) => { heroHover.value = { word: w.word, ipa: w.ipa, meaning: w.meaning, x, y } },
      onPick: (w) => { if (w?.id != null) store.openWordInGalaxy(w.id) },
      onReady: () => { heroSceneReady.value = true },
    })
    // 挂载时 hero 可能已被滚出视口(晚进场),看不见就先暂停
    const rect = heroCanvasEl.value.getBoundingClientRect()
    if (rect.bottom < 0 || rect.top > window.innerHeight) heroScene.pause()
  } catch {
    heroSceneFailed.value = true
  }
}
// 滚动守护:hero 滚出视口暂停渲染,回屏续播(根容器是 .site-root)
function observeHeroVisible() {
  heroIO?.disconnect()
  const hero = document.getElementById('site-hero')
  if (!hero) return
  heroIO = new IntersectionObserver((es) => {
    for (const e of es) e.isIntersecting ? heroScene?.resume() : heroScene?.pause()
  }, { root: rootEl.value, threshold: 0.02 })
  heroIO.observe(hero)
}

// ===== 生命周期 =====
let disposed = false
let io = null
// 页脚统计数字滚动:进场时从 0 数到真实值(减动效直接落定)
function countUp(el) {
  const to = Number(el.dataset.to || 0)
  if (reduceMotion) { el.textContent = String(to); return }
  const t0 = performance.now()
  const tick = (t) => {
    const k = Math.min(1, (t - t0) / 1100)
    el.textContent = String(Math.round(to * (1 - Math.pow(1 - k, 3))))
    if (k < 1) requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
}
function observeReveals() {
  if (reduceMotion) return
  io?.disconnect()
  io = new IntersectionObserver((es) => {
    for (const e of es) if (e.isIntersecting) {
      e.target.classList.add('vis')
      if (e.target.classList.contains('ft-stats')) e.target.querySelectorAll('strong').forEach(countUp)
      io.unobserve(e.target)
    }
  }, { threshold: 0.12 })
  document.querySelectorAll('.site-home .reveal').forEach((el) => io.observe(el))
}
watch(homeOn, async (on) => {
  if (!on) return
  await nextTick()
  observeReveals()
  observeHeroVisible()
})

onMounted(() => {
  // 开场改为每次加载都播(用户验收期需要反复看;想恢复"每会话一次"就把 seen 分支加回来)
  if (reduceMotion) {
    introOn.value = false
    homeOn.value = true
    heroAnim.value = true
    later(() => { ensureHeroScene() }, 350) // 降级直进图二:稍等首帧再起 3D
  } else {
    mountScene()
    armAuto()
  }
})
onActivated(() => {
  // KeepAlive 回场:若开场还没播,场景重新驱动 + 重新起自动计时
  if (introOn.value && scene && !entering) { scene.resume(); armAuto() }
  else if (homeOn.value) {
    heroScene?.resume()
    if (!heroScene) ensureHeroScene()
  }
})
onDeactivated(() => {
  clearAuto()
  scene?.pause()
  heroScene?.pause()
})
onBeforeUnmount(() => {
  disposed = true
  clearTimers()
  clearAuto()
  io?.disconnect()
  heroIO?.disconnect()
  scene?.dispose()
  scene = null
  heroScene?.dispose()
  heroScene = null
})
</script>

<template>
  <div ref="rootEl" class="site-root" :class="{ 'lock-scroll': introOn }">
    <!-- ============ 图一 · 开场 ============ -->
    <section v-if="introOn" class="site-intro" :class="{ leaving: introLeaving }">
      <!-- CSS 星空底:WebGL 就绪前/失败时的兜底画面 -->
      <div class="intro-fallback" aria-hidden="true">
        <i v-for="s in 90" :key="s" class="fb-star" :style="{
          left: `${(s * 37) % 100}%`, top: `${(s * 61) % 100}%`,
          width: `${1 + (s % 3) * 0.6}px`, height: `${1 + (s % 3) * 0.6}px`,
          animationDelay: `${(s % 7) * 0.7}s`,
        }" />
      </div>
      <div ref="canvasEl" class="intro-canvas" :class="{ ready: sceneReady, failed: sceneFailed }" />
      <!-- 左侧压暗:给白字文案让出干净的深色区(对齐参考稿) -->
      <div class="intro-shade" aria-hidden="true" />

      <header class="intro-top">
        <button class="brand" @click="introNav({ anchor: 'site-hero' })">
          <span class="brand-mark">✦</span>词峰 <em>WORDPEAK</em>
        </button>
        <nav class="intro-nav">
          <button @click="introNav({ anchor: 'site-features' })">宇宙档案</button>
          <button @click="introNav({ view: 'galaxy' })">词汇星系</button>
          <button @click="introNav({ view: 'bookshelf' })">轨道书库</button>
          <button @click="introNav({ anchor: 'site-modules' })">训练舱</button>
        </nav>
        <button class="text-btn" @click="skipIntro">跳过开场 ↗</button>
      </header>

      <div class="intro-copy">
        <p class="eyebrow">EXPLORE THE UNIVERSE OF WORDS</p>
        <h1 class="intro-title">让每个单词，<br />成为你的星辰。</h1>
        <div class="star-divider">✦ ─────</div>
        <button class="outline-btn" @click="enterUniverse">进入我的宇宙 <span>↗</span></button>
        <p class="word-count">{{ store.words.length || 888 }} WORDS · YOUR PERSONAL GALAXY</p>
      </div>

      <!-- 星球悬停词卡 -->
      <Transition name="hv-fade">
        <div v-if="hoverWord" class="hover-card" :style="{ left: hoverWord.x + 'px', top: hoverWord.y + 'px' }">
          <p class="hv-word">{{ hoverWord.word }}</p>
          <p v-if="hoverWord.ipa" class="hv-ipa">{{ hoverWord.ipa }}</p>
          <p class="hv-meaning">{{ hoverWord.meaning }}</p>
          <p class="hv-tip">点击星球 → 打开词卡</p>
        </div>
      </Transition>

      <footer class="intro-bottom">
        <span class="scroll-hint">↓ &nbsp; SCROLL TO EXPLORE</span>
        <span class="sys-status">MEMORY SYSTEM <i class="dot" /> ONLINE · CONSTELLATION {{ constellationPct }}%</span>
      </footer>
    </section>

    <!-- ============ 图二 · 首页 ============ -->
    <div v-if="homeOn" class="site-home" :class="{ in: heroAnim }">
      <!-- Hero:开场同款 3D 宇宙(CSS 星空为就绪前/降级画面,文案浮于其上) -->
      <section id="site-hero" class="hero">
        <div class="hero-fallback" aria-hidden="true">
          <i v-for="s in 90" :key="s" class="fb-star" :style="{
            left: `${(s * 37) % 100}%`, top: `${(s * 61) % 100}%`,
            width: `${1 + (s % 3) * 0.6}px`, height: `${1 + (s % 3) * 0.6}px`,
            animationDelay: `${(s % 7) * 0.7}s`,
          }" />
        </div>
        <div v-if="heroSceneOn" ref="heroCanvasEl" class="hero-scene"
             :class="{ ready: heroSceneReady, failed: heroSceneFailed, prewarm: heroPrewarm }" />
        <div class="hero-shade" aria-hidden="true" />

        <header class="home-top">
          <button class="brand" @click="scrollToTop()">
            <span class="brand-mark">✦</span>词峰 <em>WORDPEAK</em>
          </button>
          <nav class="home-nav">
            <button v-for="item in NAV" :key="item.label" @click="item.act">{{ item.label }}</button>
          </nav>
          <div class="home-tools">
            <button class="tool" title="快速搜索 (Ctrl+K)" @click="openSearch">⌕</button>
            <button class="tool" :title="`主题:${themeLabel[store.settings.theme] || '深空'}`" @click="cycleTheme">◐</button>
            <button class="light-btn" @click="launch()">进入宇宙 ↗</button>
          </div>
        </header>

        <div class="hero-copy">
          <p class="eyebrow">YOUR PERSONAL LEARNING UNIVERSE</p>
          <h2 class="hero-title">在词语的宇宙中，<br />遇见更大的自己。</h2>
          <p class="hero-sub">让英语学习成为一场探索星辰大海的旅程 —— 三幕式学习、SM-2 记忆航线与 {{ store.words.length || 888 }} 颗词汇星球，都在这里等你。</p>
          <p class="hero-meta">{{ store.words.length || 888 }} 颗词汇星球 · 50+ 学习 API · AI 智能讲解</p>
          <button class="light-btn big" @click="launch()">✦ 开启你的学习之旅 <span>→</span></button>
        </div>

        <div class="hero-hint">⟷ 拖拽环视 · 绕到星球的另一面</div>
        <div class="hero-caption">WORDPEAK — EXPLORE BEYOND WORDS</div>

        <!-- 3D 词星球悬停词卡 -->
        <Transition name="hv-fade">
          <div v-if="heroHover" class="hover-card" :style="{ left: heroHover.x + 'px', top: heroHover.y + 'px' }">
            <p class="hv-word">{{ heroHover.word }}</p>
            <p v-if="heroHover.ipa" class="hv-ipa">{{ heroHover.ipa }}</p>
            <p class="hv-meaning">{{ heroHover.meaning }}</p>
            <p class="hv-tip">点击星球 → 打开词卡</p>
          </div>
        </Transition>
      </section>

      <!-- 六大训练舱(深空区 · 3×2 编辑级大卡) -->
      <section id="site-modules" class="modules">
        <div class="wrap">
        <header class="section-heading reveal">
          <p class="eyebrow">EXPLORE</p>
          <h2>六大训练舱 · 全面提升</h2>
          <p>从词汇到表达,构建你的英语能力星图 —— 每一个训练舱都是真实可进入的领地。</p>
        </header>
        <div class="module-grid">
          <button v-for="m in MODULES" :key="m.key" class="module-card reveal" @click="store.setView(m.to)">
            <div class="module-art" :class="m.art" aria-hidden="true">
              <!-- 发音舱:唇形 + 声波弧 -->
              <svg v-if="m.key === 'phonetics'" viewBox="0 0 64 48">
                <path d="M20 8 Q34 4 44 8 L44 40 Q34 46 20 40 Z" fill="none" stroke="rgba(255,255,255,.92)" stroke-width="2.4" />
                <path d="M32 12 Q36 24 32 36" fill="none" stroke="rgba(255,255,255,.92)" stroke-width="2" />
                <path d="M48 20 Q54 24 48 28" fill="none" stroke="rgba(255,255,255,.55)" stroke-width="2" />
                <path d="M52 14 Q60 24 52 34" fill="none" stroke="rgba(255,255,255,.55)" stroke-width="2" />
              </svg>
              <!-- 语法机械城:齿轮组 -->
              <svg v-else-if="m.key === 'grammar'" viewBox="0 0 64 48">
                <circle cx="24" cy="24" r="10" fill="none" stroke="rgba(255,255,255,.92)" stroke-width="2.4" />
                <circle cx="24" cy="24" r="4" fill="rgba(255,255,255,.92)" />
                <path d="M24 10 L24 14 M34 24 L38 24 M24 34 L24 38 M14 24 L10 24 M31 17 L34 14 M31 31 L34 34 M17 31 L14 34 M17 17 L14 14"
                      stroke="rgba(255,255,255,.92)" stroke-width="2.2" />
                <circle cx="48" cy="34" r="7" fill="none" stroke="rgba(255,255,255,.55)" stroke-width="2" />
                <path d="M48 27 L48 30 M55 34 L58 34 M48 41 L48 44 M41 34 L38 34" stroke="rgba(255,255,255,.55)" stroke-width="2" />
              </svg>
              <!-- 回声谷:波形 -->
              <svg v-else-if="m.key === 'listening'" viewBox="0 0 64 48">
                <path d="M2 40 Q32 12 62 40" fill="none" stroke="rgba(255,255,255,.45)" stroke-width="2" />
                <g stroke="rgba(255,255,255,.92)" stroke-width="2.4" stroke-linecap="round">
                  <line x1="8" y1="26" x2="8" y2="34" /><line x1="14" y1="22" x2="14" y2="38" />
                  <line x1="20" y1="16" x2="20" y2="42" /><line x1="26" y1="20" x2="26" y2="40" />
                  <line x1="32" y1="12" x2="32" y2="44" /><line x1="38" y1="20" x2="38" y2="40" />
                  <line x1="44" y1="16" x2="44" y2="42" /><line x1="50" y1="22" x2="50" y2="38" />
                  <line x1="56" y1="26" x2="56" y2="34" />
                </g>
              </svg>
              <!-- 口语竞技场:麦克风 + 星 -->
              <svg v-else-if="m.key === 'speaking'" viewBox="0 0 64 48">
                <rect x="27" y="8" width="10" height="20" rx="5" fill="none" stroke="rgba(255,255,255,.92)" stroke-width="2.4" />
                <path d="M22 24 Q22 36 32 38 Q42 36 42 24" fill="none" stroke="rgba(255,255,255,.92)" stroke-width="2.4" />
                <line x1="32" y1="38" x2="32" y2="43" stroke="rgba(255,255,255,.92)" stroke-width="2.4" />
                <path d="M50 6 L52 11 L57 13 L52 15 L50 20 L48 15 L43 13 L48 11 Z" fill="rgba(255,255,255,.92)" />
              </svg>
              <!-- 阅读号列车:车头 + 轨道 -->
              <svg v-else-if="m.key === 'reading'" viewBox="0 0 64 48">
                <path d="M6 40 L58 40 M10 44 L54 44" stroke="rgba(255,255,255,.45)" stroke-width="2" />
                <path d="M12 36 L14 20 Q16 12 26 12 L44 12 Q52 12 52 20 L52 36 Z" fill="none" stroke="rgba(255,255,255,.92)" stroke-width="2.4" />
                <circle cx="22" cy="38" r="4" fill="none" stroke="rgba(255,255,255,.92)" stroke-width="2.2" />
                <circle cx="42" cy="38" r="4" fill="none" stroke="rgba(255,255,255,.92)" stroke-width="2.2" />
                <rect x="20" y="18" width="8" height="8" fill="rgba(255,255,255,.75)" />
                <rect x="34" y="18" width="12" height="4" fill="rgba(255,255,255,.5)" />
                <line x1="58" y1="16" x2="58" y2="28" stroke="rgba(255,255,255,.92)" stroke-width="2" />
              </svg>
              <!-- 写作工坊:笔尖 + 行文 -->
              <svg v-else viewBox="0 0 64 48">
                <path d="M14 34 L44 12 L52 20 L22 42 L12 44 Z" fill="none" stroke="rgba(255,255,255,.92)" stroke-width="2.4" />
                <line x1="44" y1="12" x2="52" y2="20" stroke="rgba(255,255,255,.92)" stroke-width="2.4" />
                <g stroke="rgba(255,255,255,.45)" stroke-width="1.6">
                  <line x1="14" y1="40" x2="18" y2="40" /><line x1="24" y1="42" x2="34" y2="42" /><line x1="40" y1="40" x2="48" y2="40" />
                </g>
                <path d="M54 6 L56 10 L60 12 L56 14 L54 18 L52 14 L48 12 L52 10 Z" fill="rgba(255,255,255,.8)" />
              </svg>
            </div>
            <div class="module-info">
              <div class="module-head">
                <span class="module-number">{{ m.n }}</span>
                <h3>{{ m.zh }}</h3>
              </div>
              <span class="module-latin">{{ m.latin }}</span>
              <p>{{ m.desc }}</p>
              <span class="module-chip">{{ m.chip }}</span>
              <span class="card-arrow">↗</span>
            </div>
          </button>
        </div>
        </div>
      </section>

      <!-- 学习航线(深空区,真实航线 API) -->
      <section id="site-routes" class="routes">
        <div class="wrap">
        <header class="section-heading reveal">
          <p class="eyebrow">YOUR ROUTE</p>
          <h2>你的专属学习航线</h2>
          <p>无论只有五分钟,还是准备深入探索 —— 每一站都是真实领地,进度即刻入账。</p>
        </header>
        <div class="route-grid">
          <button v-for="r in ROUTES" :key="r.key" class="route-card reveal"
                  :class="[r.cls, { rec: r.key === recommended }]" @click="launch(r.key)">
            <span v-if="r.key === recommended" class="rec-badge">今日推荐</span>
            <span class="route-symbol">{{ r.symbol }}</span>
            <span class="route-time">{{ r.minutes }} 分钟</span>
            <strong class="route-title">{{ r.zh }}</strong>
            <span class="route-latin">{{ r.latin }}</span>
            <p class="route-desc">{{ r.desc }}</p>
            <ul class="r-stops">
              <li v-for="s in r.stops" :key="s"><i></i><span>{{ s }}</span></li>
            </ul>
            <span class="route-arrow">↗</span>
          </button>
        </div>
        </div>
      </section>

      <!-- 核心功能(深空区 · 4 列大视觉卡) -->
      <section id="site-features" class="features">
        <div class="wrap">
        <header class="section-heading reveal">
          <p class="eyebrow">CORE FEATURES</p>
          <h2>不止学习，更是沉浸式探索</h2>
        </header>
        <div class="feature-grid">
          <button v-for="f in FEATURES" :key="f.key" class="feature-card reveal" @click="store.setView(f.to)">
            <div class="feature-visual" :class="f.cls" aria-hidden="true"><span class="fv-sym">{{ f.symbol }}</span></div>
            <div class="feature-copy">
              <h3>{{ f.zh }}</h3>
              <p>{{ f.desc }}</p>
              <span class="feature-more">探索更多 <i class="f-arrow">↗</i></span>
            </div>
          </button>
        </div>
        </div>
      </section>

      <!-- 页脚(真实统计) -->
      <footer id="site-archive" class="site-footer">
        <div class="wrap">
        <div class="ft-row">
          <button class="brand" @click="scrollToTop()">
            <span class="brand-mark">✦</span>词峰 <em>WORDPEAK</em>
          </button>
          <p class="ft-slogan">Not just learning English,<br />but exploring a bigger world.</p>
          <button class="light-btn" @click="launch()">立即开始 →</button>
        </div>
        <div class="ft-stats reveal">
          <span><strong :data-to="store.words.length || 888">{{ store.words.length || 888 }}</strong> 词汇星球</span>
          <span><strong data-to="18">18</strong> 学习 API</span>
          <span><strong data-to="19">19</strong> 可进入视图</span>
          <span><strong :data-to="learnedCount">{{ learnedCount }}</strong> 已点亮</span>
          <span class="ft-hint">按推荐航线 {{ SESSION_MODES[recommended].zh }}({{ SESSION_MODES[recommended].minutes }} 分钟)开始</span>
        </div>
        </div>
      </footer>
    </div>
  </div>
</template>

<style scoped>
/* ===== 官网自带固定深空画面(与词汇圣殿同策略:场景色不随主题翻转,文字保持高对比) ===== */
.site-root {
  height: 100%;
  overflow-y: auto;
  overflow-x: hidden;
  background: #030611;
  color: #f7f6ff;
  font-family: Inter, 'PingFang SC', 'Microsoft YaHei', sans-serif;
  scrollbar-width: thin;
  scrollbar-color: #26304d transparent;
}
.site-root.lock-scroll { overflow: hidden; }

/* ============ 图一 · 开场 ============ */
.site-intro {
  position: relative;
  height: 100%;
  min-height: 560px;
  overflow: hidden;
  background: #030611;
}
.intro-fallback { position: absolute; inset: 0; }
.fb-star {
  position: absolute;
  border-radius: 50%;
  background: #cfe0ff;
  opacity: 0.5;
  animation: fb-tw 3.6s ease-in-out infinite;
}
@keyframes fb-tw { 0%, 100% { opacity: 0.16; } 50% { opacity: 0.72; } }
.intro-canvas { position: absolute; inset: 0; opacity: 0; transition: opacity 1.1s ease; }
.intro-canvas.ready { opacity: 1; }
.intro-canvas.failed { display: none; }
.intro-canvas :deep(canvas) { display: block; width: 100%; height: 100%; }
/* 暗角:画幅四周收一档(开场与首页同款),纵深与聚焦感;不拦交互 */
.intro-canvas::after, .hero-scene::after {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: radial-gradient(ellipse at 50% 44%, transparent 52%, rgba(3, 6, 17, 0.42) 84%, rgba(2, 4, 12, 0.64) 100%);
}
/* 左侧压暗:文案区干净可读,右侧场景完整露出(对齐参考稿结构) */
.intro-shade {
  position: absolute;
  inset: 0;
  z-index: 1;
  background: linear-gradient(90deg, rgba(2, 4, 11, 0.95), rgba(2, 4, 11, 0.4) 40%, transparent 72%);
  pointer-events: none;
}

.intro-top {
  position: absolute; top: 0; left: 0; right: 0;
  z-index: 3;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  padding: 26px 5vw;
  transition: opacity 0.55s ease, transform 0.55s ease;
}
.site-intro.leaving .intro-top { opacity: 0; transform: translateY(-12px); }

.brand {
  display: inline-flex;
  align-items: baseline;
  gap: 8px;
  border: 0;
  background: none;
  color: #f7f6ff;
  font-size: 22px;
  font-family: Georgia, 'Songti SC', serif;
  white-space: nowrap;
  cursor: pointer;
}
.brand em {
  font-style: normal;
  font-size: 10px;
  letter-spacing: 3px;
  color: rgba(247, 246, 255, 0.72);
  font-family: Inter, sans-serif;
  margin-left: 2px;
}
.brand-mark { color: #ffd8a0; }

.nav-links, .intro-nav, .home-nav { display: flex; gap: clamp(14px, 2.5vw, 38px); }
.intro-nav button, .home-nav button {
  border: 0;
  background: none;
  color: #d2d7ea;
  font-size: 13px;
  letter-spacing: 0.05em;
  cursor: pointer;
  padding: 6px 2px;
  transition: color 0.2s ease;
}
.intro-nav button:hover, .home-nav button:hover { color: #fff; }

.text-btn, .outline-btn, .light-btn {
  padding: 12px 22px;
  border-radius: 40px;
  font-size: 13px;
  letter-spacing: 0.08em;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.25s ease, color 0.25s ease, transform 0.25s ease, box-shadow 0.25s ease;
}
.text-btn {
  border: 1px solid rgba(211, 220, 255, 0.42);
  background: transparent;
  color: #fff;
}
.text-btn:hover { background: rgba(211, 220, 255, 0.1); }
.outline-btn {
  border: 1px solid rgba(211, 220, 255, 0.42);
  background: transparent;
  color: #fff;
}
.outline-btn:hover { transform: translateY(-1px); background: rgba(211, 220, 255, 0.08); }
.light-btn {
  position: relative;
  overflow: hidden;
  border: 1px solid transparent;
  background: #f5f5ff;
  color: #0a1330;
}
.light-btn::after {
  content: '';
  position: absolute;
  top: 0; left: -75%;
  width: 45%; height: 100%;
  background: linear-gradient(105deg, transparent, rgba(10, 19, 48, 0.1), transparent);
  transform: skewX(-18deg);
  transition: left 0.65s ease;
}
.light-btn:hover { transform: translateY(-1px); box-shadow: 0 10px 26px rgba(173, 186, 255, 0.22); }
.light-btn:hover::after { left: 135%; }
.light-btn span { display: inline-block; transition: transform 0.3s ease; }
.light-btn:hover span { transform: translateX(4px); }
.light-btn.big { padding: 14px 26px; font-size: 15px; }

/* 全站可聚焦元素:键盘可达性 */
.module-card:focus-visible, .route-card:focus-visible, .feature-card:focus-visible,
.light-btn:focus-visible, .outline-btn:focus-visible, .text-btn:focus-visible,
.tool:focus-visible, .brand:focus-visible,
.intro-nav button:focus-visible, .home-nav button:focus-visible {
  outline: 2px solid #8b91ce;
  outline-offset: 3px;
}

.eyebrow { color: #a7b7e9; font-size: 10px; letter-spacing: 3px; margin: 0 0 14px; }

.intro-copy {
  position: absolute;
  z-index: 2;
  top: 25%;
  left: 6vw;
  width: min(570px, 85vw);
  transition: opacity 0.55s ease, transform 0.55s ease;
  animation: intro-copy-in 1.1s ease 0.2s both;
}
@keyframes intro-copy-in {
  from { opacity: 0; transform: translateX(-26px); }
  to { opacity: 1; transform: translateX(0); }
}
.site-intro.leaving .intro-copy { opacity: 0; transform: translateX(-45px); }

.intro-title {
  font-family: 'Songti SC', 'Noto Serif SC', Georgia, serif;
  font-size: clamp(40px, 5.2vw, 76px);
  font-weight: 400;
  line-height: 1.3;
  letter-spacing: 0.04em;
  color: #f7f6ff;
  margin: 0;
  text-shadow: 0 2px 30px rgba(3, 6, 17, 0.55);
}
.star-divider { margin: 20px 0; color: #c4d4ff; font-size: 14px; letter-spacing: 0.1em; }
.word-count { margin-top: 26px; font-size: 10px; letter-spacing: 3px; color: #a6b1ce; }

.hover-card {
  position: absolute;
  z-index: 6;
  transform: translate(-50%, calc(-100% - 18px));
  min-width: 168px;
  max-width: 240px;
  padding: 12px 16px;
  border-radius: 12px;
  border: 1px solid rgba(242, 234, 216, 0.28);
  background: rgba(7, 12, 28, 0.9);
  backdrop-filter: blur(6px);
  box-shadow: 0 10px 34px rgba(0, 0, 0, 0.5);
  pointer-events: none;
  text-align: left;
}
.hv-word { font-family: Georgia, 'Songti SC', serif; font-size: 20px; font-weight: 700; color: #f6f8ff; margin: 0; }
.hv-ipa { font-family: 'JetBrains Mono', 'Courier New', monospace; font-size: 12px; color: #9db2d8; margin: 2px 0 0; }
.hv-meaning { font-size: 12.5px; color: #cdd8ee; margin: 6px 0 0; line-height: 1.5; }
.hv-tip { font-size: 10.5px; color: rgba(242, 234, 216, 0.66); margin: 8px 0 0; letter-spacing: 0.08em; }
.hv-fade-enter-active, .hv-fade-leave-active { transition: opacity 0.2s ease; }
.hv-fade-enter-from, .hv-fade-leave-to { opacity: 0; }

.intro-bottom {
  position: absolute;
  z-index: 2;
  bottom: 28px;
  left: 5vw;
  right: 5vw;
  display: flex;
  justify-content: space-between;
  color: #a9b5d0;
  font-size: 9px;
  letter-spacing: 2px;
  transition: opacity 0.55s ease;
}
.site-intro.leaving .intro-bottom { opacity: 0; }
.scroll-hint { animation: scroll-pulse 2.4s ease-in-out infinite; }
@keyframes scroll-pulse { 0%, 100% { opacity: 0.45; } 50% { opacity: 1; } }
.sys-status { display: inline-flex; align-items: center; gap: 8px; }
.sys-status .dot {
  display: inline-block;
  width: 6px; height: 6px; border-radius: 50%;
  background: #65e4b3;
  animation: sys-blink 2s ease-in-out infinite;
}
@keyframes sys-blink { 0%, 100% { opacity: 0.5; } 50% { opacity: 1; } }

/* ============ 图二 · 首页 ============ */
.site-home { position: relative; min-height: 100%; }

/* 落页编排:镜头落位(in)之前,首屏以下的区块不上场 —— 硬切瞬间不闪出亮色区块;
   in 之后依次淡入,与镜头回落同一节奏 */
.modules, .routes, .features, .site-footer { transition: opacity 0.85s ease 0.45s; }
.site-home:not(.in) .modules, .site-home:not(.in) .routes,
.site-home:not(.in) .features, .site-home:not(.in) .site-footer { opacity: 0; }

/* —— Hero:开场同款 3D 宇宙 —— */
.hero {
  position: relative;
  height: 65vh;
  min-height: 570px;
  max-height: 850px;
  overflow: hidden;
  background: #030611; /* 与 3D 场景同底色,交叉淡入不露色差 */
}
/* CSS 星空底:3D 就绪前/无 WebGL 时的画面(与开场兜底同款) */
.hero-fallback { position: absolute; inset: 0; }
/* 3D 巡航宇宙层:就绪前零交互透明,就绪后淡入接管(悬停词卡/点击词卡都在这层) */
.hero-scene {
  position: absolute;
  inset: 0;
  z-index: 1;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.35s ease;
}
.hero-scene.ready { opacity: 1; pointer-events: auto; }
/* 转场预热路径:就绪发生在视口下方,直接满亮 —— 落位时不再有溶解过程 */
.hero-scene.prewarm.ready { transition: opacity 0s; }
.hero-scene.failed { display: none; }
/* 画布可拖拽环视(六面体塔/词星球):grab 光标示意,触屏纵滑仍归页面滚动 */
.hero-scene :deep(canvas) { display: block; width: 100%; height: 100%; touch-action: pan-y; cursor: grab; }
.hero-shade {
  position: absolute;
  inset: 0;
  z-index: 1;
  background: linear-gradient(90deg, rgba(3, 7, 19, 0.76), rgba(3, 7, 19, 0.06) 75%);
  pointer-events: none;
}

.home-top {
  position: relative;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  padding: 26px 5vw;
  animation: fade-down 0.7s ease 0.15s both;
}
.home-tools { display: flex; align-items: center; gap: 10px; }
.tool {
  width: 38px; height: 38px;
  border-radius: 50%;
  border: 1px solid rgba(211, 220, 255, 0.42);
  background: transparent;
  color: #fff;
  font-size: 15px;
  cursor: pointer;
  transition: background 0.25s ease;
}
.tool:hover { background: rgba(211, 220, 255, 0.12); }

.hero-copy {
  position: absolute;
  z-index: 2;
  left: 5.5vw;
  top: 23%;
  max-width: 640px;
}
.hero-title {
  font-family: 'Songti SC', 'Noto Serif SC', Georgia, serif;
  font-size: clamp(36px, 4.4vw, 64px);
  font-weight: 400;
  line-height: 1.3;
  letter-spacing: 0.04em;
  color: #f7f6ff;
  margin: 20px 0;
  text-shadow: 0 2px 26px rgba(3, 6, 17, 0.5);
}
.hero-sub { color: #d7dff2; font-size: 15px; line-height: 1.85; max-width: 46ch; margin: 0 0 14px; }
.hero-meta { font-size: 13px; letter-spacing: 0.12em; color: #a7b7e9; margin: 0 0 30px; }
.hero-caption {
  position: absolute;
  z-index: 2;
  bottom: 24px;
  right: 5vw;
  font-size: 10px;
  letter-spacing: 2px;
  color: rgba(215, 223, 242, 0.72);
}
/* 拖拽环视提示(左下角,与右下 caption 对称):塔与词星球是真六面体,拖拽能绕到侧面 */
.hero-hint {
  position: absolute;
  z-index: 2;
  bottom: 24px;
  left: 5vw;
  font-size: 10px;
  letter-spacing: 2px;
  color: rgba(215, 223, 242, 0.6);
  user-select: none;
}

/* 入场编排:hero 文案分层浮现 */
.site-home.in .hero-copy > * { animation: fade-up 0.8s ease both; }
.site-home.in .hero-copy > *:nth-child(1) { animation-delay: 0.12s; }
.site-home.in .hero-copy > *:nth-child(2) { animation-delay: 0.22s; }
.site-home.in .hero-copy > *:nth-child(3) { animation-delay: 0.34s; }
.site-home.in .hero-copy > *:nth-child(4) { animation-delay: 0.44s; }
.site-home.in .hero-copy > *:nth-child(5) { animation-delay: 0.54s; }

@keyframes fade-up { from { opacity: 0; transform: translateY(22px); } to { opacity: 1; transform: translateY(0); } }
@keyframes fade-down { from { opacity: 0; transform: translateY(-14px); } to { opacity: 1; transform: translateY(0); } }

/* —— 区块通用:整页同一片夜空,内容收进居中定宽栏,标题居中 —— */
.wrap { width: min(1240px, 92vw); margin: 0 auto; }
.section-heading { max-width: 700px; margin: 0 auto 48px; text-align: center; }
.section-heading .eyebrow { color: #d8bc8e; }
.section-heading h2 {
  font-family: 'Songti SC', 'Noto Serif SC', Georgia, serif;
  font-weight: 400;
  font-size: clamp(30px, 3.2vw, 46px);
  margin: 8px 0;
  letter-spacing: 0.03em;
  color: #f7f6ff;
}
.section-heading p:last-child { color: #96a3c8; font-size: 14px; line-height: 1.9; margin: 0; }

.reveal { opacity: 0; transform: translateY(26px); transition: opacity 0.7s ease, transform 0.7s ease; }
.reveal.vis { opacity: 1; transform: translateY(0); }

/* —— 六大训练舱:深空底上 3×2 编辑级大卡 —— */
.modules {
  padding: 104px 0 112px;
  background: radial-gradient(ellipse 58% 42% at 14% 0%, rgba(56, 46, 102, 0.26), transparent 68%), #030611;
}
.module-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 20px; }
.module-card {
  overflow: hidden;
  border-radius: 18px;
  background: linear-gradient(180deg, #0c1330, #070d1f);
  border: 1px solid rgba(132, 150, 205, 0.16);
  padding: 0;
  text-align: left;
  cursor: pointer;
  transition: transform 0.35s ease, border-color 0.35s ease, box-shadow 0.35s ease;
}
.module-card:hover {
  transform: translateY(-6px);
  border-color: rgba(216, 188, 142, 0.36);
  box-shadow: 0 24px 52px rgba(2, 6, 17, 0.55);
}
.module-art {
  position: relative;
  height: 208px;
  display: grid;
  place-items: center;
  color: #fff;
  overflow: hidden;
}
/* 地平线压暗:色块下缘沉下去,画面有了纵深 */
.module-art::before {
  content: '';
  position: absolute;
  inset: auto 0 0 0;
  height: 36%;
  background: linear-gradient(180deg, transparent, rgba(4, 9, 24, 0.55));
  pointer-events: none;
}
/* 高光尘埃:几粒亮星点缀,hover 时亮起 */
.module-art::after {
  content: '';
  position: absolute;
  inset: 0;
  background:
    radial-gradient(1.6px 1.6px at 22% 26%, rgba(255, 255, 255, 0.9), transparent 100%),
    radial-gradient(1.2px 1.2px at 68% 18%, rgba(255, 255, 255, 0.75), transparent 100%),
    radial-gradient(1.4px 1.4px at 84% 56%, rgba(255, 255, 255, 0.6), transparent 100%),
    radial-gradient(1.2px 1.2px at 38% 64%, rgba(255, 255, 255, 0.55), transparent 100%);
  opacity: 0.55;
  transition: opacity 0.3s ease;
  pointer-events: none;
}
.module-card:hover .module-art::after { opacity: 1; }
.module-art svg {
  position: relative;
  z-index: 1;
  width: 76px;
  height: 57px;
  filter: drop-shadow(0 6px 18px rgba(2, 6, 20, 0.5));
  transition: transform 0.35s ease;
}
.module-card:hover .module-art svg { transform: scale(1.1) translateY(-2px); }
/* 六舱画幅:统一"夜空 + 单色星芒辉光"配方,各舱只换光的颜色 */
.art-1 { background: radial-gradient(circle at 50% 44%, rgba(122, 199, 255, 0.32), rgba(122, 199, 255, 0.10) 38%, transparent 62%), linear-gradient(180deg, #0b1730, #070d1e); }
.art-2 { background: radial-gradient(circle at 50% 44%, rgba(236, 198, 143, 0.30), rgba(236, 198, 143, 0.09) 38%, transparent 62%), linear-gradient(180deg, #191226, #0e0a1a); }
.art-3 { background: radial-gradient(circle at 50% 44%, rgba(110, 226, 226, 0.28), rgba(110, 226, 226, 0.08) 38%, transparent 62%), linear-gradient(180deg, #0a1a2c, #061020); }
.art-4 { background: radial-gradient(circle at 50% 44%, rgba(187, 149, 255, 0.30), rgba(187, 149, 255, 0.10) 38%, transparent 62%), linear-gradient(180deg, #171236, #0d0a20); }
.art-5 { background: radial-gradient(circle at 50% 44%, rgba(144, 180, 255, 0.30), rgba(144, 180, 255, 0.09) 38%, transparent 62%), linear-gradient(180deg, #0e1a38, #081024); }
.art-6 { background: radial-gradient(circle at 50% 44%, rgba(198, 208, 255, 0.26), rgba(198, 208, 255, 0.08) 38%, transparent 62%), linear-gradient(180deg, #141736, #0b0e24); }
.module-info { position: relative; padding: 20px 22px 24px; }
.module-head { display: flex; align-items: baseline; gap: 10px; }
.module-number { color: #d8bc8e; font-family: Georgia, serif; font-size: 12px; letter-spacing: 0.1em; transition: letter-spacing 0.3s ease; }
.module-card:hover .module-number { letter-spacing: 0.18em; }
.module-info h3 { margin: 0; font-size: 20px; font-weight: 400; color: #f5f4ff; font-family: 'Songti SC', 'Noto Serif SC', serif; letter-spacing: 0.02em; }
.module-latin { display: block; margin: 4px 0 0; font-size: 9.5px; letter-spacing: 2.6px; color: #7e8bb0; }
.module-info p { color: #a3aecb; font-size: 13.5px; line-height: 1.8; margin: 12px 0 14px; }
.module-chip {
  display: inline-block;
  color: #d8bc8e;
  font-size: 11.5px;
  letter-spacing: 0.04em;
  border: 1px solid rgba(216, 188, 142, 0.32);
  border-radius: 999px;
  padding: 5px 13px;
  background: rgba(216, 188, 142, 0.07);
}
.card-arrow {
  position: absolute;
  right: 16px;
  bottom: 16px;
  color: rgba(216, 224, 255, 0.42);
  transition: transform 0.3s ease, color 0.3s ease;
}
.module-card:hover .card-arrow { transform: translate(3px, -3px); color: #ffd9a3; }

/* —— 学习航线(深空区,真实航线 API) —— */
.routes {
  padding: 104px 0 112px;
  background: radial-gradient(ellipse 54% 46% at 80% 24%, rgba(38, 66, 130, 0.30), transparent 62%), #04091a;
}
.route-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 20px; }
.route-card {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 10px;
  padding: 28px;
  text-align: left;
  color: #fff;
  border: 1px solid rgba(132, 150, 205, 0.18);
  border-radius: 18px;
  cursor: pointer;
  overflow: hidden;
  transition: transform 0.25s ease, border-color 0.25s ease, box-shadow 0.25s ease;
}
.route-card::before {
  content: '';
  position: absolute;
  inset: 0;
  background:
    radial-gradient(1.4px 1.4px at 18% 22%, rgba(232, 238, 255, 0.8), transparent 100%),
    radial-gradient(1.2px 1.2px at 74% 30%, rgba(232, 238, 255, 0.65), transparent 100%),
    radial-gradient(1.6px 1.6px at 46% 72%, rgba(232, 238, 255, 0.55), transparent 100%),
    radial-gradient(1.2px 1.2px at 86% 64%, rgba(232, 238, 255, 0.5), transparent 100%);
  opacity: 0.6;
  pointer-events: none;
  transition: opacity 0.3s ease;
}
.route-card:hover { transform: translateY(-5px); border-color: rgba(211, 220, 255, 0.44); box-shadow: 0 20px 46px rgba(3, 8, 24, 0.5); }
.route-card:hover::before { opacity: 1; }
.route-card.rec { border-color: rgba(216, 188, 142, 0.55); box-shadow: 0 0 0 1px rgba(216, 188, 142, 0.22); }
/* 航线卡底:压暗一档的夜色,彩色只留给符号与星点 */
.route-cyan { background: linear-gradient(160deg, rgba(14, 58, 72, 0.78), rgba(7, 16, 34, 0.94)); }
.route-blue { background: linear-gradient(160deg, rgba(30, 54, 108, 0.78), rgba(9, 16, 36, 0.94)); }
.route-purple { background: linear-gradient(160deg, rgba(60, 40, 100, 0.78), rgba(14, 12, 36, 0.94)); }
.rec-badge {
  position: absolute;
  top: -11px; left: 24px;
  font-size: 10.5px;
  letter-spacing: 0.18em;
  color: #241a06;
  background: linear-gradient(135deg, #f7dcae, #dfb578);
  border-radius: 999px;
  padding: 4px 12px;
  font-weight: 600;
  animation: rec-glow 2.6s ease-in-out infinite;
}
@keyframes rec-glow {
  0%, 100% { box-shadow: 0 6px 18px rgba(223, 181, 120, 0.32); }
  50% { box-shadow: 0 6px 30px rgba(223, 181, 120, 0.66); }
}
/* 符号进细环:像罗盘一样立在卡首 */
.route-symbol {
  width: 54px;
  height: 54px;
  display: grid;
  place-items: center;
  font-size: 24px;
  line-height: 1;
  border-radius: 50%;
  border: 1px solid rgba(132, 150, 205, 0.3);
  background: rgba(8, 14, 32, 0.5);
  position: relative;
  transition: transform 0.3s ease, border-color 0.3s ease, box-shadow 0.3s ease;
}
.route-cyan .route-symbol { color: #77e8ff; }
.route-blue .route-symbol { color: #9db9ff; }
.route-purple .route-symbol { color: #c9a6ff; }
.route-card:hover .route-symbol { transform: scale(1.1); border-color: currentColor; box-shadow: 0 0 26px -8px currentColor; }
.route-time {
  color: #b9c8ee;
  font-size: 11px;
  letter-spacing: 0.08em;
  border: 1px solid rgba(132, 150, 205, 0.28);
  border-radius: 999px;
  padding: 3px 10px;
}
.route-title { font-size: 22px; font-family: 'Songti SC', 'Noto Serif SC', serif; font-weight: 400; color: #f5f4ff; letter-spacing: 0.02em; }
.route-latin { font-size: 10px; letter-spacing: 3px; color: rgba(167, 183, 233, 0.75); }
.route-desc { color: #a9b6d6; font-size: 13px; line-height: 1.75; margin: 2px 0 8px; }
/* 站点排成航线:节点串在一条竖直星轨上,而不是一堆胶囊 */
.r-stops { list-style: none; margin: 10px 0 0; padding: 0; position: relative; display: flex; flex-direction: column; }
.r-stops::before {
  content: '';
  position: absolute;
  left: 3.5px;
  top: 9px;
  bottom: 9px;
  width: 1px;
  background: linear-gradient(180deg, rgba(148, 170, 230, 0.42), rgba(148, 170, 230, 0.05));
}
.r-stops li {
  display: flex;
  align-items: center;
  gap: 12px;
  padding-bottom: 13px;
  font-size: 12.5px;
  letter-spacing: 0.03em;
  color: #b9c6e4;
}
.r-stops li:last-child { padding-bottom: 0; }
.r-stops i {
  flex: none;
  position: relative;
  z-index: 1;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  border: 1px solid rgba(148, 170, 230, 0.7);
  background: #0a1226;
  transition: background 0.3s ease, border-color 0.3s ease;
}
.route-cyan .r-stops i { border-color: rgba(119, 232, 255, 0.75); }
.route-blue .r-stops i { border-color: rgba(157, 185, 255, 0.75); }
.route-purple .r-stops i { border-color: rgba(201, 166, 255, 0.75); }
.route-card:hover .r-stops i { background: rgba(236, 240, 255, 0.9); border-color: rgba(236, 240, 255, 0.9); }
.route-arrow { position: absolute; right: 24px; bottom: 22px; font-size: 18px; color: rgba(226, 232, 255, 0.5); transition: transform 0.3s ease, color 0.3s ease; }
.route-card:hover .route-arrow { transform: translate(3px, -3px); color: #ffd9a3; }

/* —— 核心功能(深空区 · 4 列大视觉卡) —— */
.features {
  padding: 104px 0 120px;
  background: radial-gradient(ellipse 56% 40% at 88% 4%, rgba(86, 70, 140, 0.20), transparent 66%), #030611;
}
.feature-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 20px; }
.feature-card {
  overflow: hidden;
  border: 1px solid rgba(132, 150, 205, 0.16);
  border-radius: 18px;
  background: linear-gradient(180deg, #0c1330, #070d1f);
  padding: 0;
  text-align: left;
  cursor: pointer;
  transition: transform 0.3s ease, box-shadow 0.3s ease, border-color 0.3s ease;
}
.feature-card:hover { transform: translateY(-6px); box-shadow: 0 22px 46px rgba(2, 6, 17, 0.5); border-color: rgba(216, 188, 142, 0.36); }
.feature-visual {
  position: relative;
  height: 176px;
  display: grid;
  place-items: center;
  font-size: 64px;
  color: #d6e7ff;
  overflow: hidden;
  background: radial-gradient(circle at 50% 44%, rgba(122, 178, 255, 0.28), transparent 60%), linear-gradient(180deg, #0d1a38, #080f22);
}
/* 视觉块左上内高光:让色块有球面感 */
.feature-visual::after {
  content: '';
  position: absolute;
  inset: 0;
  background: radial-gradient(circle at 30% 22%, rgba(255, 255, 255, 0.14), transparent 46%);
  pointer-events: none;
}
.fv-sym { position: relative; z-index: 1; transition: transform 0.35s ease, text-shadow 0.35s ease; }
.feature-card:hover .fv-sym { transform: translateY(-6px) scale(1.06); text-shadow: 0 12px 30px rgba(0, 0, 0, 0.55); }
/* 四功能画幅:同"夜空 + 单色辉光"配方 */
.feature-galaxy { background: radial-gradient(circle at 50% 44%, rgba(122, 178, 255, 0.30), transparent 60%), linear-gradient(180deg, #0d1a38, #080f22); color: #b8d4ff; }
.feature-library { background: radial-gradient(circle at 50% 44%, rgba(236, 198, 143, 0.26), transparent 60%), linear-gradient(180deg, #1a1430, #0d0a1e); color: #ecd9b4; }
.feature-ai { background: radial-gradient(circle at 50% 44%, rgba(187, 149, 255, 0.30), transparent 60%), linear-gradient(180deg, #171238, #0c0920); color: #cbb2ff; }
.feature-milestone { background: radial-gradient(circle at 50% 44%, rgba(255, 216, 160, 0.26), transparent 60%), linear-gradient(180deg, #131634, #0a0d20); color: #ffd9a3; }
.feature-copy { padding: 20px 20px 22px; }
.feature-copy h3 { margin: 0 0 8px; font-size: 17px; font-family: 'Songti SC', 'Noto Serif SC', serif; font-weight: 400; color: #f5f4ff; letter-spacing: 0.02em; }
.feature-copy p { color: #a3aecb; font-size: 13px; line-height: 1.7; margin: 0 0 12px; }
.feature-more { font-size: 11.5px; letter-spacing: 0.04em; color: #d8bc8e; }
.f-arrow { display: inline-block; font-style: normal; transition: transform 0.3s ease; }
.feature-card:hover .f-arrow { transform: translate(3px, -3px); }

/* —— 页脚 —— */
.site-footer {
  background: radial-gradient(ellipse 70% 60% at 50% 118%, rgba(52, 44, 100, 0.28), transparent 62%), #02040c;
  border-top: 1px solid rgba(132, 150, 205, 0.14);
}
.ft-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  padding: 56px 0 32px;
}
.ft-slogan { color: #8f9bbd; font-size: 12.5px; line-height: 1.9; margin: 0; text-align: center; }
.ft-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 28px;
  padding: 22px 0 44px;
  border-top: 1px solid rgba(132, 150, 205, 0.14);
  color: #7e8bb0;
  font-size: 12px;
  letter-spacing: 0.06em;
}
.ft-stats strong { color: #e6c88f; font-family: Georgia, serif; font-size: 16px; letter-spacing: 0.02em; margin-right: 6px; }
.ft-hint { margin-left: auto; color: #5f6b8a; }

/* ============ 响应式(对齐参考稿断点) ============ */
@media (max-width: 1000px) {
  .module-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .feature-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .route-grid { grid-template-columns: 1fr; }
  .nav-links, .intro-nav, .home-nav { gap: 12px; }
}
@media (max-width: 650px) {
  .intro-nav, .home-nav { display: none; }
  .intro-copy { top: 26%; }
  .intro-title { font-size: 40px; }
  .hero { height: 72vh; min-height: 570px; }
  .hero-copy { top: 24%; right: 6vw; }
  .hero-title { font-size: 36px; }
  .module-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .module-art { height: 128px; }
  .route-grid, .feature-grid { grid-template-columns: 1fr; }
  .ft-row { flex-direction: column; align-items: flex-start; }
  .ft-hint { margin-left: 0; }
  .home-tools .light-btn { padding: 9px 16px; }
}
@media (max-width: 540px) {
  .module-grid { grid-template-columns: 1fr; }
  .module-art { height: 168px; }
  .r-stops li { padding-bottom: 11px; }
}

/* ============ 降级 ============ */
@media (prefers-reduced-motion: reduce) {
  .site-root *, .site-root *::before, .site-root *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
  .reveal { opacity: 1; transform: none; }
}
</style>
