<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useUniverse } from '../stores/universe'

// 导航主次分层:学习区 9 项平铺(每天高频),工具资料区 9 项收进「工具」下拉
// 图标为词峰定制「天文仪器」语言:星座连线/轨道弧/四芒星/轨道节点 —— 与 3D 星系同源
const LEARN_TABS = [
  { key: 'dashboard', short: '总览', label: '观星台', icon: 'M3.5 10.6 12 3.2l8.5 7.4V21h-6.2v-5.6H9.7V21H3.5Z' },
  { key: 'galaxy', short: '词汇', label: '词汇圣殿', icon: 'M2.5 13.5 7 8 11.5 14.5 16 9.5 21.5 13M16 6.2m-.9 0a.9.9 0 1 0 1.8 0a.9.9 0 1 0-1.8 0' },
  { key: 'phonetics', short: '发音', label: '发音舱', icon: 'M7 12m-1.3 0a1.3 1.3 0 1 0 2.6 0a1.3 1.3 0 1 0-2.6 0M9.9 8.6A4.5 4.5 0 0 1 9.9 15.4M12.1 5.9A8 8 0 0 1 12.1 18.1M14.4 3.2A11.5 11.5 0 0 1 14.4 20.8' },
  { key: 'listening', short: '听力', label: '回声谷', icon: 'M12 12m-1.2 0a1.2 1.2 0 1 0 2.4 0a1.2 1.2 0 1 0-2.4 0M9.1 8.6A4.5 4.5 0 0 0 9.1 15.4M6.9 5.9A8 8 0 0 0 6.9 18.1M14.9 8.6A4.5 4.5 0 0 1 14.9 15.4M17.1 5.9A8 8 0 0 1 17.1 18.1' },
  { key: 'speaking', short: '口语', label: '口语竞技场', icon: 'M12 2 12.9 4.1 15 5 12.9 5.9 12 8 11.1 5.9 9 5 11.1 4.1ZM6.5 21v-6M12 21v-9M17.5 21v-7.5' },
  { key: 'grammar', short: '语法', label: '语法机械城', icon: 'M12 5 18.1 8.5V15.5L12 19 5.9 15.5V8.5ZM12 12 5.9 8.5M12 12l6.1-3.5M12 12V5' },
  { key: 'reading', short: '阅读', label: '阅读号列车', icon: 'M3.5 21 12 5.5M20.5 21 12 5.5M6.2 16H17.8M9 11H15M10.6 8H13.4M12 4m-1 0a1 1 0 1 0 2 0a1 1 0 1 0-2 0' },
  { key: 'writing', short: '写作', label: '写作工坊', icon: 'M3.5 21C8 17 11.5 13 14.2 8.8M17.5 3 18.2 4.8 20 5.5 18.2 6.2 17.5 8 16.8 6.2 15 5.5 16.8 4.8Z' },
]
const TOOL_TABS = [
  { key: 'learn', label: '学习舱', hint: 'a', icon: 'M4 16.5a8 8 0 0 1 16 0M8.5 16.5V13.8M12 16.5V10.8M15.5 16.5V12.8' },
  { key: 'lab', label: '记忆工坊', hint: 'o', icon: 'M12 4.5 19.5 17.5H4.5ZM7.5 20.5 5.8 16.8M12 20.5V13.8M16.5 20.5 18.2 16.8' },
  { key: 'network', label: '词汇网络', hint: 'n', icon: 'M12 3.5 13.2 9 18.5 10.2 13.2 11.4 12 16.9 10.8 11.4 5.5 10.2 10.8 9ZM5.5 5.5 7.2 6.5 6.5 8.3M18.5 5.5 16.8 6.5 17.5 8.3M5.5 18.5 7.2 17.5 6.5 15.7M18.5 18.5 16.8 17.5 17.5 15.7' },
  { key: 'tips', label: '技巧库', hint: 't', icon: 'M12 5.5 13.2 10.8 18.5 12 13.2 13.2 12 18.5 10.8 13.2 5.5 12 10.8 10.8ZM19 4 19.6 5.4 21 6 19.6 6.6 19 8 18.4 6.6 17 6 18.4 5.4ZM5.5 17.5 6 18.7 7.2 19.2 6 19.7 5.5 21 5 19.7 3.8 19.2 5 18.7Z' },
  { key: 'bookshelf', label: '轨道书库', hint: 'b', icon: 'M12 7C9.5 4.9 6 4.4 3.5 5.2V18.7c2.5-.8 6-.3 8.5 1.8M12 7c2.5-2.1 6-2.6 8.5-1.8V18.7c-2.5-.8-6-.3-8.5 1.8M12 4.2m-.9 0a.9.9 0 1 0 1.8 0a.9.9 0 1 0-1.8 0' },
  { key: 'family', label: '词根群星', hint: null, icon: 'M11 11 6.2 6.6M13.2 11.2 17.9 7M11.4 13.2 8 18.2M12 12m-1.2 0a1.2 1.2 0 1 0 2.4 0a1.2 1.2 0 1 0-2.4 0M5.5 5.8m-.9 0a.9.9 0 1 0 1.8 0a.9.9 0 1 0-1.8 0M18.6 6.2m-.9 0a.9.9 0 1 0 1.8 0a.9.9 0 1 0-1.8 0M7.6 18.8m-.9 0a.9.9 0 1 0 1.8 0a.9.9 0 1 0-1.8 0' },
  { key: 'collections', label: '收藏夹', hint: 'c', icon: 'M12 4 13.1 6.9 16 8 13.1 9.1 12 12 10.9 9.1 8 8 10.9 6.9ZM10.7 10.7 5.6 15.8M13.3 10.7 18.4 14.8M5.6 15.8m-1 0a1 1 0 1 0 2 0a1 1 0 1 0-2 0M18.4 14.8m-1 0a1 1 0 1 0 2 0a1 1 0 1 0-2 0' },
  { key: 'mistakes', label: '暗物质区', hint: 'i', icon: 'M12 3.5 13.4 10.6 20.5 12 13.4 13.4 12 20.5 10.6 13.4 3.5 12 10.6 10.6ZM19.8 7.5A9 9 0 1 1 4.2 7.5' },
  { key: 'diary', label: '英语日记', hint: 'e', icon: 'M12 4.5m-7.5 0a7.5 7.5 0 1 0 15 0a7.5 7.5 0 1 0-15 0M12 8.8 12.8 11.2 15.2 12 12.8 12.8 12 15.2 11.2 12.8 8.8 12 11.2 11.2ZM17.3 6.7 18.7 5.3' },
  { key: 'settings', label: '设置', hint: null, icon: 'M4 8H20M4 16H20M9 5.8 9.8 7.2 11.2 8 9.8 8.8 9 10.2 8.2 8.8 6.8 8 8.2 7.2ZM15 13.8 15.8 15.2 17.2 16 15.8 16.8 15 18.2 14.2 16.8 12.8 16 14.2 15.2Z' },
]
const TOOL_KEYS = TOOL_TABS.map((t) => t.key)

