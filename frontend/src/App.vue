<script setup>
import { ref, onMounted, onUnmounted, watch, computed, defineAsyncComponent } from 'vue'
import { NConfigProvider, darkTheme } from 'naive-ui'
import { useUniverse } from './stores/universe'
import { api } from './api'
import NavBar from './components/NavBar.vue'
import ReviewOverlay from './components/ReviewOverlay.vue'
import CommandPalette from './components/CommandPalette.vue'
import TerritoryTransit from './components/TerritoryTransit.vue'
import AmbientField from './components/AmbientField.vue'
import TerritoryMark from './components/TerritoryMark.vue'
import StarFieldBackdrop from './components/StarFieldBackdrop.vue'
import TerritoryScene from './components/TerritoryScene.vue'
import DashboardView from './views/DashboardView.vue'
import ViewLoading from './components/ViewLoading.vue'
import ViewError from './components/ViewError.vue'
import { THEME_ACCENTS } from './ui'
import { message as _msg } from './ui'

// 懒加载兜底:chunk 拉取失败(dev server 重启后旧标签页 404、发版后旧 hash chunk 失效)时
// 渲染 ViewError 让用户可重试,而不是 out-in 过渡移除旧视图后一片空白
const lazyView = (loader) => defineAsyncComponent({
  loader,
  loadingComponent: ViewLoading,
  errorComponent: ViewError,
  delay: 150,
  timeout: 10000,
})

// 首课向导同样懒加载:它静态引入 RoomEngine → three.js(505KB),同步进 App
// 会把 three 拖进首屏关键路径(每次访问白付 128KB gzip)。向导是自愿点开的
// 浮层,首次点开多一次 chunk 拉取,换来所有人的首屏提速
const Onboarding = lazyView(() => import('./components/Onboarding.vue'))

// 视图懒加载：首屏默认落仪表盘,其它视图 + three.js / 口/听/读写/语法等大依赖按需拉,避免初次加载 1.16MB
// Dashboard 走同步以保证首屏速度;其余走 defineAsyncComponent,切换时自然有淡入过渡占位
const VIEWS = {
  dashboard: DashboardView,
  learn:      lazyView(() => import('./views/LearnView.vue')),
  lab:        lazyView(() => import('./views/LabView.vue')),
  network:    lazyView(() => import('./views/NetworkView.vue')),
  galaxy:     lazyView(() => import('./views/GalaxyView.vue')),
  phonetics:  lazyView(() => import('./views/PhoneticsView.vue')),
  grammar:    lazyView(() => import('./views/GrammarView.vue')),
  listening:  lazyView(() => import('./views/ListeningView.vue')),
  speaking:   lazyView(() => import('./views/SpeakingView.vue')),
  reading:    lazyView(() => import('./views/ReadingView.vue')),
  tips:       lazyView(() => import('./views/TipsView.vue')),
  bookshelf:  lazyView(() => import('./views/BookshelfView.vue')),
  reader:     lazyView(() => import('./views/BookReaderView.vue')),
  family:     lazyView(() => import('./views/FamilyView.vue')),
  settings:   lazyView(() => import('./views/SettingsView.vue')),
  collections: lazyView(() => import('./views/CollectionsView.vue')),
  lexicon:    lazyView(() => import('./views/LexiconView.vue')),
  writing:    lazyView(() => import('./views/WritingView.vue')),
  diary:      lazyView(() => import('./views/DiaryView.vue')),
  mistakes:  lazyView(() => import('./views/MistakesView.vue')),
  site:      lazyView(() => import('./views/SiteView.vue')), // 官网首页(双场景电影式开场)
}

