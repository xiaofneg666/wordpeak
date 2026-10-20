<script setup>
import { ref, computed, onActivated, onDeactivated, onUnmounted, watch } from 'vue'
import { useUniverse, MODULE_LABELS } from '../stores/universe'
import { message } from '../ui'
import EmptyState from '../components/EmptyState.vue'
import ShelfScene from '../components/ShelfScene.vue'

const store = useUniverse()

// ---- 轨道书库:一个场景 + 书 ----
// (用户:页面只要一个场景,所有书立在一座 3D 书架上,双击打开)
// 馆藏可读书(有章节,双击进夜读舱) + 纸书指南(立样本,双击摊开用法)全上架。
// hueVar:层板铭牌/书脊基色读哪个主题变量(classic/paper 用固定色)
const LIBRARY_REGIONS = [
  { key: 'literary', zh: '文学星系', latin: 'LITERARY GALAXY', hueVar: '--accent-2', sub: '故事与生活 · 星等 I–II 的起点' },
  { key: 'science', zh: '科普星云', latin: 'SCIENCE NEBULA', hueVar: '--accent', sub: '新闻 · 人文 · 科普 · 星等 III 的远航' },
  { key: 'classic', zh: '经典星环', latin: 'CLASSIC RING', hueVar: '#f2ead8', sub: '公版经典改写 · 星等 IV 的深空' },
]
const PAPER_REGION = { key: 'paper', zh: '参考阅览室', latin: 'PAPER COMPASS', hueVar: '#d9c79a', sub: '要买回家的纸书指南 · 馆里立样本' }
// 纸书指南那层板只在有指南时亮出(空数据不摆空板)
const REGIONS = computed(() => (store.books.length ? [...LIBRARY_REGIONS, PAPER_REGION] : LIBRARY_REGIONS))
const ROMAN = { 1: 'I', 2: 'II', 3: 'III', 4: 'IV' }

// 纸书指南的类别 → 主题色变量(书脊上的星等/饰线用哪个色系)
const CAT_COLOR_VARS = {
  '音标发音': '--accent', '语法': '--accent-2', '词汇': '--success',
  '速成': '--warn', '听说': '--info', '阅读': '--accent-3',
}

// 上架的全部书:馆藏书 + 纸书指南(映射成同一本书的形状,挂 guide 原件)
const shelfBooks = computed(() => [
  ...store.library,
  ...store.books.map((b, i) => ({
    id: 'paper-' + i,
    region: 'paper',
    level: Math.max(1, Math.min(4, b.stars || 3)),
    title: b.title,
    en_title: b.en_title,
    one_line: `${b.author} 著 · ${plain(b.desc).slice(0, 30)}`,
    chapters: [], // 指南没有馆藏章节:进度/鎏金逻辑自然全走零
    word_focus: [b.category],
    accentVar: CAT_COLOR_VARS[b.category] || '--accent',
    guide: b, // 原始指南数据:书签卡/抽屉摊开用
  })),
])

const chapterSum = computed(() => store.library.reduce((n, b) => n + b.chapters.length, 0))
const readSum = computed(() => store.library.reduce((n, b) => n + b.chapters.filter((c) => c.read).length, 0))
const regionCount = (key) => shelfBooks.value.filter((b) => b.region === key).length
// 星域小签:铭牌同款主题色(变量名→var(),固定色直接用)
function chipStyle(r) {
  const c = r.hueVar?.startsWith('--') ? `var(${r.hueVar})` : (r.hueVar || '#f2ead8')
  return { '--hc': c }
}

const doneCount = (b) => b.chapters.filter((c) => c.read).length
const starState = (b) => {
  const d = doneCount(b)
  return d === 0 ? 'dust' : d >= b.chapters.length ? 'done' : 'reading'
}