const store = useUniverse()
// 今日挑战是否已入账星(YYYY-MM-DD,与 store.claimChallengeStars 一致)
const todayStr = new Date().toLocaleDateString('sv')

// ---- 工具下拉 ----
const toolsOpen = ref(false)
const toolsWrap = ref(null)
const activeTool = computed(() => TOOL_KEYS.includes(store.view))
function toggleTools() { toolsOpen.value = !toolsOpen.value }
function closeTools() { toolsOpen.value = false }
// 点击面板外/按 Esc 收起
function onDocClick(e) {
  if (toolsOpen.value && toolsWrap.value && !toolsWrap.value.contains(e.target)) closeTools()
}
function onEsc(e) { if (e.key === 'Escape' && toolsOpen.value) closeTools() }
onMounted(() => { document.addEventListener('click', onDocClick); document.addEventListener('keydown', onEsc) })
onUnmounted(() => { document.removeEventListener('click', onDocClick); document.removeEventListener('keydown', onEsc) })
// 切走视图时顺手收起下拉
watch(() => store.view, () => { closeTools(); menuOpen.value = false })

function toggleCommand() { window.dispatchEvent(new CustomEvent('wv:toggleCommand')) }

// ---- 移动端抽屉菜单(<900px 由 CSS 控制显隐) ----
const menuOpen = ref(false)
function toggleMenu() { menuOpen.value = !menuOpen.value }
function pickTab(key) {
  store.setView(key)
  // 收藏夹/词根群星:从导航进=回索引态,而不是上次打开的旧详情
  // (详情态靠视图内的返回/导航闭环到达,导航 tab 永远代表「这个领地的门面」)
  if (key === 'collections') { store.currentCollectionId = null; store.collectionWords = [] }
  if (key === 'family') { store.currentRoot = null; store.fromView = null }
  if (key === 'collections') store.loadCollections()
  if (key === 'diary') store.loadDiary()
  closeTools()
  menuOpen.value = false
}
// 抽屉打开时锁住 body 滚动,避免背景跟着抽屉上下滚
watch(menuOpen, (open) => {
  if (typeof document === 'undefined') return
  document.body.style.overflow = open ? 'hidden' : ''
})
</script>