// ===== 领地过场(Territorial Transit) =====
const store = useUniverse()
// 切视图不再是 router 淡入淡出:先盖全屏星流过场 → 盖住期间换视图 → 领地名浮现后淡出。
const TERRITORIES = {
  dashboard:   { zh: '观星台',     latin: 'THE OBSERVATORY' },
  learn:       { zh: '学习舱',     latin: 'THE LEARNING POD' },
  lab:         { zh: '记忆工坊',   latin: 'THE MNEMONIC FORGE' },
  network:     { zh: '词汇网络',   latin: 'STELLAR NET' },
  galaxy:      { zh: '词汇圣殿',   latin: 'WORD GALAXY' },
  phonetics:   { zh: '发音舱',     latin: 'PHONETICS POD' },
  grammar:     { zh: '语法机械城', latin: 'MACHINE CITY' },
  listening:   { zh: '回声谷',     latin: 'ECHO CANYON' },
  speaking:    { zh: '口语竞技场', latin: 'SPEAKING ARENA' },
  reading:     { zh: '阅读号列车', latin: 'READING RAILS' },
  writing:     { zh: '写作工坊',   latin: 'WRITING WORKSHOP' },
  diary:       { zh: '英语日记',   latin: 'LOGBOOK' },
  tips:        { zh: '技巧库',     latin: 'FIELD NOTES' },
  bookshelf:   { zh: '轨道书库',   latin: 'ORBITAL LIBRARY' },
  reader:      { zh: '夜读舱',     latin: 'READING POD' },
  family:      { zh: '词根群星',   latin: 'ROOT FAMILIES' },
  collections: { zh: '收藏夹',     latin: 'COLLECTIONS' },
  lexicon:     { zh: '全量词库',   latin: 'FULL LEXICON' },
  mistakes:    { zh: '暗物质区',   latin: 'DARK MATTER' },
  settings:    { zh: '设置',       latin: 'SETTINGS' },
  site:        { zh: '词峰官网',   latin: 'WORDPEAK' },
}
const displayView = ref(store.view) // 实际渲染的视图(落后于 store.view,在过场掩护下切换)
// 有领地页头(.terr-head)的视图才挂 TerritoryMark:观星台用 HeroOrrery,设置/夜读舱保持安静,
// 圣殿/官网自带 3D。这样一次只存在一个页头星图画布,离开即销毁。
const MARK_VIEWS = new Set(['learn', 'lab', 'network', 'phonetics', 'grammar', 'listening', 'speaking', 'reading', 'writing', 'diary', 'tips', 'bookshelf', 'family', 'collections', 'lexicon', 'mistakes'])
const transit = ref(null)           // { zh, latin, k } 驱动 TerritoryTransit
let transitSeq = 0
let transitSwapT = 0
let transitEndT = 0
let lastTransitAt = 0 // 快速连切(<1.2s)直接换视图不过场:过场是电影语言,不该变成切换延迟
let firstViewChange = true // 启动期 ?view= 深链的首次赋值不算用户切换,不过场
watch(() => store.view, (v, old) => {
  if (v === old) return
  if (firstViewChange) { firstViewChange = false; displayView.value = v; return }
  const meta = TERRITORIES[v]
  const quick = Date.now() - lastTransitAt < 1200
  if (!meta || quick || window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) {
    displayView.value = v
    return
  }
  // 快速连续切换:序号递增,旧定时器即使触发也会因序号不匹配而失效
  const seq = ++transitSeq
  clearTimeout(transitSwapT)
  clearTimeout(transitEndT)
  lastTransitAt = Date.now()
  transit.value = { ...meta, k: seq }
  transitSwapT = setTimeout(() => { if (transitSeq === seq) displayView.value = v }, 320)
  transitEndT = setTimeout(() => { if (transitSeq === seq) transit.value = null }, 920)
})

// 各主题的 accent 映射(Naive 组件 + toast 用,与 styles.css token 保持同步,定义在 ui.js)
const THEME_BG = { dark: '#05070f', light: '#F7F5F0', violet: '#0a0814', catppuccin: '#11111b' }
// 语义色:宣纸收紧到 AA;暖夜用 catppuccin pastel;深空/紫罗兰共用霓虹系
const THEME_SEMANTIC = {
  light: { success: '#15803D', successHover: '#16A34A', warn: '#B45309', warnHover: '#D97706', error: '#DC2626', errorHover: '#b91c1c' },
  catppuccin: { success: '#a6e3a1', successHover: '#b3e9ae', warn: '#f9e2af', warnHover: '#fbe9c1', error: '#f38ba8', errorHover: '#f5a3bb' },
  dark: { success: '#4ade80', successHover: '#22c55e', warn: '#fbbf24', warnHover: '#f59e0b', error: '#f87171', errorHover: '#ef4444' },
}