// ---- 书库首屏:当前阅读 / 快捷入口 / 底部三卡(对齐参考稿的轨道书库门面) ----
const hallEl = ref(null)
const routeSteps = ['选书', '阅读', '摘录', '复习']
const currentBook = computed(() => {
  const list = store.library || []
  if (!list.length) return null
  return list.find((b) => b.chapters.some((c) => !c.read)) || list[0]
})
const currentChapter = computed(() => {
  const b = currentBook.value
  if (!b) return null
  return b.chapters.find((c) => !c.read) || b.chapters[0] || null
})
const currentDone = computed(() => (currentBook.value ? doneCount(currentBook.value) : 0))
const currentTotal = computed(() => currentBook.value?.chapters.length || 0)
const currentPct = computed(() => (currentTotal.value ? Math.round((currentDone.value / currentTotal.value) * 100) : 0))
const readBookCount = computed(() => (store.library || []).filter((b) => b.chapters.length && b.chapters.every((c) => c.read)).length)
function exploreShelf() {
  hallEl.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
function continueReading() {
  if (currentBook.value) openLibraryBook(currentBook.value)
}
// 双击馆藏书脊直接翻开进夜读舱,深链到第一个未读章;整本读完则回第一章(重读)
function openLibraryBook(b) {
  drawerBook.value = null // 双击翻开时若抽屉还挂着,先收掉
  const c = b.chapters.find((x) => !x.read) || b.chapters[0]
  store.pendingBook = { bookId: b.id, no: c?.no || 1 }
  store.setView('reader')
}
// 书脊交互(来自 ShelfScene):桌面悬停/单击钉书签卡、双击打开(馆藏→夜读舱,指南→摊开用法);
// 窄屏(≤640)没有 hover,单击弹底部抽屉(快速双击同样直接打开)
const drawerBook = ref(null)
function onDrawerEsc(e) { if (e.key === 'Escape') drawerBook.value = null }
watch(drawerBook, (b) => {
  if (b) window.addEventListener('keydown', onDrawerEsc)
  else window.removeEventListener('keydown', onDrawerEsc)
})
onUnmounted(() => window.removeEventListener('keydown', onDrawerEsc))
function drawerEnter(b, c) { drawerBook.value = null; enterChapter(b, c) }
function drawerOpen(b) { drawerBook.value = null; openLibraryBook(b) }
// 指南的"在词峰怎么练"模块按钮:收抽屉再跳
function drawerGo(m) { drawerBook.value = null; go(m) }

// 点书签卡里的章节:直达那一章(没挂正文的章不硬跳,给句话免得"点了没反应")
function enterChapter(b, c) {
  if (!c.passage_id) { message.info('这一章的正文还没装配好，晚点再来'); return }
  store.pendingBook = { bookId: b.id, no: c.no }
  store.setView('reader')
}

// 回到书架时刷新 read 标记(读完一章回来自动升档)
onActivated(() => {
  if (store.user) store.refreshLibrary() // KeepAlive:回书架刷新已读进度弧(ShelfScene 按场景签名消化,没变不动 3D 房间)
  warmReader()
})
onDeactivated(() => { drawerBook.value = null }) // 切走时抽屉必收(KeepAlive 挂着 Teleport)

// 跳转预热:书架的主出口就是夜读舱,闲时把它的懒加载 chunk 先拉到手——
// 双击翻开时领地过场底下直接命中模块缓存,不再现等网络(同一模块即同一 chunk)
let readerWarm = false
function warmReader() {
  if (readerWarm) return
  readerWarm = true
  const warm = () => { import('./BookReaderView.vue').catch(() => {}) }
  if ('requestIdleCallback' in window) window.requestIdleCallback(warm, { timeout: 2500 })
  else setTimeout(warm, 900)
}

const MODULE_VIEWS = {
  galaxy: 'galaxy', phonetics: 'phonetics', grammar: 'grammar',
  listening: 'listening', speaking: 'speaking', reading: 'reading',
  tips: 'tips', bookshelf: 'bookshelf', dashboard: 'dashboard', review: 'galaxy',
}
// MODULE_LABELS 从 store 统一导出(与 NavBar/Tips/领地一致)
// 未映射的 key 不再静默吞掉(点了没反应最难排查):落到观星台并打警告
function go(view) {
  const v = MODULE_VIEWS[view] || 'dashboard'
  if (view && !MODULE_VIEWS[view]) console.warn('[Bookshelf] 未映射的模块 key,兜回观星台:', view)
  store.setView(v)
}
const PIC_RE = /\p{Extended_Pictographic}️?/gu
function plain(s) { return String(s || '').replace(PIC_RE, '').replace(/ {2,}/g, ' ').trim() }
</script>

<template>
  <div class="view-scroll">
    <div class="view-inner fade-in">
      <div class="terr-head">
        <div class="terr-kicker">TERRITORY · ORBITAL LIBRARY</div>
        <h2 class="terr-title"><BlurText text="轨道书库" as="span" /></h2>
        <div class="terr-latin">ORBITAL LIBRARY</div>
        <div class="terr-rule" aria-hidden="true" />
        <p class="terr-sub">
          馆藏可读书与纸书指南全立在这一座 <b class="text-accent">3D 书架</b>上——拖动环视，悬停或单击看书目，
          <b class="text-accent">双击打开</b>（馆藏进夜读舱，指南摊开用法）；读一章鎏金一分。
        </p>
        <div class="lib-actions">
          <button class="btn primary lib-btn" :disabled="!currentBook" @click="continueReading">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5C7 4.6 10 4.9 12 6.4c2-1.5 5-1.8 8-.9v12.6c-3-.9-6-.6-8 .9-2-1.5-5-1.8-8-.9ZM12 6.4v12.5" /></svg>
            继续阅读
          </button>
          <button class="btn lib-btn" @click="exploreShelf">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17ZM15.5 8.5l-2 5-5 2 2-5Z" /></svg>
            探索藏书
          </button>
          <div class="lib-summary mono">
            <span><b>{{ store.library.length }}</b> 本藏书</span><i />
            <span><b>{{ readBookCount }}</b> 本已读</span><i />
            <span><b>{{ chapterSum }}</b> 章正文</span>
          </div>
        </div>
      </div>

      <!-- 加载骨架 -->
      <div v-if="store.fetching" class="skeleton sk-block" :style="{ height: '480px' }" />

      <!-- 书没上架:空态 -->
      <EmptyState
        v-else-if="!shelfBooks.length"
        icon="馆" title="书架上还一本书都没有"
        desc="馆藏还在装配中——晚点再来开馆"
      />

      <!-- 一个场景:一座 3D 书架装下全部的书(总览栏 + 书架 + 鎏金注脚,整页就这一张卡) -->
      <section v-else ref="hallEl" class="main-hall">
        <header class="hall-rail">
          <div class="hall-brand">
            <span class="hall-zh">馆藏总览</span>
            <span class="hall-latin mono">COLLECTION OVERVIEW</span>
          </div>
          <div class="hall-chips">
            <span
              v-for="r in REGIONS" :key="r.key" class="hall-chip" :style="chipStyle(r)"
              :title="r.sub"
            >
              <i class="hc-dot" aria-hidden="true" />{{ r.zh }}<i class="hc-num mono">{{ regionCount(r.key) }}</i>
            </span>
          </div>
          <div class="hall-stats mono">
            <span class="hs"><b><CountNum :v="readSum" mono /></b> / {{ chapterSum }} CHAPTERS READ</span>
            <span class="hs"><b>{{ store.library.length }}</b> BOOKS</span>
            <span v-if="store.books.length" class="hs"><b>{{ store.books.length }}</b> GUIDES</span>
          </div>
        </header>

        <div class="hall-stage">
          <ShelfScene
            :books="shelfBooks" :regions="REGIONS"
            @open="openLibraryBook"
            @guide="(b) => (drawerBook = b)"
            @chapter="(x) => enterChapter(x.book, x.chapter)"
            @tap="(b) => (drawerBook = b)"
          />
        </div>

        <!-- 当前阅读:从书架数据里挑第一本还有未读章的书,叠在暗厅右侧(参考稿的「当前阅读」卡) -->
        <aside v-if="currentBook" class="current-reading">
          <div class="cr-kicker mono">CURRENT READ · 当前阅读</div>
          <div class="cr-book">
            <div class="cr-cover" aria-hidden="true">
              <span class="cr-cover-kicker">WORDPEAK LIBRARY</span>
              <strong>{{ currentBook.en_title || currentBook.title }}</strong>
              <span>{{ currentBook.title }}</span>
              <i>✦</i>
            </div>
            <div class="cr-info">
              <div class="cr-title">{{ currentBook.title }}</div>
              <div class="cr-chapter">{{ currentChapter?.title || '从第一章开始' }}</div>
              <div class="cr-meta mono">MAGNITUDE {{ ROMAN[currentBook.level] || 'I' }} · {{ currentDone }}/{{ currentTotal }} 章</div>
            </div>
          </div>
          <div class="cr-bar"><i :style="{ width: currentPct + '%' }" /></div>
          <div class="cr-foot"><span>阅读进度</span><b>{{ currentPct }}%</b></div>
          <button class="btn primary cr-btn" @click="continueReading">继续阅读 <span>→</span></button>
        </aside>
        <footer class="hall-foot mono">读一章，书脊鎏金一分　·　整本读完，通体鎏金立在架上</footer>
      </section>

      <!-- 底部三卡:继续阅读 / 主题书架 / 阅读路线(参考稿的三段式收尾) -->
      <div class="lib-trio">
        <button class="lib-card" :disabled="!currentBook" @click="continueReading">
          <span class="lc-cover" aria-hidden="true"><i>✦</i></span>
          <span class="lc-body">
            <b>继续阅读</b>
            <small>{{ currentBook?.title || '从书架挑一本开始' }}</small>
          </span>
          <span class="lc-arrow">→</span>
        </button>
        <button class="lib-card" @click="exploreShelf">
          <span class="lc-icon">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19V5h6v14M14 19V5h6v14M2 19h20M7 8h1M7 11h1M7 14h1M16 8h1M16 11h1M16 14h1" /></svg>
          </span>
          <span class="lc-body">
            <b>主题书架</b>
            <small>文学星系 · 科普星云 · 经典星环 · 参考阅览室</small>
          </span>
          <span class="lc-arrow">→</span>
        </button>
        <div class="lib-card static">
          <span class="lc-icon">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 18V6M4 18h16M7 14l3-3 3 2 4-5" /><circle cx="7" cy="14" r="1.2" /><circle cx="10" cy="11" r="1.2" /><circle cx="13" cy="13" r="1.2" /><circle cx="17" cy="8" r="1.2" /></svg>
          </span>
          <span class="lc-body">
            <b>阅读路线</b>
            <span class="lc-steps">
              <i v-for="(st, idx) in routeSteps" :key="st"><em>{{ idx + 1 }}</em>{{ st }}</i>
            </span>
          </span>
        </div>
      </div>

      <!-- 书签抽屉:窄屏点书弹出;馆藏=章节/进度,指南=怎么用 -->
      <Teleport to="body">
        <Transition name="sd-fade">
          <div v-if="drawerBook" class="sd-mask" @click.self="drawerBook = null">
            <div class="star-drawer" :class="starState(drawerBook)">
              <button class="sd-close unstyled-btn" aria-label="收起" @click="drawerBook = null">✕</button>

              <!-- 馆藏书:章节/进度/重读 -->
              <template v-if="drawerBook.chapters.length">
                <span class="sc-kicker mono">MAGNITUDE {{ ROMAN[drawerBook.level] }} · {{ drawerBook.chapters.length }} 章 · 已读 {{ doneCount(drawerBook) }}/{{ drawerBook.chapters.length }}</span>
                <div class="sc-title">{{ drawerBook.title }}</div>
                <span class="sc-en">{{ drawerBook.en_title }}</span>
                <p class="sc-line">{{ drawerBook.one_line }}</p>
                <div class="sc-roots mono">{{ drawerBook.word_focus.map((r) => r.toUpperCase()).join(' · ') }}</div>
                <ol class="sc-chapters">
                  <li v-for="c in drawerBook.chapters" :key="c.no">
                    <button class="sc-ch unstyled-btn" :class="{ lit: c.read }" @click="drawerEnter(drawerBook, c)">
                      <i class="ch-dot" aria-hidden="true" />
                      <span class="ch-no mono">{{ c.no }}</span>
                      <span class="ch-title">{{ c.title }}</span>
                      <span class="ch-state">{{ c.read ? '已读' : '进入' }}</span>
                    </button>
                  </li>
                </ol>
                <button class="btn small primary sd-open" @click="drawerOpen(drawerBook)">翻开这本书 →</button>
              </template>

              <!-- 纸书指南:摊开用法(馆里立样本,内容要买实体书回家看) -->
              <template v-else>
                <span class="sc-kicker mono">PAPER GUIDE · {{ drawerBook.guide.badge }}</span>
                <div class="sc-title">{{ drawerBook.title }}</div>
                <span class="sc-en">{{ drawerBook.en_title }}</span>
                <p class="sc-author">{{ drawerBook.guide.author }} 著 · {{ drawerBook.guide.category }}</p>
                <p class="sc-line">{{ plain(drawerBook.guide.desc) }}</p>
                <div class="gd-diff">
                  <span>难度</span>
                  <span class="dots"><i v-for="d in 5" :key="d" class="dot" :class="{ on: d <= drawerBook.guide.difficulty }" /></span>
                  <span class="gd-stars mono">★ {{ drawerBook.guide.stars }}/5</span>
                </div>
                <div class="tags">
                  <span v-for="t in drawerBook.guide.tags" :key="t" class="tag">{{ t }}</span>
                </div>
                <div class="gd-usage">
                  <div class="gd-usage-label">在词峰怎么练</div>
                  <p>{{ plain(drawerBook.guide.how_to_use) }}</p>
                  <div class="book-links">
                    <button
                      v-for="m in drawerBook.guide.related_modules" :key="m"
                      class="btn small" @click="drawerGo(m)"
                    >{{ MODULE_LABELS[m] || m }} →</button>
                  </div>
                </div>
                <p class="sd-note mono">馆里立的是样本 · 内容请把实体书买回家看</p>
              </template>
            </div>
          </div>
        </Transition>
      </Teleport>
    </div>
  </div>
</template>

<style scoped>
/* ---------- 一个场景:主馆一体卡(总览栏 + 3D 书架 + 鎏金注脚) ---------- */
.sk-block { border-radius: 18px; }

/* ---------- 门面:参考稿的「继续阅读 / 探索藏书 + 馆藏读数」 ---------- */
.lib-actions {
  display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
  margin-top: 20px;
}
.lib-btn { border-radius: 999px; padding: 10px 18px; }
.lib-btn svg {
  width: 16px; height: 16px; flex-shrink: 0;
  fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round;
}
.lib-summary {
  margin-left: auto; display: flex; align-items: center; gap: 10px;
  font-size: var(--fs-2xs); letter-spacing: 0.1em; color: var(--text-3);
}
.lib-summary b { font-size: var(--fs-sm); color: var(--text); font-weight: 700; font-variant-numeric: tabular-nums; }
.lib-summary i { width: 3px; height: 3px; border-radius: 50%; background: var(--line-strong); }
@media (max-width: 720px) {
  .lib-actions { gap: 9px; }
  .lib-btn { flex: 1; justify-content: center; }
  .lib-summary { margin-left: 0; width: 100%; padding-top: 4px; }
}

/* ---------- 主馆:暗厅 + 当前阅读卡(参考稿右侧卡) ---------- */
.main-hall {
  position: relative;
  border-color: color-mix(in srgb, var(--gold) 24%, var(--line-strong));
  box-shadow:
    0 26px 64px -32px rgba(32, 54, 83, 0.48),
    0 0 0 1px color-mix(in srgb, var(--gold) 10%, transparent) inset;
}
.current-reading {
  position: absolute; right: 20px; top: 72px; z-index: 4;
  width: 272px; padding: 17px 18px 16px;
  border-radius: 18px;
  border: 1px solid color-mix(in srgb, #D6B681 58%, transparent);
  background: linear-gradient(165deg, rgba(255, 253, 247, 0.97), rgba(245, 238, 225, 0.92));
  color: #203653;
  box-shadow: 0 20px 46px rgba(2, 6, 14, 0.38);
  backdrop-filter: blur(16px) saturate(1.15);
  -webkit-backdrop-filter: blur(16px) saturate(1.15);
}
.cr-kicker {
  font-size: 9px; letter-spacing: 0.2em; color: #8F6B2A;
  margin-bottom: 10px;
}
.cr-book { display: flex; gap: 12px; align-items: stretch; }
.cr-cover {
  width: 72px; height: 96px; flex-shrink: 0;
  display: flex; flex-direction: column;
  padding: 8px 7px;
  border-radius: 5px;
  background: linear-gradient(150deg, #3D5A85 0%, #2C4568 58%, #173654 100%);
  border: 1px solid rgba(214, 182, 129, 0.38);
  box-shadow: 0 7px 18px rgba(2, 6, 14, 0.28);
  color: #F7F1E4; overflow: hidden;
}
.cr-cover-kicker {
  font-size: 5.5px; letter-spacing: 0.14em; color: #D6B681; line-height: 1.3;
}
.cr-cover strong {
  font-family: var(--serif); font-size: 9.5px; line-height: 1.28; font-weight: 600;
  margin-top: 7px;
  display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;
}
.cr-cover > span:not(.cr-cover-kicker) {
  font-size: 7px; line-height: 1.3; color: rgba(247, 241, 228, 0.62);
  margin-top: 4px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis;
}
.cr-cover i { margin-top: auto; align-self: flex-end; color: #D6B681; font-style: normal; font-size: 11px; }
.cr-info { min-width: 0; flex: 1; display: flex; flex-direction: column; }
.cr-title {
  font-family: var(--serif); font-size: 16px; font-weight: 600; line-height: 1.3;
  color: #203653;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.cr-chapter {
  font-size: 11px; color: #56657C; line-height: 1.5; margin-top: 5px;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.cr-meta { margin-top: auto; font-size: 8.5px; letter-spacing: 0.06em; color: #7E8A9B; line-height: 1.5; }
.cr-bar {
  height: 5px; border-radius: 999px; overflow: hidden;
  background: rgba(32, 54, 83, 0.12); margin-top: 14px;
}
.cr-bar i { display: block; height: 100%; border-radius: inherit; background: linear-gradient(90deg, #C9A45C, #8F6B2A); }
.cr-foot { display: flex; justify-content: space-between; align-items: baseline; margin-top: 6px; font-size: 10px; color: #66738A; }
.cr-foot b { font-family: var(--mono); color: #203653; font-size: 12px; }
.cr-btn {
  width: 100%; justify-content: center; margin-top: 12px;
  border-radius: 999px; font-size: 12px; padding: 9px 12px;
  background: linear-gradient(135deg, #2C4568, #3D5A85);
  border-color: transparent; color: #FFFFFF;
  box-shadow: 0 4px 14px rgba(32, 54, 83, 0.25);
}
.cr-btn:hover { filter: brightness(1.08); box-shadow: 0 7px 20px rgba(32, 54, 83, 0.32); }
@media (max-width: 1279.98px) { .current-reading { display: none; } }

/* ---------- 底部三卡 ---------- */
.lib-trio {
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px;
  margin-top: 16px;
}
.lib-card {
  display: flex; align-items: center; gap: 12px;
  min-height: 86px; padding: 15px 18px;
  background: var(--surface); border: 1px solid var(--line); border-radius: 16px;
  text-align: left; font-family: inherit; cursor: pointer;
  transition: transform 0.22s var(--ease), border-color 0.22s var(--ease), box-shadow 0.22s var(--ease);
}
.lib-card:hover { border-color: var(--line-accent); transform: translateY(-2px); box-shadow: var(--shadow-md); }
.lib-card.static { cursor: default; }
.lib-card.static:hover { border-color: var(--line); transform: none; box-shadow: none; }
.lib-card:disabled { opacity: 0.55; cursor: not-allowed; transform: none; }
.lc-cover {
  width: 34px; height: 46px; flex-shrink: 0;
  border-radius: 4px;
  background: linear-gradient(150deg, #3D5A85 0%, #2C4568 58%, #173654 100%);
  border: 1px solid rgba(214, 182, 129, 0.42);
  box-shadow: 0 4px 10px rgba(2, 6, 14, 0.18);
  display: flex; align-items: flex-end; justify-content: flex-end;
  padding: 4px; color: #D6B681; font-size: 9px;
}
.lc-cover i { font-style: normal; line-height: 1; }
.lc-icon {
  width: 40px; height: 40px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  border-radius: 12px;
  background: color-mix(in srgb, var(--accent) 9%, transparent);
  color: var(--accent);
}
.lc-icon svg {
  width: 20px; height: 20px;
  fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round;
}
.lc-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.lc-body b { font-size: var(--fs-base); font-weight: 600; color: var(--text); }
.lc-body small {
  font-size: var(--fs-2xs); color: var(--text-3); line-height: 1.5;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.lc-arrow { color: var(--text-3); font-size: var(--fs-md); transition: transform 0.22s var(--ease), color 0.22s var(--ease); }
.lib-card:hover .lc-arrow { transform: translateX(3px); color: var(--accent); }
.lc-steps { display: flex; align-items: center; flex-wrap: wrap; gap: 3px; }
.lc-steps i { display: inline-flex; align-items: center; gap: 4px; font-style: normal; font-size: 10px; color: var(--text-3); }
.lc-steps i + i::before { content: '→'; color: var(--line-strong); margin-right: 2px; }
.lc-steps em {
  width: 16px; height: 16px; border-radius: 50%;
  border: 1px solid var(--line-accent); color: var(--accent);
  display: inline-flex; align-items: center; justify-content: center;
  font-style: normal; font-size: 8.5px;
}
@media (max-width: 960px) {
  .lib-trio { grid-template-columns: 1fr; }
}

/* BlurText 接管「轨道书库」入场:全局 terrRise 在本视图置空,避免双重动画 */
.terr-title { animation: none; }

.main-hall {
  border: 1px solid var(--line-strong);
  border-radius: 18px;
  overflow: hidden;
  background: #0b0e18;
  box-shadow: var(--shadow-scene, 0 18px 44px -24px rgba(0, 0, 0, 0.6));
}
/* 场景嵌入卡内:去掉自带描边/圆角,由主馆卡统一收口 */
.hall-stage > .shelf-scene { border: 0; border-radius: 0; }
.hall-rail {
  display: flex; align-items: center; flex-wrap: wrap; gap: 10px 18px;
  padding: 11px 18px;
  background: linear-gradient(180deg, rgba(17, 21, 34, 0.92), rgba(12, 15, 25, 0.78));
  border-bottom: 1px solid rgba(190, 200, 220, 0.1);
}
.hall-brand { display: flex; flex-direction: column; gap: 2px; }
.hall-zh {
  font-family: var(--serif);
  font-size: var(--fs-md); font-weight: 700; letter-spacing: 0.14em; color: #eee5d3;
}
.hall-latin { font-size: var(--fs-2xs); letter-spacing: 0.3em; color: var(--accent); }
.hall-chips { display: flex; flex-wrap: wrap; gap: 7px; }
.hall-chip {
  display: inline-flex; align-items: center; gap: 6px;
  font-size: var(--fs-2xs); letter-spacing: 0.08em; padding: 3.5px 11px; border-radius: 999px;
  color: color-mix(in srgb, var(--hc) 82%, #eee5d3);
  border: 1px solid color-mix(in srgb, var(--hc) 40%, transparent);
  background: color-mix(in srgb, var(--hc) 9%, transparent);
}
.hc-dot {
  width: 5px; height: 5px; border-radius: 50%; background: var(--hc);
  box-shadow: 0 0 6px color-mix(in srgb, var(--hc) 60%, transparent);
}
.hc-num { font-size: var(--fs-2xs); font-style: normal; opacity: 0.66; margin-left: 2px; }
.hall-stats {
  margin-left: auto; display: flex; gap: 16px;
  font-size: var(--fs-2xs); letter-spacing: 0.18em; color: rgba(196, 206, 226, 0.72);
  font-variant-numeric: tabular-nums;
}
.hs b { color: var(--gold-scene); font-size: var(--fs-sm); font-weight: 700; }
.hall-foot {
  padding: 9px 16px; text-align: center;
  font-size: var(--fs-2xs); letter-spacing: 0.22em; color: rgba(217, 199, 154, 0.78);
  background: linear-gradient(180deg, rgba(12, 15, 25, 0.86), rgba(10, 13, 22, 0.94));
  border-top: 1px solid rgba(190, 200, 220, 0.08);
}
@media (max-width: 640px) {
  .hall-rail { gap: 8px 12px; padding: 10px 12px; }
  .hall-stats { margin-left: 0; gap: 12px; }
}

/* ---------- 书签卡/抽屉的内容排版(3D 架的悬停卡在 ShelfScene 自带卡壳;这里管抽屉) ---------- */
.sc-kicker { font-size: var(--fs-2xs); letter-spacing: 2px; color: var(--accent); display: block; }
.sc-title { font-size: var(--fs-md); font-weight: 700; margin: 5px 0 2px; }
.star-drawer.done .sc-title { color: var(--gold); }
.sc-en { font-size: var(--fs-2xs); font-style: italic; color: var(--text-3); display: block; }
.sc-line { font-size: var(--fs-xs); color: var(--text-2); line-height: 1.65; margin: 8px 0; }
.sc-author { font-size: var(--fs-xs); color: var(--accent); margin: 6px 0 0; }
.sc-roots {
  font-size: var(--fs-2xs); letter-spacing: 1.8px; color: var(--text-3);
  border-top: 1px solid var(--line); padding-top: 8px; margin-bottom: 6px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}

/* 抽屉里的章节列表才给滚动(章节数普遍 ≤6,高度自然展开) */
.sc-chapters { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
.star-drawer .sc-chapters { max-height: 38vh; overflow-y: auto; }
.sc-ch {
  display: flex; align-items: center; gap: 9px; width: 100%;
  padding: 6px 8px; border-radius: 8px; font-size: var(--fs-xs); color: var(--text-2);
  text-align: left; transition: background 0.2s var(--ease-out-3), color 0.2s var(--ease-out-3);
}
.sc-ch:hover { background: color-mix(in srgb, var(--accent) 10%, transparent); color: var(--text); }
.ch-dot { flex: 0 0 auto; width: 5px; height: 5px; border-radius: 50%; background: var(--text-3); opacity: 0.5; transition: background 0.3s var(--ease-out-3), box-shadow 0.3s var(--ease-out-3); }
.sc-ch.lit .ch-dot { background: var(--gold); box-shadow: 0 0 6px color-mix(in srgb, var(--gold) 60%, transparent); }
.ch-no { font-size: var(--fs-2xs); color: var(--text-3); width: 16px; }
.ch-title { flex: 1; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.sc-ch.lit .ch-title { color: var(--text); }
.ch-state { font-size: var(--fs-2xs); color: var(--text-3); letter-spacing: 1px; }
.sc-ch.lit .ch-state { color: var(--gold-dim); }
.sc-ch:hover .ch-state { color: var(--accent); }
.sc-open { width: 100%; justify-content: center; margin-top: 10px; }

/* 晴空主题:白天看不见星星的光晕 */
[data-theme='light'] .sc-ch.lit .ch-dot { box-shadow: none; }
[data-theme='light'] .ch-state { color: var(--text-3); }

/* 指南抽屉的内容(难度点/标签/怎么练) */
.gd-diff { display: flex; align-items: center; gap: 8px; margin-top: 10px; font-size: var(--fs-2xs); color: var(--text-3); }
.gd-stars { margin-left: auto; color: var(--warn); letter-spacing: 1px; font-size: var(--fs-2xs); }
.dots { display: inline-flex; gap: 5px; }
.dot { width: 8px; height: 8px; border-radius: 50%; background: color-mix(in srgb, var(--text-3) 18%, transparent); }
.dot.on { background: var(--grad-accent); box-shadow: 0 0 8px color-mix(in srgb, var(--accent) 50%, transparent); }
.tags { display: flex; gap: 7px; flex-wrap: wrap; margin-top: 12px; }
.tag { font-size: var(--fs-2xs); color: var(--text-2); background: color-mix(in srgb, var(--info) 7%, transparent); border: 1px solid color-mix(in srgb, var(--info) 15%, transparent); padding: 2px 9px; border-radius: 6px; }
.gd-usage { margin-top: 10px; padding-top: 10px; border-top: 1px dashed var(--line); }
.gd-usage-label { font-size: var(--fs-2xs); font-weight: 700; color: var(--text-2); margin-bottom: 6px; }
.gd-usage p { font-size: var(--fs-xs); color: var(--text); line-height: 1.65; }
.book-links { display: flex; gap: 7px; flex-wrap: wrap; margin-top: 10px; }
.sd-note { margin-top: 12px; font-size: var(--fs-2xs); letter-spacing: 0.16em; color: var(--text-3); text-align: center; }

/* 窄屏书签抽屉(≤640px 没有 hover 书签卡,点书脊弹出这张底部卡) */
.sd-mask {
  position: fixed; inset: 0; z-index: 150;
  background: var(--scrim);
  display: flex; align-items: flex-end; justify-content: center;
}
.star-drawer {
  position: relative; width: min(480px, 100%);
  max-height: 82vh; overflow-y: auto;
  padding: 18px 20px 20px;
  background: var(--surface);
  border: 1px solid var(--line-accent); border-bottom: 0;
  border-radius: 18px 18px 0 0;
}
.sd-close {
  position: absolute; top: 12px; right: 12px;
  width: 30px; height: 30px; border-radius: 9px;
  color: var(--text-3); font-size: var(--fs-sm); display: flex; align-items: center; justify-content: center;
  transition: background 0.2s, color 0.2s;
}
.sd-close:hover { background: var(--surface-hover); color: var(--text); }
.sd-open { width: 100%; justify-content: center; margin-top: 12px; }
.sd-fade-enter-active { transition: opacity 0.22s var(--ease); }
.sd-fade-leave-active { transition: opacity 0.18s var(--ease); }
.sd-fade-enter-from, .sd-fade-leave-to { opacity: 0; }
.sd-fade-enter-active .star-drawer { transition: transform 0.26s var(--ease); }
.sd-fade-enter-from .star-drawer { transform: translateY(40px); }
</style>