<template>
  <nav class="nav">
    <!-- 品牌:点击回到官网首页(双场景电影式开场页) -->
    <button class="nav-logo" title="词峰官网" @click="store.setView('site')">
      <!-- 品牌徽标:书页 + 水晶山 + 金色轨道/星芒,双版本随主题切换(SVG 在 44~50px 仍清晰) -->
      <img class="nav-logo-img light" src="/logo-mark.svg" alt="词峰徽标" />
      <img class="nav-logo-img dark" src="/logo-mark-dark.svg" alt="" aria-hidden="true" />
      <span class="nav-logo-lockup"><span class="zh">词峰</span><span class="en">WORDPEAK</span></span>
    </button>
    <div class="nav-tabs">
      <button
        v-for="tab in LEARN_TABS" :key="tab.key"
        class="nav-tab" :class="{ active: store.view === tab.key }"
        :title="tab.label"
        @click="pickTab(tab.key)"
      >
        <svg class="nav-tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path :d="tab.icon" /></svg>
        <span class="nav-tab-label">{{ tab.short || tab.label }}</span>
      </button>
    </div>

    <!-- 工具资料区:下拉收纳 -->
    <div ref="toolsWrap" class="nav-tools">
      <button
        class="nav-tab tools-trigger" :class="{ active: activeTool, open: toolsOpen }"
        @click.stop="toggleTools"
      >
        <span>工具</span>
        <svg class="tools-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
      </button>
      <Transition name="menu-fade">
        <div v-if="toolsOpen" class="nav-tools-menu" role="menu">
          <button
            v-for="t in TOOL_TABS" :key="t.key"
            class="tools-item" :class="{ active: store.view === t.key }"
            role="menuitem"
            @click="pickTab(t.key)"
          >
            <svg class="nav-tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path :d="t.icon" /></svg>
            <span class="ti-label">{{ t.label }}</span>
            <kbd v-if="t.hint">{{ t.hint }}</kbd>
          </button>
        </div>
      </Transition>
    </div>

    <div class="nav-user">
      <button
        class="btn small ghost search-btn"
        title="快速搜索（Cmd/Ctrl + K）"
        @click="toggleCommand"
      >⌕ <span class="kbd-hint">⌘K</span></button>
      <!-- 星数并进挑战按钮本体:少一枚金色胶囊,信息不丢(移动端抽屉里仍保留胶囊) -->
      <button
        class="btn small challenge-btn"
        :title="store.challengeClaimedDate === todayStr ? '今日星已入账,可再练一轮(不再计星)' : '10 题 · 限时 90 秒 · 做对入账星数'"
        @click="store.openChallenge()"
      >今日挑战<span v-if="store.challengeStars" class="cb-stars" title="累计挑战星数(每日首次入账)"><svg class="star-glyph" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.5l2 4.4 4.7.6-3.4 3.3.9 4.7L8 12.1l-4.2 2.4.9-4.7L1.3 6.5 6 5.9z"/></svg>{{ store.challengeStars }}</span></button>
      <span class="dot" />
      <!-- 桌面显示问候(含名字),待复习作静默后缀,不再单挂琥珀胶囊;窄屏由 CSS 切换成只显示名字 -->
      <b class="nav-hello">{{ store.greeting }}<span v-if="store.stats?.due_today > 0" class="due-note"> · {{ store.stats.due_today }} 待复习</span></b>
      <b class="nav-name">{{ store.user?.username || '…' }}</b>
    </div>

    <!-- 移动端汉堡按钮(CSS 里 <900px 才显示) -->
    <button
      class="nav-burger" :class="{ open: menuOpen }"
      aria-label="打开菜单" :title="menuOpen ? '收起菜单' : '打开菜单'"
      @click="toggleMenu"
    >
      <i /><i /><i />
    </button>
  </nav>

  <!-- 移动端抽屉菜单 -->
  <teleport to="body">
    <transition name="drawer-fade">
      <div v-if="menuOpen" class="nav-drawer-mask" @click="menuOpen = false" />
    </transition>
    <transition name="drawer-slide">
      <div v-if="menuOpen" class="nav-drawer">
        <div class="nav-drawer-user">
          <span class="dot" /><b>{{ store.greeting }}</b>
          <span v-if="store.challengeStars" class="chip star-chip">
            <svg class="star-glyph" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.5l2 4.4 4.7.6-3.4 3.3.9 4.7L8 12.1l-4.2 2.4.9-4.7L1.3 6.5 6 5.9z"/></svg>
            {{ store.challengeStars }}
          </span>
          <span v-if="store.stats?.due_today > 0" class="chip amber">{{ store.stats.due_today }} 个待复习</span>
        </div>
        <button
          class="btn small challenge-btn nav-drawer-challenge"
          :title="store.challengeClaimedDate === todayStr ? '今日星已入账,可再练一轮(不再计星)' : '10 题 · 限时 90 秒 · 做对入账星数'"
          @click="store.openChallenge()"
        >今日挑战</button>
        <button class="btn small nav-drawer-search" @click="toggleCommand(); menuOpen = false">⌕ 快速搜索</button>
        <div class="nav-drawer-tabs">
          <div class="drawer-group-label">学习</div>
          <button
            v-for="tab in LEARN_TABS" :key="tab.key"
            class="nav-drawer-tab" :class="{ active: store.view === tab.key }"
            @click="pickTab(tab.key)"
          >
            <svg class="nav-tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path :d="tab.icon" /></svg>
            <span class="ndt-label">{{ tab.label }}</span>
            <span class="ndt-arrow">→</span>
          </button>
          <div class="drawer-group-label">工具 · 资料</div>
          <button
            v-for="t in TOOL_TABS" :key="t.key"
            class="nav-drawer-tab" :class="{ active: store.view === t.key }"
            @click="pickTab(t.key)"
          >
            <svg class="nav-tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path :d="t.icon" /></svg>
            <span class="ndt-label">{{ t.label }}</span>
            <span class="ndt-arrow">→</span>
          </button>
        </div>
      </div>
    </transition>
  </teleport>