const naiveTheme = computed(() => store.settings.theme === 'light' ? null : darkTheme)
const themeOverrides = computed(() => {
  const a = THEME_ACCENTS[store.settings.theme] || THEME_ACCENTS.dark
  const sem = THEME_SEMANTIC[store.settings.theme] || THEME_SEMANTIC.dark
  return {
    common: {
      primaryColor: a.primary, primaryColorHover: a.hover, primaryColorPressed: a.pressed,
      primaryColorSuppl: a.hover,
      successColor: sem.success, successColorHover: sem.successHover,
      warningColor: sem.warn, warningColorHover: sem.warnHover,
      errorColor: sem.error, errorColorHover: sem.errorHover,
      borderRadius: '10px',
    },
  }
})

// 主题应用:写 data-theme 到 html + 通知离散组件(toast)与 3D 引擎 + 更新浏览器主题色
function applyThemeToDom(t) {
  document.documentElement.setAttribute('data-theme', t)
  let meta = document.querySelector('meta[name="theme-color"]')
  if (!meta) {
    meta = document.createElement('meta')
    meta.setAttribute('name', 'theme-color')
    document.head.appendChild(meta)
  }
  meta.setAttribute('content', THEME_BG[t] || THEME_BG.dark)
  window.dispatchEvent(new CustomEvent('wv:themechange', { detail: { theme: t } }))
}

// 刷新页面时恢复会话 + 恢复主题(此前只有进设置页才会写 data-theme)
const bootError = ref(false) // 自动建号失败(后端不可达)时显示引导页错误
// WebGL 环境层失败(旧显卡/禁 WebGL)时退回 Canvas2D 星尘,不让页面留一块空底
const ambientFailed = ref(false)
function reloadPage() { window.location.reload() }
onMounted(async () => {
  store.loadSettings()
  // 默认即宣纸;不再跟随系统深色偏好把用户送进深空,想换主题去设置页选
  applyThemeToDom(store.settings.theme)
  store.loadChallengeStars()
  // 复习提醒:挂载时若 due 词数 > 15 一次性 toast(尊重 Settings 开关 wv_review_nudge)
  // 不阻塞引导流程,3s 后再 toast 让首屏先稳
  const nudge = (() => { try { return localStorage.getItem('wv_review_nudge') !== 'off' } catch { return true } })()
  setTimeout(() => {
    if (!nudge || !store.user) return
    const due = store.stats?.due_today ?? 0
    if (due > 15) _msg.info(`今天有 ${due} 个词到期复习——去观星台点一颗星开始`)
  }, 3000)
  const restored = await store.tryRestoreUser()   // 恢复用户(可能为 null)
  if (restored) {
    // 恢复成功:拉档案 + 知识库,把 loaded 置真,直接进主界面——
    // 不再过一遍教程(此前只有 Onboarding 最后一步才调 loadUniverse,
    // 导致每次刷新 loaded 都是 false,教程反复出现)
    store.loadProfile()
    try {
      await store.loadUniverse()
    } catch (e) {
      // 后端在刷新瞬间不可达时别静默失败(否则 unhandled rejection,loaded 永远为 false 卡在向导)
      console.error('[WordPeak] 知识库加载失败:', e)
      _msg.error('知识库加载失败，请刷新页面重试')
    }
  } else {
    // 第一次来:不再强制走完向导 —— 自动建个游客号直接进主页,
    // 首课(3D 房间 + 目标选择)变成 Dashboard 上的推荐,想学再点
    const GUEST_NAMES = ['旅人', '观星者', '漫游者', '追词人']
    try {
      const user = await api.ensureUser(GUEST_NAMES[Math.floor(Math.random() * GUEST_NAMES.length)])
      store.setUser(user)
      store.loadProfile()
      await store.loadUniverse()
    } catch (e) {
      // 连不上后端:给出明确的失败界面(而不是把用户挡在向导里)
      console.error('[WordPeak] 自动进入失败:', e)
      bootError.value = true
    }
  }
})

// 主题切换(SettingsView 改 store.settings.theme 后全站即时生效)
watch(() => store.settings.theme, applyThemeToDom)

// 回观星台的数据刷新由 DashboardView 自己的 onActivated 负责
// (refreshStats/loadActivity/loadPlan 等)——此前这里再 watch 一遍 view,
// 每次回页 stats 接口会被并发请求两次,纯重复,已删

// 调试钩子:?view=galaxy 启动时直接落点指定视图(给无头截图用,平时不感知)
onMounted(() => {
  const v = new URLSearchParams(location.search).get('view')
  if (v && ['learn', 'lab', 'network', 'galaxy', 'phonetics', 'grammar', 'listening', 'speaking', 'reading', 'writing', 'diary', 'dashboard', 'tips', 'bookshelf', 'reader', 'collections', 'mistakes', 'settings', 'family', 'lexicon'].includes(v)) {
    store.setView(v)
  }
})

// 鼠标跟随光晕：卡片上有跟随光标的高光(spotlight 技法,扩到所有 .card 衍生类)
// rAF 节流 + 按元素缓存 rect:每次 move 调 getBoundingClientRect 会强制同步 layout,
// 卡片密集页(观星台几十张卡)鼠标一动就掉帧
const SPOT_SEL = '.card, .weak-card, .entry-card, .rv-opt, .mega-tile, .theme-card, .book-rail-card, .family-word, .book-card, .rule-card, .tip-card, .root-card, .grammar-card, .passage-pick, .gd-card'
let spotEl = null, spotRect = null, moveQueued = false, lastEv = null
function flushSpot() {
  moveQueued = false
  const e = lastEv
  lastEv = null
  if (!e) return
  const el = e.target?.closest?.(SPOT_SEL)
  if (!el) return
  if (el !== spotEl) { spotEl = el; spotRect = el.getBoundingClientRect() }
  if (!spotRect) spotRect = el.getBoundingClientRect()
  el.style.setProperty('--mx', `${e.clientX - spotRect.left}px`)
  el.style.setProperty('--my', `${e.clientY - spotRect.top}px`)
}
let onSpotScroll
let onMove
// Phase 3.6:PWA 安装横幅(iOS 走人工引导,Chrome/Edge 走原生 beforeinstallprompt)
const installEvent = ref(null)
const installDismissed = ref(localStorage.getItem('wv_install_dismissed') === '1')
const installDelayed = ref(false) // 进站 30 秒后才允许横幅出现(见 onMounted 的 setTimeout)
const isIOS = ref(false)
const isStandalone = ref(false)

// 全局命令面板(Cmd/Ctrl+K):NavBar 按钮 / 快捷键 / 菜单都可触发
const showCommand = ref(false)
function onToggleCommand() { showCommand.value = !showCommand.value }
function closeCommand() { showCommand.value = false }

// 视图 chunk 加载失败后的重试:ViewError 派发 wv:retryView,这里自增计数拼进 :key
// 强制重挂载异步组件,重新发起 import(Vue 3 异步组件 reject 后重挂载会重新加载)
const viewAttempt = ref(0)
function onRetryView() { viewAttempt.value++ }

// 全站快捷键导航:g/p/l/s/r/t/w/d/c 进入对应模块(忽略输入框焦点),? 弹帮助
const KEY_TO_VIEW = { a: 'learn', o: 'lab', n: 'network', g: 'galaxy', p: 'phonetics', m: 'grammar', l: 'listening', s: 'speaking', r: 'reading', w: 'writing', e: 'diary', d: 'dashboard', t: 'tips', b: 'bookshelf', c: 'collections', i: 'mistakes', f: 'family' }
function onShortcuts(e) {
  // 在输入框/可编辑区不抢键
  const t = e.target
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
  if ((e.metaKey || e.ctrlKey || e.altKey) && e.key === 'k') return // 让 CommandPalette 接管
  if (e.key === '?') { showHelp.value = !showHelp.value; e.preventDefault(); return }
  if (e.key === 'Escape') {
    if (showHelp.value) { showHelp.value = false; e.preventDefault(); return }
    // 帮助面板承诺的「Esc 退出家族视角」:圣殿引擎监听这个事件(无家族锁定时是无害空操作)
    window.dispatchEvent(new CustomEvent('wv:unlockFamily'))
    return
  }
  if (!store.user || store.reviewOpen) return // 复习全屏层进行中不切视图(setView 会静默关掉复习,丢掉答题进度)
  const view = KEY_TO_VIEW[e.key.toLowerCase()]
  if (view) {
    // 词根群星从快捷键进=回索引态(别落在上次看过的旧词根详情)
    if (view === 'family') store.backToFamilyIndex()
    else store.setView(view)
    e.preventDefault()
  }
}
const showHelp = ref(false)