</template>

<style scoped>
/* 主导航项的小图标(线性,随文字变色) */
.nav-tab-icon { width: 17px; height: 17px; flex-shrink: 0; }

/* ===== 工具下拉 ===== */
.nav-tools { position: relative; }
.tools-trigger { gap: 4px; }
.tools-caret { width: 13px; height: 13px; transition: transform 0.2s var(--ease); }
.tools-trigger.open .tools-caret { transform: rotate(180deg); }
.nav-tools-menu {
  position: absolute; top: calc(100% + 10px); right: 0; z-index: 80;
  min-width: 216px; padding: 6px;
  background: var(--bg-3);
  border: 1px solid var(--line-strong);
  border-radius: 12px;
  box-shadow: var(--shadow-lg);
  display: flex; flex-direction: column; gap: 2px;
}
.tools-item {
  display: flex; align-items: center; gap: 10px;
  padding: 9px 12px; border-radius: 8px;
  background: transparent; border: 0; cursor: pointer;
  color: var(--text-2); font-size: var(--fs-sm); font-weight: 500; font-family: inherit;
  text-align: left;
  transition: all 0.15s var(--ease);
}
.tools-item .ti-label { flex: 1; }
.tools-item kbd {
  font-family: var(--mono); font-size: var(--fs-2xs); color: var(--text-3);
  padding: 1px 5px; border-radius: 4px;
  background: var(--surface-active); border: 1px solid var(--line);
}
.tools-item:hover { color: var(--text); background: var(--surface-hover); }
/* active:与主导航同语言——主文字色 + 选中底 + 左缘香槟金细条(菜单项用左缘条,区别于主导航的底部条) */
.tools-item.active { color: var(--text); background: var(--surface-active); font-weight: 600; box-shadow: inset 2px 0 0 #D6B681; }
/* 下拉展开动画 */
.menu-fade-enter-active, .menu-fade-leave-active { transition: opacity 0.16s var(--ease), transform 0.16s var(--ease); }
.menu-fade-enter-from, .menu-fade-leave-to { opacity: 0; transform: translateY(-6px); }

/* ===== 今日挑战按钮(静态渐变底,hover 提亮,不做无限脉冲;粉彩渐变主题下换深字) ===== */
.challenge-btn {
  background: var(--grad-warm);
  border-color: transparent;
  color: var(--on-warm, #fff);
  white-space: nowrap;
  box-shadow: 0 2px 10px color-mix(in srgb, var(--warn) 30%, transparent);
}
.challenge-btn:hover { filter: brightness(1.08); transform: translateY(-1px); }

/* 累计星数胶囊里的星形字符 */
.star-chip { gap: 5px; }
/* 挑战星数 = 点亮入账的星:金色胶囊(点亮=金,与圣殿/灯串同一语义),星形字符随色 */
.star-chip {
  color: var(--gold);
  border-color: color-mix(in srgb, var(--gold) 40%, transparent);
  background: color-mix(in srgb, var(--gold) 10%, transparent);
}
.star-glyph { width: 12px; height: 12px; fill: currentColor; flex-shrink: 0; }

/* 挑战星数并入按钮:随按钮文字色做轻后缀,不再单独发金光抢焦点 */
.cb-stars { display: inline-flex; align-items: center; gap: 4px; margin-left: 7px; opacity: 0.92; }
.cb-stars .star-glyph { width: 11px; height: 11px; }

/* 待复习并入问候的静默后缀:数字保留,重量卸掉(窄于 900px 随问候一起隐藏) */
.due-note { color: var(--text-3); font-weight: 400; }

/* 全局搜索按钮 */
.search-btn {
  font-family: var(--mono);
  display: inline-flex; align-items: center; gap: 6px;
  padding: 6px 12px;
}
.search-btn .kbd-hint {
  font-size: var(--fs-2xs); color: var(--text-3); padding: 1px 5px;
  background: var(--surface-active); border-radius: 4px;
  font-family: var(--mono);
}

/* ===== 移动端汉堡按钮(默认隐藏,<900px 显示;带字 tab 行单行需 ~1494px 视口,
   900~1599 只留图标,再窄直接进抽屉,杜绝两行折行) ===== */
.nav-burger {
  display: none;
  width: 40px; height: 40px;
  flex-direction: column; align-items: center; justify-content: center; gap: 4.5px;
  background: var(--surface); border: 1px solid var(--line);
  border-radius: 10px; cursor: pointer;
  transition: all 0.2s var(--ease);
}
.nav-burger i {
  display: block; width: 18px; height: 2px; border-radius: 1px;
  background: var(--text-2); transition: all 0.25s var(--ease);
}
.nav-burger:hover { border-color: var(--line-accent); }
.nav-burger.open i:nth-child(1) { transform: translateY(6.5px) rotate(45deg); }
.nav-burger.open i:nth-child(2) { opacity: 0; }
.nav-burger.open i:nth-child(3) { transform: translateY(-6.5px) rotate(-45deg); }

/* ===== 抽屉菜单 ===== */
.nav-drawer-mask {
  position: fixed; inset: 0; z-index: 70;
  background: var(--scrim);
  backdrop-filter: blur(4px);
}
.nav-drawer {
  position: fixed; top: 0; bottom: 0; left: 0; z-index: 71;
  width: min(300px, 84vw);
  background: var(--bg-2);
  border-right: 1px solid var(--line-strong);
  box-shadow: var(--shadow-xl);
  padding: 18px 14px 24px;
  overflow-y: auto;
  display: flex; flex-direction: column; gap: 12px;
}
.nav-drawer-user {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  padding: 10px 12px; border-radius: 12px;
  background: var(--surface); border: 1px solid var(--line);
  color: var(--text-2); font-size: var(--fs-sm);
}
.nav-drawer-user .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--success); }
.nav-drawer-user b { color: var(--text); font-weight: 600; }
.nav-drawer-challenge, .nav-drawer-search { justify-content: center; }
.nav-drawer-tabs { display: flex; flex-direction: column; gap: 4px; }
.drawer-group-label {
  padding: 10px 14px 4px;
  font-size: var(--fs-2xs); font-weight: 600; letter-spacing: 0.12em;
  /* 分组标签走领地 kicker 的语言:kicker = 金 */
  color: var(--gold); text-transform: uppercase;
}
.nav-drawer-tab {
  display: flex; align-items: center; gap: 12px;
  padding: 12px 14px; border-radius: 12px;
  background: transparent; border: 1px solid transparent;
  color: var(--text-2); font-size: var(--fs-base); font-weight: 500; font-family: inherit;
  cursor: pointer; text-align: left;
  transition: all 0.18s var(--ease);
}
.nav-drawer-tab .nav-tab-icon { width: 17px; height: 17px; }
.nav-drawer-tab .ndt-label { flex: 1; }
.nav-drawer-tab .ndt-arrow { font-size: var(--fs-xs); opacity: 0; transition: opacity 0.2s var(--ease); }
.nav-drawer-tab:hover { color: var(--text); background: var(--surface); }
.nav-drawer-tab.active {
  color: var(--text);
  background: var(--surface-active);
  border-color: transparent;
  font-weight: 600;
  box-shadow: inset 3px 0 0 #D6B681;
}
.nav-drawer-tab.active .ndt-arrow { opacity: 1; }

/* 抽屉过渡动画 */
.drawer-fade-enter-active, .drawer-fade-leave-active { transition: opacity 0.22s var(--ease); }
.drawer-fade-enter-from, .drawer-fade-leave-to { opacity: 0; }
.drawer-slide-enter-active, .drawer-slide-leave-active { transition: transform 0.28s var(--ease); }
.drawer-slide-enter-from, .drawer-slide-leave-to { transform: translateX(-100%); }

/* <900px:汉堡替代 tabs(图标带也在 900px 起步,再窄放不下) */
@media (max-width: 899.98px) {
  .nav-burger { display: flex; }
  /* 窄屏藏掉桌面下拉,分组已在抽屉里 */
  .nav-tools { display: none; }
}
</style>