// Phase 2:#/word/<id> 分享链接 → 切到词汇圣殿并选中该星球
function handleHash() {
  // 官网路径:#/landing 展示官网 HTML(SPA 内部 redirect)
  if (window.location.hash === '#/landing') {
    window.location.href = '/landing/index.html'
    return
  }
  const m = /#\/word\/(\d+)/.exec(window.location.hash)
  if (m) {
    const id = Number(m[1])
    if (store.user) {
      store.openWordInGalaxy(id)
    }
  }
}

// Chrome/Edge 原生安装事件:先存事件,横幅显示与否由 installDelayed 单独控制
function onInstallable(e) {
  e.preventDefault()
  installEvent.value = e
}

onMounted(() => {
  onMove = (e) => {
    lastEv = e
    if (moveQueued) return
    moveQueued = true
    requestAnimationFrame(flushSpot)
  }
  document.addEventListener('pointermove', onMove, { passive: true })
  // 滚动后缓存的 rect 失效,下一帧重取
  onSpotScroll = () => { spotRect = null }
  window.addEventListener('scroll', onSpotScroll, { passive: true })
  window.addEventListener('wv:toggleCommand', onToggleCommand)
  window.addEventListener('wv:retryView', onRetryView)
  window.addEventListener('keydown', onShortcuts)
  window.addEventListener('hashchange', handleHash)
  handleHash()

  // 检测 iOS + 是否已经 standalone(从主屏启动)
  const ua = navigator.userAgent || ''
  isIOS.value = /iPhone|iPad|iPod/i.test(ua)
  isStandalone.value = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true

  window.addEventListener('beforeinstallprompt', onInstallable)
  // 横幅延迟 30 秒出现:别一进来就挡视线(iOS 人工引导同样适用)
  setTimeout(() => { installDelayed.value = true }, 30000)
})
onUnmounted(() => document.removeEventListener('pointermove', onMove))
onUnmounted(() => window.removeEventListener('scroll', onSpotScroll))
onUnmounted(() => window.removeEventListener('wv:toggleCommand', onToggleCommand))
onUnmounted(() => window.removeEventListener('wv:retryView', onRetryView))
onUnmounted(() => window.removeEventListener('keydown', onShortcuts))
onUnmounted(() => window.removeEventListener('hashchange', handleHash))
onUnmounted(() => window.removeEventListener('beforeinstallprompt', onInstallable))

async function install() {
  if (!installEvent.value) return
  installEvent.value.prompt()
  const choice = await installEvent.value.userChoice
  if (choice.outcome === 'accepted') _msg.success('已加入桌面 · 像 App 一样使用')
  installEvent.value = null
}
function dismissInstall() {
  installDismissed.value = true
  try { localStorage.setItem('wv_install_dismissed', '1') } catch {}
}
</script>

<template>
  <n-config-provider :theme="naiveTheme" :theme-overrides="themeOverrides">
    <!-- 全局背景光晕 + 共享 Three.js 环境天空 + 领地环境层(进入主页才显示) -->
    <AmbientField
      v-if="store.user && store.loaded && !ambientFailed && displayView !== 'site'"
      :view="displayView"
      @fail="ambientFailed = true"
    />
    <StarFieldBackdrop v-if="store.user && store.loaded && ambientFailed && displayView !== 'site'" />
    <TerritoryScene v-if="store.user && store.loaded" :view="displayView" />
    <!-- 3D 圣殿/官网首页自带整套场景与导航,光晕/星尘在其上纯属额外 GPU 开销 -->
    <div v-if="store.user && store.loaded && displayView !== 'galaxy' && displayView !== 'site'" class="app-bg-glow">
      <span class="glow-blob glow-a" />
      <span class="glow-blob glow-b" />
    </div>
    <!-- 首课向导:自愿浮层(Dashboard 推荐卡唤起),不再是进站门槛 -->
    <Onboarding v-if="store.onboardingOpen" />
    <!-- 启动门控:恢复会话 / 首次自动建号期间显示引导页(此前是拿向导当加载屏) -->
    <div v-else-if="!store.loaded" class="boot-gate">
      <div class="boot-gate-inner">
        <img class="boot-gate-mark light" src="/logo-mark.png" alt="" />
        <img class="boot-gate-mark dark" src="/logo-mark-dark.png" alt="" aria-hidden="true" />
        <div class="boot-gate-logo">词峰</div>
        <div class="boot-gate-latin">WORDPEAK</div>
        <div class="boot-gate-dots"><i /><i /><i /></div>
        <p v-if="!bootError" class="boot-gate-hint">正在进入你的学习宇宙…</p>
        <p v-else class="boot-gate-err">
          服务连不上 —— 确认后端已启动后
          <button class="boot-gate-reload" @click="reloadPage">刷新页面</button>
        </p>
      </div>
    </div>
    <div v-else class="app">
      <!-- 官网首页有自己的顶栏与场景:应用导航栏隐藏,避免双导航 -->
      <NavBar v-if="displayView !== 'site'" />
      <!-- 领地星座徽记:浮在页头右侧的 Three.js 小星图(随 .terr-head 定位) -->
      <TerritoryMark v-if="!ambientFailed && MARK_VIEWS.has(displayView)" :view="displayView" />
      <div class="app-main">
        <!-- KeepAlive:切视图不销毁——夜读舱的书/页、听力练习、错题 tab、学习进度
             这些子状态全部存活,重挂载+重复请求的顿挫也一并消失。
             各视图数据拉取在 onActivated 里做(见各视图),保持回页新鲜度 -->
        <transition name="view-fade" mode="out-in">
          <KeepAlive>
            <component :is="VIEWS[displayView]" :key="`${displayView}:${viewAttempt}`" />
          </KeepAlive>
        </transition>
      </div>

      <!-- 领地过场:视图切换的电影语言(星流航渡 + 领地名浮现) -->
      <Transition name="tt-fade">
        <TerritoryTransit v-if="transit" :transit="transit" />
      </Transition>
      <!-- 复习/挑战全屏层:全局挂载,任意视图都能从右上角进入今日挑战 -->
      <ReviewOverlay v-if="store.reviewOpen" />

      <!-- 全局命令面板 Cmd/Ctrl+K -->
      <CommandPalette :open="showCommand" @close="closeCommand" />

      <!-- 快捷键帮助面板(按 ? 唤出) -->
      <Transition name="help-fade">
        <div v-if="showHelp" class="help-mask" @click.self="showHelp = false">
          <div class="help-box">
            <div class="help-head">
              <div class="h-section">快捷键</div>
              <button class="modal-close" @click="showHelp = false">✕</button>
            </div>
            <div class="help-grid">
              <div class="help-row"><kbd>⌘/Ctrl</kbd>+<kbd>K</kbd><span>打开快速搜索</span></div>
              <div class="help-row"><kbd>?</kbd><span>本帮助面板</span></div>
              <div class="help-row"><kbd>Esc</kbd><span>关闭面板 / 退出家族视角</span></div>
              <div class="help-divider" />
              <div class="help-row"><kbd>a</kbd><span>学习舱</span></div>
              <div class="help-row"><kbd>o</kbd><span>记忆工坊</span></div>
              <div class="help-row"><kbd>n</kbd><span>词汇网络</span></div>
              <div class="help-row"><kbd>g</kbd><span>词汇圣殿</span></div>
              <div class="help-row"><kbd>p</kbd><span>发音舱</span></div>
              <div class="help-row"><kbd>m</kbd><span>语法机械城</span></div>
              <div class="help-row"><kbd>l</kbd><span>回声谷</span></div>
              <div class="help-row"><kbd>s</kbd><span>口语竞技场</span></div>
              <div class="help-row"><kbd>r</kbd><span>阅读号列车</span></div>
              <div class="help-row"><kbd>w</kbd><span>写作工坊</span></div>
              <div class="help-row"><kbd>e</kbd><span>英语日记</span></div>
              <div class="help-row"><kbd>d</kbd><span>观星台</span></div>
              <div class="help-row"><kbd>t</kbd><span>技巧库</span></div>
              <div class="help-row"><kbd>b</kbd><span>轨道书库</span></div>
              <div class="help-row"><kbd>c</kbd><span>收藏夹</span></div>
              <div class="help-row"><kbd>i</kbd><span>暗物质区</span></div>
              <div class="help-row"><kbd>f</kbd><span>词根群星</span></div>
            </div>
            <div class="help-foot">
              在输入框里按字母不会触发导航,专心打字。
            </div>
          </div>
        </div>
      </Transition>

      <!-- PWA 安装横幅(Chrome/Edge 触发 beforeinstallprompt 后,iOS 用人工引导) -->
      <Transition name="install-slide">
        <div v-if="installDelayed && !isStandalone && !installDismissed && (installEvent || isIOS) && store.user && store.loaded"
             class="install-banner"
             role="region" aria-label="添加到桌面">
          <div class="ib-icon">
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
              <rect x="5" y="2" width="14" height="20" rx="3" fill="none" stroke="currentColor" stroke-width="1.8" />
              <circle cx="12" cy="18" r="1" fill="currentColor" />
            </svg>
          </div>
          <div class="ib-body">
            <div class="ib-title">添加到桌面 · 像 App 一样用</div>
            <div v-if="installEvent" class="ib-sub">点击下方按钮,选「安装」即可在主屏幕打开</div>
            <div v-else-if="isIOS" class="ib-sub">
              Safari → 点底部分享按钮
              <svg class="ib-ios-share" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                <path d="M12 3v12m0-12-5 5m5-5 5 5M5 21h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
              → 选「添加到主屏幕」
            </div>
          </div>
          <div class="ib-actions">
            <button v-if="installEvent" class="btn small primary" @click="install">安装</button>
            <button class="ib-close" title="不再提醒" aria-label="关闭" @click="dismissInstall">✕</button>
          </div>
        </div>
      </Transition>
    </div>
  </n-config-provider>
</template>

<style>
.app-bg-glow { position: fixed; inset: 0; z-index: 0; pointer-events: none; overflow: hidden }
.glow-blob {
  position: absolute; border-radius: 50%; filter: blur(110px); opacity: 0.16;
  animation: blobDrift 22s ease-in-out infinite alternate;
}
.glow-a { width: 480px; height: 480px; background: var(--accent); top: -10%; left: -8%; animation-duration: 20s; opacity: 0.10; }
.glow-b { width: 420px; height: 420px; background: var(--accent-2); bottom: -12%; right: -6%; animation-duration: 26s; animation-direction: alternate-reverse; opacity: 0.10; }
@keyframes blobDrift { to { transform: translate(50px, 60px) scale(1.1); } }
.app { position: relative; z-index: 1 }

/* 视图切换过渡:淡入 + 轻微上移(过场盖住的换幕用,淡出掩护留给 tt-fade) */
.view-fade-enter-active, .view-fade-leave-active { transition: opacity 0.2s var(--ease), transform 0.2s var(--ease); }
.view-fade-enter-from { opacity: 0; transform: translateY(6px); }
.view-fade-leave-to { opacity: 0; transform: translateY(-4px); }

/* 领地过场:进场快(星流自己有起幅),退场慢半拍(领地名留在视网膜上) */
.tt-fade-enter-active { transition: opacity 0.16s var(--ease); }
.tt-fade-leave-active { transition: opacity 0.34s var(--ease); }
.tt-fade-enter-from, .tt-fade-leave-to { opacity: 0; }

/* PWA 安装横幅(底栏,左下,适配移动端宽度) */
.install-banner {
  position: fixed; left: 16px; right: 16px; bottom: 16px; z-index: 80;
  display: flex; align-items: center; gap: 12px;
  padding: 12px 16px;
  background: color-mix(in srgb, var(--surface) 88%, transparent);
  border: 1px solid var(--line-accent); border-radius: 14px;
  backdrop-filter: blur(20px) saturate(1.4);
  -webkit-backdrop-filter: blur(20px) saturate(1.4);
  box-shadow: 0 18px 48px color-mix(in srgb, var(--bg) 60%, transparent);
  max-width: 560px; margin: 0 auto;
}
.ib-icon { color: var(--accent); flex-shrink: 0; display: flex; }
.ib-body { flex: 1; min-width: 0; }
.ib-title { font-size: var(--fs-sm); font-weight: 600; }
.ib-sub { font-size: var(--fs-2xs); color: var(--text-2); margin-top: 2px; display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
.ib-ios-share { color: currentColor; vertical-align: -2px; }
.ib-actions { display: flex; gap: 6px; flex-shrink: 0; align-items: center; }
.ib-close {
  width: 28px; height: 28px; border-radius: 8px;
  background: transparent; border: 1px solid var(--line); color: var(--text-3);
  cursor: pointer; font-size: var(--fs-sm); line-height: 1;
  display: flex; align-items: center; justify-content: center;
  transition: all 0.15s var(--ease);
}
.ib-close:hover { background: var(--surface-hover); color: var(--text); }

.install-slide-enter-active, .install-slide-leave-active { transition: opacity 0.25s var(--ease), transform 0.3s var(--ease); }
.install-slide-enter-from, .install-slide-leave-to { opacity: 0; transform: translateY(20px); }

/* 快捷键帮助面板 */
.help-mask {
  position: fixed; inset: 0; z-index: 199;
  background: var(--scrim);
  backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
  display: flex; align-items: center; justify-content: center;
}
.help-box {
  width: min(540px, 92vw);
  background: color-mix(in srgb, var(--surface) 92%, transparent);
  border: 1px solid var(--line-strong); border-radius: 14px;
  padding: 22px 24px;
  box-shadow: var(--shadow-xl);
  backdrop-filter: blur(24px); -webkit-backdrop-filter: blur(24px);
}
.help-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; }
.help-grid { display: grid; grid-template-columns: 1fr; gap: 4px; font-size: var(--fs-sm); }
.help-row { display: flex; align-items: center; gap: 8px; color: var(--text-2); }
.help-row kbd { min-width: 28px; text-align: center; }
.help-row span { margin-left: auto; color: var(--text); }
.help-divider { height: 1px; background: var(--line); margin: 8px 0; }
.help-foot { margin-top: 12px; font-size: var(--fs-xs); color: var(--text-3); }
.help-fade-enter-active, .help-fade-leave-active { transition: opacity 0.18s var(--ease); }
.help-fade-enter-from, .help-fade-leave-to { opacity: 0; }

/* ===== 启动引导页:恢复会话 / 首次自动建号期间的门控(替代"拿向导当加载屏") ===== */
.boot-gate {
  position: fixed; inset: 0; z-index: 190;
  display: flex; align-items: center; justify-content: center;
  background: var(--bg);
}
.boot-gate-inner { text-align: center; animation: riseIn 0.5s var(--ease); }
.boot-gate-mark { height: 56px; width: auto; margin-bottom: 14px; }
.boot-gate-mark.dark { display: none; }
[data-theme='dark'] .boot-gate-mark.light,
[data-theme='violet'] .boot-gate-mark.light,
[data-theme='catppuccin'] .boot-gate-mark.light { display: none; }
[data-theme='dark'] .boot-gate-mark.dark,
[data-theme='violet'] .boot-gate-mark.dark,
[data-theme='catppuccin'] .boot-gate-mark.dark { display: block; }
.boot-gate-logo {
  font-size: 30px; font-weight: 700; letter-spacing: 0.3em; margin-left: 0.3em;
  background: var(--grad-text); -webkit-background-clip: text; background-clip: text; color: transparent;
}
.boot-gate-latin {
  margin-top: 6px; font-size: 11px; font-weight: 600; letter-spacing: 0.42em;
  margin-left: 0.42em; color: var(--text-3);
}
.boot-gate-dots { display: flex; gap: 7px; justify-content: center; margin: 18px 0 14px; }
.boot-gate-dots i { width: 7px; height: 7px; border-radius: 50%; background: var(--accent);
  animation: bootDot 1.2s infinite ease-in-out; }
.boot-gate-dots i:nth-child(2) { animation-delay: 0.15s; }
.boot-gate-dots i:nth-child(3) { animation-delay: 0.3s; }
@keyframes bootDot { 0%, 60%, 100% { transform: translateY(0); opacity: 0.4 } 30% { transform: translateY(-6px); opacity: 1 } }
.boot-gate-hint { font-size: var(--fs-sm); color: var(--text-3); }
.boot-gate-err { font-size: var(--fs-sm); color: var(--danger); }
.boot-gate-reload { background: transparent; border: 0; padding: 0; color: var(--accent);
  font: inherit; cursor: pointer; text-decoration: underline; }
</style>
