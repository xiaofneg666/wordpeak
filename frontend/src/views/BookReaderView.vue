<script setup>
import { ref, computed, watch, onMounted, onUnmounted, onActivated, onDeactivated, nextTick } from 'vue'
import { useUniverse } from '../stores/universe'
import { message } from '../ui'
import LookupMenu from '../components/LookupMenu.vue'
import EmptyState from '../components/EmptyState.vue'
import BookPage from '../components/BookPage.vue'
import { speak } from '../speech'
import { api } from '../api'
import { parseRootStory } from '../utils/rootStory.js'

const store = useUniverse()

// ---- 深链进舱:pendingBook { bookId, no } 或 URL ?book=&ch= ----
const bookId = ref(null)
const curNo = ref(1)
const showCover = ref(true)    // 进舱先见封面,点「翻开」才进入正文
const opening = ref(false)     // 封面翻开动画中

const book = computed(() => store.library.find((b) => b.id === bookId.value))
const chapter = computed(() => book.value?.chapters.find((c) => c.no === curNo.value))
const passage = computed(() =>
  chapter.value ? store.passages.find((p) => p.id === chapter.value.passage_id) : null)
const ROMAN = { 1: 'I', 2: 'II', 3: 'III', 4: 'IV' }

// ---- 分页书:把章内容(题头/正文段/章末测/生词表/翻章)切成真实书页 ----
const pages = ref([])          // [{ blocks: [...] }]
const curPage = ref(0)
const flipping = ref(null)     // { dir: 'next' | 'prev', to } 翻页动画中
const settling = ref(false)    // 动画收尾:瞬断 transition 回 0,避免反向弹回
const stageEl = ref(null)
const measureEl = ref(null)
// 对开分栏判定:≥721px 左右对开;窄屏退成单页书(左半页隐藏、翻面绕左缘)
const mql = window.matchMedia('(min-width: 721px)')
const isWide = ref(mql.matches)

const paragraphs = computed(() => {
  const ss = passage.value?.sentences || []
  const out = []
  let i = 0, take = 4
  while (i < ss.length) { out.push(ss.slice(i, i + take)); i += take; take = take === 4 ? 3 : 4 }
  return out
})

// 全部内容块(顺序:题头 → 正文段 → 章末测 → 判分 → 生词表 → 翻章)
// 子句切分:标点留在前块末尾;千分位数字(1,000)后面不切
function splitClauses(en) {
  const parts = String(en || '').split(/(?<=[;,:])(?!\d)\s+/)
  return parts.length > 1 ? parts : [en]
}
const allBlocks = computed(() => {
  const ps = passage.value
  if (!ps) return []
  const bl = [{ k: 'title' }]
  let si = 0
  for (const par of paragraphs.value) {
    // 子句级分块:横版版心一次只装得下两三个子句,整句(400-800px)会顶破页高。
    // 在 ; : , 处断开让句子跨页——真书本来就允许句中翻页。同句各子句共享句子号 si
    // (整句高亮/句法透镜按整句走)。
    // 一段一翻译:整段译文独立成块跟在段末句后——块高独立可量,页界自然分开,
    // 也避免"段末子句+整段译文"挤成超页高的缩放页
    par.forEach((s, j) => {
      const frags = splitClauses(s.en)
      frags.forEach((en, f) => bl.push({
        k: 'para', paras: [{ en }],
        si: si + j, full: s.en,
        last: f === frags.length - 1,
        tail: j === par.length - 1 && f === frags.length - 1, // 段末子句:段距兜底(showZh 关时生效)
      }))
    })
    bl.push({ k: 'zh', text: par.map((x) => x.zh || '').join(''), tail: true })
    si += par.length
  }
  bl.push({ k: 'quiz-head' })
  ps.questions.forEach((q, qi) => bl.push({ k: 'q', qi }))
  if (submitted.value) bl.push({ k: 'verdict' })
  if (sessionWords.value.length) bl.push({ k: 'vocab' })
  bl.push({ k: 'turn' })
  return bl
})

// 分页:把所有块渲染进隐形测量层(与半页书同宽),逐块量高度装箱到半页高内。
// 块间距在 BookPage 里用 padding(计入 offsetHeight),margin 会被量漏。
// LEAF_CHROME:半页竖向装帧占位(页眉36+页码34+版心上下padding36+呼吸20),与 CSS 对齐
const LEAF_CHROME = 126
// 同句相邻子句并回一句再渲染:分页按子句量高(保证装得下),成页后同句合流成连续文本——
// 真书的句子是连排的,子句只在页界断开。并流只会更矮(省掉逐块的 padding),不会顶破页
function mergeClauses(blocks) {
  const out = []
  for (const b of blocks) {
    const prev = out[out.length - 1]
    if (b.k === 'para' && prev?.k === 'para' && prev.si === b.si) {
      out[out.length - 1] = { ...b, paras: [{ en: prev.paras[0].en + ' ' + b.paras[0].en }] }
    } else out.push({ ...b })
  }
  return out
}
let pageSeq = 0
async function buildPages() {
  if (!passage.value || !stageEl.value || !measureEl.value) return
  await nextTick()
  const seq = ++pageSeq
  const inner = measureEl.value.querySelector('.rb-page-inner')
  if (!inner || !inner.children.length) return
  const stageH = stageEl.value.clientHeight
  if (stageH < 300) return // 封面盖着(display:none)时 stage 量高为 0:跳过,开书/字体就绪/落定兜底都会再排
  const boxH = stageH - LEAF_CHROME
  const out = []
  let p = [], h = 0, fit = 1
  ;[...inner.children].forEach((el, i) => {
    const bh = el.offsetHeight
    if (p.length && h + bh > boxH) { out.push({ idxs: p, fit }); p = []; h = 0; fit = 1 }
    // 超长句自占一页:整页按可用高 zoom(下限 0.80——缩得比正文小一截就失去意义,宁可页内轻滚)
    if (bh > boxH) fit = Math.max(0.80, Math.min(1, (boxH - 8) / bh))
    p.push(i); h += bh
  })
  if (p.length) out.push({ idxs: p, fit })
  if (seq !== pageSeq) return
  pages.value = out.map((o) => ({ blocks: mergeClauses(o.idxs.map((i) => allBlocks.value[i])), fit: o.fit }))
  if (curPage.value > spreads.value.length - 1) curPage.value = Math.max(0, spreads.value.length - 1)
}
// 鲸鱼页(单块超高自占一页)的缩放:句子连同中译文等比缩,不破书相也不页内滚动
const fitStyle = (page) => (page?.fit < 1 ? { zoom: String(page.fit) } : null)

// ---- 对开跨页:物理页两两成跨;章首从右页起(recto 开章,真书的规矩),左页留白不编号 ----
// 窄屏(<721px)退成单页书:一页一跨、左半页隐藏,翻面绕左缘
const spreads = computed(() => {
  const ps = pages.value
  if (!ps.length) return []
  if (!isWide.value) return ps.map((p, i) => ({ left: null, right: p, folioL: null, folioR: i + 1 }))
  const out = [{ left: null, right: ps[0], folioL: null, folioR: 1 }]
  for (let i = 1; i < ps.length; i += 2)
    out.push({ left: ps[i], right: ps[i + 1] || null, folioL: i + 1, folioR: ps[i + 1] ? i + 2 : null })
  return out
})
const curSpread = computed(() => spreads.value[curPage.value] || null)
const targetSpread = computed(() => (flipping.value ? spreads.value[flipping.value.to] || null : null))
// 静态底跨:对开时翻页中各露该露的半页(next 左压当前/右露目标;prev 镜像);单页时底=目标页
const baseLeft = computed(() => {
  if (!isWide.value) return null
  const s = flipping.value?.dir === 'prev' ? targetSpread.value : curSpread.value
  return s ? { page: s.left, folio: s.folioL } : null
})
const baseRight = computed(() => {
  const s = !isWide.value
    ? (flipping.value ? targetSpread.value : curSpread.value)
    : (flipping.value?.dir === 'next' ? targetSpread.value : curSpread.value)
  return s ? { page: s.right, folio: s.folioR } : null
})
// 翻面层:对开时 next=右半页绕中缝左翻(纸的背面正是下一跨的左页),prev 镜像;
// 单页时翻的就是当前这页(背面=白纸),底页露目标
const flipFront = computed(() => {
  if (!flipping.value || !curSpread.value) return null
  if (!isWide.value) return { page: curSpread.value.right, folio: curSpread.value.folioR, side: 'r' }
  return flipping.value.dir === 'next'
    ? { page: curSpread.value.right, folio: curSpread.value.folioR, side: 'r' }
    : { page: curSpread.value.left, folio: curSpread.value.folioL, side: 'l' }
})
const flipBack = computed(() => {
  if (!flipping.value || !targetSpread.value) return null
  if (!isWide.value) return { page: null, folio: null, side: 'r' }
  return flipping.value.dir === 'next'
    ? { page: targetSpread.value.left, folio: targetSpread.value.folioL, side: 'l' }
    : { page: targetSpread.value.right, folio: targetSpread.value.folioR, side: 'r' }
})
const onQuizPage = computed(() => {
  const s = curSpread.value
  return [...(s?.left?.blocks || []), ...(s?.right?.blocks || [])].some((b) => b.k === 'quiz-head' || b.k === 'q')
})
const pagerLabel = computed(() => {
  const n = spreads.value.length
  if (!n) return 'PAGE …'
  const s = spreads.value[Math.min(curPage.value, n - 1)]
  const cur = [s.folioL, s.folioR].filter(Boolean).map((x) => String(x).padStart(2, '0')).join('–')
  const last = spreads.value[n - 1]
  return `PAGE ${cur} / ${String(last.folioR || last.folioL).padStart(2, '0')}`
})
// 半页装帧助手:章首页(含题头块)按真书规矩不排页眉页码
const hasTitle = (page) => (page?.blocks || []).some((b) => b.k === 'title')
const pad2 = (n) => String(n ?? '').padStart(2, '0')

// ---- 翻页:右半页绕中缝 3D 翻面(前翻)/左半页镜像(回翻);边界顺延上一章/下一章 ----
// 首章首跨/末章末跨是硬边界:按钮置灰(此前点了没反应,是最典型的「死按钮」)
const atStart = computed(() => isFirst.value && curPage.value <= 0)
const atEnd = computed(() => !!isLast.value && curPage.value >= spreads.value.length - 1)
function flip(dir) {
  if (flipping.value || showCover.value || !spreads.value.length) return
  const to = dir === 'next' ? curPage.value + 1 : curPage.value - 1
  if (to < 0) { if (!isFirst.value) goChapter(curNo.value - 1); return }
  if (to >= spreads.value.length) { if (!isLast.value) goChapter(curNo.value + 1); return }
  flipping.value = { dir, to }
  // 动画走完:先瞬断 transition,归位页码再撤销翻面层,避免反向弹回
  setTimeout(() => {
    settling.value = true
    requestAnimationFrame(() => {
      curPage.value = to
      requestAnimationFrame(() => { flipping.value = null; settling.value = false })
    })
  }, 640)
}

// 传给 BookPage 的公共 props
const pageProps = computed(() => ({
  questions: passage.value?.questions || [],
  showZh: showZh.value,
  activeSi: activeSi.value,
  answered: answered.value,
  results: results.value,
  submitted: submitted.value,
  sessionWords: sessionWords.value,
  chapter: chapter.value,
  curNo: curNo.value,
  isFirst: isFirst.value,
  isLast: isLast.value,
}))

onMounted(() => {
  // ?view=reader&book=lib-lighthouse&ch=2 直达(书签/推荐深链用,只在首次挂载消费)
  const q = new URLSearchParams(location.search)
  const b = q.get('book')
  if (b) { bookId.value = b; curNo.value = Number(q.get('ch')) || 1 }
  window.addEventListener('keydown', onKey)
  window.addEventListener('resize', onResize)
  mql.addEventListener('change', onMqlChange)
  document.addEventListener('scroll', popFollow, true) // 旁注随滚动贴词重定位
  document.addEventListener('pointerdown', popDocDown, true) // 点空白收旁注
  document.fonts?.ready.then(() => buildPages()) // 字体就位后重排一次,否则页高量偏
})
// KeepAlive 回舱:书架书签卡可能带着新书/新章进来(pendingBook 每次激活都消费)
onActivated(() => {
  const pb = store.pendingBook
  if (!pb?.bookId) return
  store.pendingBook = null
  if (pb.bookId !== bookId.value) {
    // 换书:重置章测/生词状态(以前靠重挂载天然清零),重播封面
    bookId.value = pb.bookId
    curNo.value = pb.no || 1
    answered.value = {}; results.value = {}; submitted.value = null
    activeSi.value = -1; learned.value = new Set()
    curPage.value = 0
    showCover.value = true
  } else if ((pb.no || 1) !== curNo.value) {
    goChapter(pb.no || 1) // 同书换章:回到该章第一页,不重播封面
  }
})
onUnmounted(() => {
  window.removeEventListener('keydown', onKey)
  window.removeEventListener('resize', onResize)
  mql.removeEventListener('change', onMqlChange)
  document.removeEventListener('scroll', popFollow, true)
  document.removeEventListener('pointerdown', popDocDown, true)
  cancelAnimationFrame(popRaf)
})

function onKey(e) {
  if (e.key === 'ArrowRight') { flip('next'); e.preventDefault() }
  else if (e.key === 'ArrowLeft') { flip('prev'); e.preventDefault() }
  else if (e.key === 'Escape' && popWord.value) { popWord.value = null }
}
function onMqlChange(e) { isWide.value = e.matches; buildPages() }
let rzT = 0
function onResize() { clearTimeout(rzT); rzT = setTimeout(() => { buildPages(); placePop() }, 160) }

// 章节变化/中文辅助切换/判分/生词表变化 → 重排页
watch(() => passage.value?.id, () => { curPage.value = 0; buildPages() }, { immediate: true })
watch(() => [showZh.value, submitted.value, sessionWords.value.length, store.loaded], () => buildPages())

// ---- 翻开封面 ----
// 封皮荡开 1s 走完再卸载整本书:动画中途卸载会砍掉收尾(书体渐隐/正文摆正)
function openBook() {
  if (opening.value) return
  opening.value = true
  // 封面态正文是藏着的(display:none),翻开这一下正文见光,立刻补量一次真实页高;
  // 荡开落定(showCover 卸下)时再排一次,兜住开书动画期间任何瞬时测量
  nextTick(() => buildPages())
  setTimeout(() => { showCover.value = false; buildPages() }, 1050)
}

// ---- 翻章(回到第一页,不重播封面) ----
function goChapter(no) {
  if (!book.value || no < 1 || no > book.value.chapters.length) return
  curNo.value = no
  curPage.value = 0
  answered.value = {}
  results.value = {}
  submitted.value = null
  activeSi.value = -1
  learned.value = new Set()
  nextTick(() => buildPages())
}
const isFirst = computed(() => curNo.value <= 1)
const isLast = computed(() => book.value && curNo.value >= book.value.chapters.length)

// ---- 中文辅助(全局开关,默认开:分级书的中英对照是设计的一部分) ----
const showZh = ref(true)

// ---- 词卡(旁注):夹在书页边的批注签 —— 不用全屏遮罩,不遮正文 ----
const popWord = ref(null)
const popEl = ref(null)
const popStyle = ref({})
// 推书让位:宽书两翼静态放不下词卡时,整书向对侧平移腾翼(书是被推开的,不是被盖住的)
const bookShift = ref(0)
const wrapStyle = computed(() => (bookShift.value ? { transform: `translateX(${bookShift.value}px)` } : null))
let popAnchor = null // 点击的词元:旁注跟着词走(滚动重定位)
function openWord(w, e) {
  if (e) e.stopPropagation()
  if (w) {
    popWord.value = w
    popAnchor = e?.target?.closest?.('.rb-word') || null
    nextTick(() => placePop())
  }
}
// ---- 任意词 AI 卡:词库外的词也点得开 —— 五维讲解(解释/记法/技巧/运用/语法) ----
// popWord 存词库对象(卡走词库版式)或字符串词元(卡走 AI 版式),popIsAny 分流
const popAny = ref({ word: '', loading: false, data: null, error: '' })
const popIsAny = computed(() => typeof popWord.value === 'string')
async function openAnyWord(tok, e) {
  if (e) e.stopPropagation()
  if (!tok) return
  popWord.value = tok
  popAnchor = e?.target?.closest?.('.rb-word') || null
  nextTick(() => placePop())
  if (popAny.value.word === tok && (popAny.value.data || popAny.value.loading)) return // 同词已讲/在途,复用
  popAny.value = { word: tok, loading: true, data: null, error: '' }
  try {
    const r = await api.explain({ mode: 'word', word: tok, userId: store.user?.id })
    if (popWord.value !== tok) return // 途中换了词,这次回包作废
    popAny.value = { word: tok, loading: false, data: r, error: '' }
    nextTick(() => placePop()) // 讲解进场高度变了,旁注重新落位
  } catch (err) {
    if (popWord.value !== tok) return
    popAny.value = { word: tok, loading: false, data: null, error: err?.message || '讲解暂不可用' }
    nextTick(() => placePop())
  }
}
// 落位:词在哪半边,卡停哪侧翼——整页正文零遮挡。宽书静态翼放不下 380 卡时
// 「推书让位」:整书向对侧平移腾出全宽翼,平移量以"书不推出屏"为上限;
// 翼 ≥300 先静态收窄(不动书);都放不下(窄屏)才贴词侧放(仍无遮罩)
function placePop() {
  const card = popEl.value
  if (!card || !popWord.value) return
  const vw = window.innerWidth, vh = window.innerHeight
  const sr = document.querySelector('.rb-stage')?.getBoundingClientRect()
  if (!sr) return
  // 静止位(扣掉当前推书量):翼宽预算按书没被推开来算
  const baseL = sr.left - bookShift.value, baseR = sr.right - bookShift.value
  const leftWing0 = baseL - 16, rightWing0 = vw - 16 - baseR
  const a = popAnchor?.getBoundingClientRect()
  const ax = a ? a.left + a.width / 2 : vw / 2
  const ay = a ? a.top + a.height / 2 : vh / 2
  const wantRight = ax >= (sr.left + sr.right) / 2 // 词在书哪半边,卡停哪侧
  const sideWing0 = wantRight ? rightWing0 : leftWing0
  let cw = Math.min(380, vw - 24)
  let shift = 0
  if (sideWing0 < cw + 16) {
    if (sideWing0 >= 300) {
      cw = Math.max(290, Math.floor(sideWing0 - 10)) // 静态收窄:翼够 300 就不动书
    } else if (vw >= 980) {
      const offWing0 = wantRight ? leftWing0 : rightWing0
      const budget = offWing0 - 16            // 推书上限:书不出屏
      const need = cw + 20 - sideWing0        // 全宽卡缺口
      if (budget >= need) {
        shift = wantRight ? -need : need
      } else {
        const cw2 = sideWing0 + budget - 20    // 推满预算能容纳的卡宽
        if (cw2 >= 280) { cw = cw2; shift = wantRight ? -(cw2 + 20 - sideWing0) : (cw2 + 20 - sideWing0) }
      }
    }
  }
  bookShift.value = shift
  card.style.width = cw + 'px' // 先定宽再量高:收窄后高度跟着重排
  const ch = card.offsetHeight || 300
  // 推开后的书缘(解析算,不等动画):卡按新位置停靠
  const bookL = baseL + shift, bookR = baseR + shift
  const rWing = vw - 16 - bookR, lWing = bookL - 16
  let left
  if (wantRight && rWing >= cw) left = Math.min(vw - cw - 4, Math.max(bookR + 20, vw - cw - 16))
  else if (!wantRight && lWing >= cw) left = Math.max(4, Math.min(bookL - 20 - cw, 16))
  else {
    const gap = 14
    left = ax * 2 < vw ? Math.min(ax + gap, vw - cw - 12) : Math.max(12, ax - gap - cw)
  }
  const top = Math.min(Math.max(12, ay - ch / 2), Math.max(12, vh - ch - 12))
  popStyle.value = { left: Math.round(left) + 'px', top: Math.round(top) + 'px', width: cw + 'px' }
}
// 滚动/缩放:旁注贴着词重定位(rAF 节流;capture 捕获舱内任何滚动)
let popRaf = 0
function popFollow() {
  if (popRaf || !popWord.value) return
  popRaf = requestAnimationFrame(() => { popRaf = 0; placePop() })
}
// 点空白收卡(点词=换卡,点卡内=卡内操作,都不收)
function popDocDown(e) {
  if (!popWord.value) return
  if (e.target.closest?.('.word-pop') || e.target.closest?.('.rb-word')) return
  popWord.value = null
}
// 翻页/换章:锚词已经翻走了,旁注跟着收(书也推回原位)
watch([() => curPage.value, () => passage.value?.id], () => { popWord.value = null })
watch(popWord, (w) => { if (!w) bookShift.value = 0 })
onDeactivated(() => { popWord.value = null })
// 记法(词根故事三段式):来源叙事 / 同族分化链 / 口诀 —— 点词直接带走的记忆路径,
// 当前词在分化链里点亮(记住 root- 就能带走整串)
const popMnemo = computed(() => (popWord.value
  ? parseRootStory(store.rootStories[popWord.value.root], popWord.value.word)
  : null))
async function markLearned(w) {
  if (learned.value.has(w.id)) { message.info('已经在复习队列里了'); return }
  try {
    await store.api_learnWord(w.id)
    learned.value.add(w.id)
    learned.value = new Set(learned.value)
    message.success(`已把「${w.word}」加入复习队列，词汇圣殿里能看到它`)
  } catch { message.error('加入失败') }
}
// 本会话生词表(章末页):点过并加入复习的词
const learned = ref(new Set())
const sessionWords = computed(() =>
  [...learned.value].map((id) => store.words.find((w) => w.id === id)).filter(Boolean))

// ---- 句子展开(点句 = 精读高亮) ----
const activeSi = ref(-1)
function toggleSi(i) { activeSi.value = activeSi.value === i ? -1 : i }

// ---- 章末测(答完走 /api/reading/result 入库,书架 read 标记随之点亮) ----
const answered = ref({})   // qi -> picked
const results = ref({})    // qi -> correct
const submitted = ref(null)
async function pick(qi, oi) {
  if (answered.value[qi] !== undefined || !passage.value) return
  const correct = oi === passage.value.questions[qi].answer
  answered.value = { ...answered.value, [qi]: oi }
  results.value = { ...results.value, [qi]: correct }
  if (Object.keys(answered.value).length === passage.value.questions.length) {
    const right = Object.values({ ...results.value, [qi]: oi }).filter(Boolean).length
    submitted.value = { right, total: passage.value.questions.length }
    try {
      await store.api_submitReading(passage.value.id, right, passage.value.questions.length)
      store.refreshStats()
      store.refreshLibrary() // 书架进度弧/已读章立刻生效
    } catch { message.warning('成绩没能入库(后端不可达)，本轮结果只在本页显示') }
  }
}

function backToShelf() { store.setView('bookshelf') }
function gotoGalaxy(w) {
  popWord.value = null
  store.openWordInGalaxy(w.id)
}
</script>

<template>
  <div class="view-scroll reader-view">
    <!-- 无书进舱(直接访问 ?view=reader 且没带 book)→ 送回书库 -->
    <div v-if="!book" class="view-inner fade-in">
      <EmptyState
        icon="夜" title="夜读舱里还没有打开的书"
        desc="从轨道书库选一本书星,点开一章开始阅读"
      />
      <div style="text-align: center; margin-top: 14px">
        <button class="btn" @click="backToShelf">回到轨道书库 →</button>
      </div>
    </div>

    <div v-else-if="!passage" class="view-inner fade-in">
      <EmptyState icon="取" title="章节内容加载中…" desc="正文正在从书库里取,稍等一下;一直停在这里就刷新试试" />
    </div>

    <template v-else>
      <!-- 书台:正文常驻文档流(封面整本盖在上面),翻开瞬间底下就是第一屏,零跳动 -->
      <div class="reader-stage-wrap" :class="{ opening, covered: showCover }">
        <!-- 正文:一页一页翻的分页书 -->
        <div v-show="!showCover || opening" class="reader-body">
          <!-- 舱头 -->
          <header class="rb-head">
            <button class="rb-back unstyled-btn mono" @click="backToShelf">← ORBITAL LIBRARY</button>
            <div class="rb-mid">
              <span class="rb-book">{{ book.title }}</span>
              <span class="rb-ch mono">CH {{ String(curNo).padStart(2, '0') }} / {{ String(book.chapters.length).padStart(2, '0') }}</span>
              <span class="rb-ticks" aria-hidden="true">
                <i v-for="c in book.chapters" :key="c.no" :class="{ lit: c.read, cur: c.no === curNo }" />
              </span>
            </div>
            <button
              class="rb-zh unstyled-btn" :class="{ on: showZh }"
              @click="showZh = !showZh"
            >中文辅助</button>
          </header>

          <!-- 书页舞台:左右对开跨(左=verso 书名页眉 / 右=recto 章题页眉)+ 中缝谷影;翻面=半页绕中缝翻转 -->
          <div class="rb-book-wrap" :style="wrapStyle">
            <div class="rb-stage" ref="stageEl">
              <!-- 静态底跨:左/右两半页(空白半页也是纸——真书章首跨的左页就是白纸) -->
              <div class="rb-leaf sl" :class="{ blank: !baseLeft?.page }">
                <div v-if="baseLeft?.page && !hasTitle(baseLeft.page)" class="rb-runhead mono">{{ book.title }}</div>
                <div v-if="baseLeft?.page" class="rb-leaf-body" :style="fitStyle(baseLeft.page)">
                  <BookPage v-bind="pageProps" :page="baseLeft.page"
                    @word="openWord" @anyword="openAnyWord" @sent="toggleSi" @pick="pick" @galaxy="gotoGalaxy"
                    @chapter="goChapter" @shelf="backToShelf" />
                </div>
                <div v-else class="rb-exlibris mono" aria-hidden="true">EX LIBRIS · WORDPEAK</div>
                <div v-if="baseLeft?.page && !hasTitle(baseLeft.page)" class="rb-folio mono">{{ pad2(baseLeft.folio) }}</div>
              </div>
              <div class="rb-leaf sr">
                <div v-if="baseRight?.page && !hasTitle(baseRight.page)" class="rb-runhead mono">{{ chapter?.title }}</div>
                <div v-if="baseRight?.page" class="rb-leaf-body" :style="fitStyle(baseRight.page)">
                  <BookPage v-bind="pageProps" :page="baseRight.page"
                    @word="openWord" @anyword="openAnyWord" @sent="toggleSi" @pick="pick" @galaxy="gotoGalaxy"
                    @chapter="goChapter" @shelf="backToShelf" />
                </div>
                <div v-if="baseRight?.page && !hasTitle(baseRight.page)" class="rb-folio mono">{{ pad2(baseRight.folio) }}</div>
              </div>

              <!-- 翻面层:next=右半页绕中缝左翻(front=当前右页 / back=目标左页,纸的背面正是下一跨的左页);prev 镜像 -->
              <div
                class="rb-flip"
                :class="[flipping ? (flipping.dir === 'next' ? 'go-next' : 'go-prev') : '', settling ? 'rb-noanim' : '']"
              >
                <div class="rb-face rb-front">
                  <div v-if="flipFront" class="rb-leaf" :class="'side-' + flipFront.side">
                    <div v-if="flipFront.page && !hasTitle(flipFront.page)" class="rb-runhead mono">{{ flipFront.side === 'r' ? chapter?.title : book.title }}</div>
                    <div v-if="flipFront.page" class="rb-leaf-body" :style="fitStyle(flipFront.page)"><BookPage v-bind="pageProps" :page="flipFront.page" /></div>
                    <div v-if="flipFront.page && !hasTitle(flipFront.page)" class="rb-folio mono">{{ pad2(flipFront.folio) }}</div>
                  </div>
                </div>
                <div class="rb-face rb-back">
                  <div v-if="flipBack" class="rb-leaf" :class="'side-' + flipBack.side">
                    <div v-if="flipBack.page && !hasTitle(flipBack.page)" class="rb-runhead mono">{{ flipBack.side === 'r' ? chapter?.title : book.title }}</div>
                    <div v-if="flipBack.page" class="rb-leaf-body" :style="fitStyle(flipBack.page)"><BookPage v-bind="pageProps" :page="flipBack.page" /></div>
                    <div v-if="flipBack.page && !hasTitle(flipBack.page)" class="rb-folio mono">{{ pad2(flipBack.folio) }}</div>
                  </div>
                </div>
              </div>

              <!-- 中缝:装订谷影(对开页的折,常压在最上层;翻页时纸从谷里翻过) -->
              <div class="rb-gutter" aria-hidden="true" />

              <!-- 页边点击区:贴着外口的窄条,点=翻页(硬边界置灰) -->
              <button v-if="!flipping" class="rb-edge-btn rb-edge-btn-l unstyled-btn" aria-label="上一页" :disabled="atStart" :title="atStart ? '已是第一章第一页' : '上一页'" @click="flip('prev')">‹</button>
              <button v-if="!flipping" class="rb-edge-btn rb-edge-btn-r unstyled-btn" aria-label="下一页" :disabled="atEnd" :title="atEnd ? '已是最后一章最后一页' : '下一页'" @click="flip('next')">›</button>
            </div>

            <!-- 翻页页脚(首末硬边界置灰,章间顺延翻章不受影响) -->
            <nav class="rb-pager">
              <button class="btn ghost" :disabled="!!flipping || !pages.length || atStart" @click="flip('prev')">‹ 上一页</button>
              <span class="rb-pager-mid mono">{{ pagerLabel }}{{ onQuizPage ? ' · 章末测' : '' }}</span>
              <button class="btn primary" :disabled="!!flipping || !pages.length || atEnd" @click="flip('next')">下一页 ›</button>
            </nav>

            <!-- 章内进度轨:当前位置在章的第几页,翻完一章走满(安静 HUD) -->
            <div class="rb-rail" aria-hidden="true">
              <i :style="{ width: spreads.length ? (((curPage + 1) / spreads.length) * 100) + '%' : '0%' }" />
            </div>

            <!-- 隐形测量层:与书页同款同宽,分页高度从这里量 -->
            <!-- 隐形测量层:强制 showZh 让所有块(含译文)都量出 DOM 元素——
                 buildPages 按子元素下标直取 allBlocks,少渲染一类块就会错位,
                 章末测/翻章等尾块将永远装不进任何页(用户关「中文辅助」即触发) -->
            <div ref="measureEl" class="rb-measure" aria-hidden="true">
              <BookPage v-bind="pageProps" :show-zh="true" :page="{ blocks: allBlocks }" />
            </div>
          </div>
        </div>

        <!-- 封面:一整本实体书(书脊竖排书名 + 布纹封皮 + 书口页叠),点「翻开」封皮绕书脊荡开 -->
        <div v-if="showCover" class="reader-cover" :class="{ opening: opening }">
          <button class="rc-back unstyled-btn mono" @click="backToShelf">← ORBITAL LIBRARY</button>
          <div class="rc-col">
            <div class="rc-book">
              <!-- 书口:右侧页叠,书有了厚度 -->
              <div class="rc-edge" aria-hidden="true" />
              <!-- 书脊:竖排书名 + 星等 + 楞线 -->
              <div class="rc-spine" aria-hidden="true">
                <i class="rcs-cap" />
                <span class="rcs-title">{{ book.title }}</span>
                <span class="rcs-mark mono">M·{{ ROMAN[book.level] }}</span>
                <i class="rcs-cap b" />
              </div>
              <!-- 封皮:布纹底 + 金线双框 -->
              <div class="rc-page dots-host">
                <span class="dots-decor dots-fade" aria-hidden="true" style="--dots-o:.14" />
                <span class="rc-kicker mono">MAGNITUDE {{ ROMAN[book.level] }} · {{ book.chapters.length }} CHAPTERS</span>
                <h1 class="rc-title"><BlurText :text="book.title" as="span" /></h1>
                <div class="rc-en">{{ book.en_title }}</div>
                <div class="rc-rule" aria-hidden="true" />
                <p class="rc-line">{{ book.one_line }}</p>
                <div class="rc-roots mono">{{ book.word_focus.map((r) => r.toUpperCase() + '-').join(' · ') }}</div>
                <button class="rc-open" @click="openBook">
                  <span>翻开这本书</span>
                  <span class="rc-arrow mono" aria-hidden="true">→</span>
                </button>
                <span class="rc-author mono">{{ book.author }}</span>
                <span class="rc-press mono">WORDPEAK PRESS · 轨道书库藏书</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 词卡(旁注):夹在书页边的批注签 —— 不拉全屏遮罩,placePop 优先把它停进正文栏外的空白翼,绝不遮正文 -->
      <div v-if="popWord" ref="popEl" class="word-pop" :style="popStyle" :key="popWord.id || popWord">
          <button class="wp-close" @click="popWord = null" title="收起 (ESC)">✕</button>

          <!-- 任意词:词库外的词也点得开 —— AI 五维讲解(解释/记法/技巧/运用/语法) -->
          <template v-if="popIsAny">
            <header class="wp-head">
              <span class="wp-press mono">WORDPEAK PRESS · LIVE NOTE</span>
              <h1 class="wp-word">{{ popWord }}</h1>
              <div class="wp-rule" aria-hidden="true" />
            </header>
            <div v-if="popAny.loading" class="wp-ai-scan">
              <span class="mono">AI 正在讲这个词…</span>
              <span class="wp-ai-bar"><i /></span>
            </div>
            <div v-else-if="popAny.error" class="wp-ai-error">{{ popAny.error }}</div>
            <template v-else-if="popAny.data">
              <div class="wp-ai-body">
                <div v-if="popAny.data.explain" class="wp-ai-row">
                  <span class="wp-ai-tag mono">解释</span>
                  <p class="wp-ai-val">{{ popAny.data.explain }}</p>
                </div>
                <div v-if="popAny.data.mnemonic" class="wp-ai-row">
                  <span class="wp-ai-tag mono">记法</span>
                  <p class="wp-ai-val">{{ popAny.data.mnemonic }}</p>
                </div>
                <div v-if="popAny.data.tip" class="wp-ai-row">
                  <span class="wp-ai-tag mono">技巧</span>
                  <p class="wp-ai-val">{{ popAny.data.tip }}</p>
                </div>
                <div v-if="popAny.data.usage" class="wp-ai-row">
                  <span class="wp-ai-tag mono">运用</span>
                  <p class="wp-ai-val">{{ popAny.data.usage }}</p>
                </div>
                <div v-if="popAny.data.grammar" class="wp-ai-row">
                  <span class="wp-ai-tag mono">语法</span>
                  <p class="wp-ai-val">{{ popAny.data.grammar }}</p>
                </div>
              </div>
              <div class="wp-ai-foot mono">{{ popAny.data.source === 'llm' ? 'AI LIVE · 实时讲解' : 'LOCAL · 本地速览' }}</div>
            </template>
            <div class="wp-acts">
              <button class="btn small" @click="speak(popWord)">朗读</button>
              <LookupMenu :word="popWord" />
            </div>
          </template>

          <!-- 词库词:纸签版式(衬线大字 + 金线题头,与封面书名同一拍) -->
          <template v-else>
          <header class="wp-head">
            <span class="wp-press mono">WORDPEAK PRESS · WORD ARCHIVE</span>
            <h1 class="wp-word">{{ popWord.word }}</h1>
            <div class="wp-sub">
              <span class="wp-pos">{{ popWord.pos }}</span>
              <span class="ipa">{{ popWord.ipa }}</span>
            </div>
            <div class="wp-rule" aria-hidden="true" />
            <p class="wp-meaning">{{ popWord.meaning }}</p>
          </header>

          <!-- 词根:铅字章 + 词源行 -->
          <div v-if="popWord.root" class="wp-root-stamp">
            <span class="wp-stamp-root mono">{{ popWord.root }}-</span>
            <span class="wp-stamp-zh">{{ popWord.root_meaning }}</span>
          </div>
          <p v-if="popWord.etymology" class="wp-ety">{{ popWord.etymology }}</p>

          <!-- 记法:词根家族的三段式(story 来源叙事 / branches 同族分化 / confuse 口诀) -->
          <template v-if="popMnemo && (popMnemo.story || popMnemo.branches || popMnemo.loose || popMnemo.confuse)">
            <div class="wp-label">记法 · {{ popWord.root }}- 家族这样记</div>
            <div class="wp-mnemo">
              <p v-if="popMnemo.story" class="wp-mnemo-story">{{ popMnemo.story }}</p>
              <div v-if="popMnemo.branches" class="wp-mnemo-branches">
                <div v-for="(row, ri) in popMnemo.branches" :key="ri" class="wp-mn-row">
                  <span class="wp-mn-desc">{{ row.desc }} →</span>
                  <span
                    v-for="wd in row.words" :key="wd.word"
                    class="wp-mn-word" :class="{ cur: wd.current }"
                    :title="wd.current ? '就是这个词 — 从词根推出来的' : `${wd.word} · ${wd.zh}`"
                  >{{ wd.word }}<i>{{ wd.zh }}</i></span>
                </div>
              </div>
              <p v-else-if="popMnemo.loose" class="wp-mnemo-story">{{ popMnemo.loose.join('。') }}</p>
              <div v-if="popMnemo.confuse?.mnemonic" class="wp-mnemo-tag">
                <span class="wp-mnemo-tag-cap mono">口诀</span>
                {{ popMnemo.confuse.mnemonic }}
              </div>
              <p v-if="popMnemo.confuse?.text" class="wp-mnemo-confuse">{{ popMnemo.confuse.text }}</p>
            </div>
          </template>

          <div class="wp-acts">
            <button class="btn small" @click="speak(popWord.word)">朗读</button>
            <button class="btn primary small" @click="markLearned(popWord)">加入复习队列</button>
            <LookupMenu :word="popWord.word" :ipa="popWord.ipa" />
          </div>
          <button class="btn ghost small wp-goto" @click="gotoGalaxy(popWord)">去词汇圣殿看这颗星 →</button>
          </template>
      </div>
    </template>
  </div>
</template>

<style scoped>
/* ---------- 书台:正文常驻文档流,封面整本盖在上面;翻开 = 封皮荡开露出第一屏 ---------- */
.reader-stage-wrap { position: relative; }
/* 封面态:正文藏起(display:none),书台整屏兜底,absolute 的封面才有所依附 */
.reader-stage-wrap.covered {
  min-height: calc(100vh - 110px);
  min-height: calc(100dvh - 110px);
  display: flex; align-items: center; justify-content: center;
}
/* 开书瞬间:正文第一屏从书脊侧展开摆正(封皮荡开的续接镜头) */
.reader-stage-wrap.opening .rb-book-wrap {
  transform-origin: left center;
  animation: revealPage 0.72s var(--ease) 0.38s backwards;
}
@keyframes revealPage {
  from { opacity: 0; transform: perspective(1300px) rotateY(-24deg) translateX(-16px); }
  to { opacity: 1; transform: none; }
}

/* ---------- 封面:一整本实体书(书脊 + 封皮 + 书口) ---------- */
.reader-cover {
  position: absolute; inset: 0; z-index: 24;
  display: flex; align-items: center; justify-content: center;
  padding: 40px 20px;
  perspective: 1900px;
}
/* 封面态的干净底(与视图背景同色,开书后半程渐透,底下透出正文第一屏) */
.reader-cover::before {
  content: ''; position: absolute; inset: 0;
  background: var(--bg);
  transition: opacity 0.55s var(--ease) 0.5s;
}
.reader-cover.opening::before { opacity: 0; }

/* 封面与正文同列(同 max-width/同 padding):封皮宽取列宽一半——翻开后的右页,就是这张封皮摊开的尺寸 */
.rc-col {
  width: 100%; max-width: min(992px, max(732px, calc(100vw - 448px))); padding: 0 6px;
  display: flex; align-items: center; justify-content: center;
}

/* 书体:书脊 | 封皮 | 书口 一字排开;开书时整本渐隐收束到正文。
   封皮 = 对开书的一页:宽 = 列宽一半 + 书脊44 + 书口15,高与 rb-stage 同 token——合上的与摊开的是同一本 */
.rc-book {
  position: relative; z-index: 1;
  display: flex; align-items: stretch;
  width: calc(50% + 59px);
  height: clamp(420px, 54vh, 540px);
  filter: drop-shadow(0 34px 44px rgba(0, 0, 0, 0.45));
  transition: opacity 0.5s var(--ease) 0.55s;
}
.reader-cover.opening .rc-book { opacity: 0; }

/* 书脊:竖排书名 + 星等 + 楞线,上下织带帽 */
.rc-spine {
  flex: 0 0 44px; display: flex; flex-direction: column; align-items: center;
  gap: 12px; padding: 16px 0;
  border-radius: 18px 4px 4px 18px;
  background:
    repeating-linear-gradient(90deg, rgba(0, 0, 0, 0.17) 0 2px, transparent 2px 5px),
    linear-gradient(90deg, #1c2138, #292f4e 34%, #232841 58%, #151a2c);
  box-shadow:
    inset -8px 0 14px -8px rgba(0, 0, 0, 0.6),
    inset 2px 0 0 rgba(255, 236, 200, 0.05),
    -12px 0 26px -14px rgba(0, 0, 0, 0.7);
}
.rcs-cap { flex: none; width: 20px; height: 7px; border-radius: 2px;
  background: repeating-linear-gradient(90deg, #d9c79a 0 2px, #8a5a3a 2px 4px);
  box-shadow: 0 0 5px rgba(217, 199, 154, 0.35);
}
.rcs-title {
  flex: 1; min-height: 0; overflow: hidden;
  writing-mode: vertical-rl; text-orientation: upright;
  font-family: 'Songti SC', 'STZhongsong', 'SimSun', var(--serif, serif);
  font-size: var(--fs-lg); font-weight: 600; letter-spacing: 0.26em; line-height: 1;
  color: #eee5d3; text-shadow: 0 1px 2px rgba(0, 0, 0, 0.55);
}
.rcs-mark { flex: none; font-size: var(--fs-2xs); letter-spacing: 0.2em; color: #d9c79a; writing-mode: vertical-rl; }

/* 书口:右侧页叠——书有了厚度,页线是纸的横截面 */
.rc-edge {
  flex: 0 0 15px; margin: 7px 0 9px -2px;
  border-radius: 2px 14px 14px 2px;
  background:
    repeating-linear-gradient(180deg, #efe7d2 0 2px, #cfc3a6 2px 3px),
    #e6dcc0;
  box-shadow: inset -3px 0 5px rgba(0, 0, 0, 0.28), inset 1px 0 0 rgba(255, 255, 255, 0.4);
}

/* 封皮:深空布纹 + 金线双框,绕左书脊荡开 */
.rc-page {
  position: relative; flex: 1; min-width: 0;
  padding: 52px 40px 42px;
  border-radius: 4px 18px 18px 4px;
  background:
    radial-gradient(120% 90% at 30% 16%, rgba(122, 138, 196, 0.16), transparent 58%),
    repeating-linear-gradient(45deg, rgba(255, 255, 255, 0.014) 0 2px, transparent 2px 4px),
    repeating-linear-gradient(-45deg, rgba(255, 255, 255, 0.014) 0 2px, transparent 2px 4px),
    linear-gradient(165deg, #262c49 0%, #1a1f36 52%, #12162a 100%);
  box-shadow:
    inset 0 0 0 1px rgba(217, 199, 154, 0.42),
    inset 0 0 0 6px transparent,
    inset 0 0 0 7px rgba(217, 199, 154, 0.16),
    inset 0 1px 0 rgba(255, 236, 200, 0.07);
  transform-origin: left center;
  transition: transform 1s cubic-bezier(0.62, 0.04, 0.32, 1), opacity 0.8s ease 0.16s;
  transform-style: preserve-3d;
  overflow-y: auto; scrollbar-width: none; /* 矮屏兜底:书太厚时封皮可轻滚,平时无感 */
}
/* 封皮四角饰:金线角标(框住双线的书装语言) */
.rc-page::before, .rc-page::after {
  content: ''; position: absolute; width: 13px; height: 13px; z-index: 0; opacity: 0.85;
  border: 1px solid rgba(217, 199, 154, 0.55);
}
.rc-page::before { top: 14px; left: 14px; border-right: 0; border-bottom: 0; }
.rc-page::after { bottom: 14px; right: 14px; border-left: 0; border-top: 0; }
.reader-cover.opening .rc-page {
  transform: rotateY(-92deg);
  opacity: 0;
  pointer-events: none;
}
/* 封面点名页级联:kicker → 书名 → 拉丁 → 刻线 → 导语 → 词根 → 翻开 → 作者 → 铭牌
   (terrRise 为全局语汇,BlurText 的逐字模糊负责书名自身) */
.rc-page > :not(.dots-decor) { animation: terrRise 0.55s var(--ease) backwards; }
.rc-page > *:nth-child(2) { animation-delay: 0.05s }
.rc-page > *:nth-child(3) { animation-delay: 0.12s }
.rc-page > *:nth-child(4) { animation-delay: 0.18s }
.rc-page > *:nth-child(5) { animation-delay: 0.24s }
.rc-page > *:nth-child(6) { animation-delay: 0.30s }
.rc-page > *:nth-child(7) { animation-delay: 0.38s }
.rc-page > *:nth-child(8) { animation-delay: 0.46s }
.rc-page > *:nth-child(9) { animation-delay: 0.54s }
.rc-page > *:nth-child(10) { animation-delay: 0.62s }
/* 封面态的返回书库:不想要这本书时不必先「翻开」才能走 */
.rc-back {
  position: absolute; top: 18px; left: 22px; z-index: 3;
  font-size: var(--fs-2xs); letter-spacing: 1.5px; color: var(--text-3);
  transition: color 0.25s;
}
.rc-back:hover { color: var(--accent); }
.rc-kicker { display: block; font-size: var(--fs-2xs); letter-spacing: 3px; color: #d9c79a; text-align: center; }
.rc-title {
  font-family: var(--serif);
  font-size: clamp(26px, 3.4vw, 38px); font-weight: 600; letter-spacing: 0.02em;
  margin: 18px 0 6px; line-height: 1.25; text-align: center;
  color: #f2ead8; text-shadow: 0 2px 10px rgba(0, 0, 0, 0.35);
}
.rc-en { font-size: var(--fs-sm); color: rgba(196, 206, 226, 0.72); font-style: italic; text-align: center; }
.rc-rule { height: 1px; width: 46px; background: #d9c79a; opacity: 0.75; margin: 16px auto; }
.rc-line { font-size: var(--fs-base); color: rgba(214, 220, 234, 0.88); line-height: 1.9; max-width: 30em; margin: 0 auto; text-align: center; }
.rc-roots { margin-top: 22px; font-size: var(--fs-2xs); letter-spacing: 2.5px; color: rgba(196, 206, 226, 0.6); text-align: center; }
.rc-open {
  display: flex; align-items: center; justify-content: center; gap: 12px;
  margin: 24px auto 0; padding: 13px 30px; cursor: pointer;
  border: 1px solid rgba(217, 199, 154, 0.55); border-radius: 999px;
  background: linear-gradient(180deg, rgba(217, 199, 154, 0.14), rgba(217, 199, 154, 0.05));
  color: #e8cf9a; font-size: var(--fs-md); font-weight: 600; letter-spacing: 0.12em;
  box-shadow: inset 0 1px 0 rgba(255, 244, 220, 0.18), 0 6px 18px -8px rgba(217, 199, 154, 0.35);
  transition: background 0.3s var(--ease-out-3), transform 0.3s var(--ease-out-3), box-shadow 0.3s var(--ease-out-3);
}
.rc-open:hover {
  background: linear-gradient(180deg, rgba(217, 199, 154, 0.24), rgba(217, 199, 154, 0.1));
  transform: translateY(-2px);
  box-shadow: inset 0 1px 0 rgba(255, 244, 220, 0.24), 0 10px 26px -8px rgba(217, 199, 154, 0.5);
}
.rc-arrow { font-size: var(--fs-lg); }
.rc-author { display: block; margin-top: 16px; font-size: var(--fs-2xs); letter-spacing: 2px; color: rgba(196, 206, 226, 0.55); text-align: center; }
.rc-press { display: block; margin-top: 8px; font-size: var(--fs-2xs); letter-spacing: 0.3em; color: rgba(217, 199, 154, 0.45); text-align: center; }

/* ---------- 舱头:安静的 mono HUD(停留界面里工具栏让位给正文) ---------- */
/* 横版宽书:书宽 ≈ 视口 − 448(1440 屏下 980)。词卡不再依赖静态翼位——
   placePop 的「推书让位」会在点词时把整书向对侧平移,腾出全宽翼(卡永不压书页);
   下限 732 / 上限 992 与推书预算(对侧翼 − 16)联动,公式见 placePop */
.reader-body { max-width: min(992px, max(732px, calc(100vw - 448px))); margin: 26px auto 0; padding: 0 6px; }
.rb-head {
  position: sticky; top: 0; z-index: 8;
  display: flex; align-items: center; justify-content: space-between; gap: 14px;
  padding: 12px 4px; margin-bottom: 16px;
  background: color-mix(in srgb, var(--bg) 82%, transparent);
  backdrop-filter: blur(12px) saturate(1.2);
  -webkit-backdrop-filter: blur(12px) saturate(1.2);
  border-bottom: 1px solid var(--line);
}
.rb-back {
  font-size: var(--fs-2xs); letter-spacing: 0.2em; color: var(--text-3);
  transition: color 0.25s var(--ease-out-3);
}
.rb-back:hover { color: var(--accent); }
.rb-mid { display: flex; align-items: center; gap: 12px; min-width: 0; }
.rb-book { font-size: var(--fs-base); font-weight: 700; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.rb-ch { font-size: var(--fs-2xs); letter-spacing: 0.2em; color: var(--accent); flex: none; }
/* 章节刻度:一章一小格,已读鎏金、当前章 accent 加高——整本书的位置一眼可读 */
.rb-ticks { display: inline-flex; align-items: center; gap: 3px; flex: none; }
.rb-ticks i {
  width: 3px; height: 12px; border-radius: 1.5px;
  background: color-mix(in srgb, var(--text-3) 30%, transparent);
  transition: background 0.3s var(--ease-out-3), height 0.3s var(--ease-out-3);
}
.rb-ticks i.lit { background: var(--gold); }
.rb-ticks i.cur { background: var(--accent); height: 16px; }
.rb-zh {
  font-family: var(--mono); font-size: var(--fs-2xs); letter-spacing: 0.12em;
  padding: 6px 14px; border-radius: 999px; cursor: pointer;
  border: 1px solid var(--line); color: var(--text-3);
  transition: color 0.25s var(--ease-out-3), border-color 0.25s var(--ease-out-3), background 0.25s var(--ease-out-3);
}
.rb-zh.on { color: var(--accent); border-color: var(--line-accent); background: color-mix(in srgb, var(--accent) 10%, transparent); }

/* ---------- 分页书舞台 ---------- */
.rb-book-wrap {
  position: relative;
  transition: transform 0.42s var(--ease-out-3); /* 推书让位:点词时整书平移腾翼 */
  /* 书页专用字号:对开半页(内容列 ~450px)配 20px ≈ 46ch/行,大字号下仍是舒服的书 measure。
     测量层同在此作用域内,块高量出来即所见 */
  --font-size-fluid-1: 20px;
}
/* 书口:右侧页叠,整本书的厚度——翻页时页叠不动(书是厚的,翻的只是纸) */
.rb-book-wrap::before {
  content: ''; position: absolute; top: 5px; bottom: 9px; right: -12px; width: 12px;
  border-radius: 2px 12px 12px 2px;
  background: repeating-linear-gradient(180deg, rgba(242, 234, 216, 0.92) 0 2px, rgba(160, 148, 118, 0.6) 2px 3px);
  box-shadow: inset -3px 0 5px rgba(0, 0, 0, 0.22), 3px 4px 12px -4px rgba(0, 0, 0, 0.45);
  pointer-events: none;
}
/* 书下接触影:书"放"在台面上,不再悬空 */
.rb-book-wrap::after {
  content: ''; position: absolute; left: 3%; right: 6%; bottom: -18px; height: 34px;
  background: radial-gradient(50% 100% at 50% 50%, rgba(0, 0, 0, 0.42), transparent 72%);
  pointer-events: none;
}
/* 版心:横版大开本——跨页 ≈ 2:1,单页近方(比例如画册/大开本绘本,不再是竖长条) */
.rb-stage {
  position: relative;
  height: clamp(420px, 54vh, 540px);
  perspective: 1700px;
}
/* 夜读氛围:书页后一圈极淡的读灯光(夜读舱的"灯") */
.rb-stage::before {
  content: ''; position: absolute; inset: -70px -90px; z-index: 0;
  background: radial-gradient(42% 52% at 50% 38%, color-mix(in srgb, #ffc98a 7%, transparent), transparent 72%);
  pointer-events: none;
}
/* 半页「纸」:纸纹 + 顶缘发丝高光;side-l/side-r = 外口圆角 + 朝中缝的压暗(纸向装订谷卷) */
.rb-leaf {
  position: absolute; inset: 0; z-index: 1;
  display: flex; flex-direction: column;
  border: 1px solid var(--line);
  background:
    repeating-linear-gradient(0deg, rgba(255, 255, 255, 0.013) 0 1px, transparent 1px 3px),
    repeating-linear-gradient(90deg, rgba(255, 255, 255, 0.011) 0 1px, transparent 1px 3px),
    color-mix(in srgb, var(--surface) 90%, transparent);
}
.rb-leaf.sl { left: 0; width: 50%; }
.rb-leaf.sr { left: 50%; width: 50%; }
.rb-leaf.sl, .rb-leaf.side-l {
  border-radius: 8px 0 0 8px;
  box-shadow:
    var(--shadow-lg),
    inset 0 1px 0 color-mix(in srgb, var(--text) 3%, transparent),
    inset -26px 0 30px -22px rgba(0, 0, 0, 0.30);
}
.rb-leaf.sr, .rb-leaf.side-r {
  border-radius: 0 8px 8px 0;
  box-shadow:
    var(--shadow-lg),
    inset 0 1px 0 color-mix(in srgb, var(--text) 3%, transparent),
    inset 26px 0 30px -22px rgba(0, 0, 0, 0.30);
}
/* 版心:半页内容区,超高时页内滚动兜底(超长句页由 JS 按 fit 整页 zoom,正常不走这条) */
.rb-leaf-body { flex: 1; min-height: 0; overflow-y: auto; scrollbar-width: thin; }
/* 页眉(左=书名 verso / 右=章题 recto)与页码:真书的行,章首页不排 */
.rb-runhead {
  flex: none; height: 36px; box-sizing: border-box;
  display: flex; align-items: center; justify-content: center; padding: 0 18px 2px;
  font-size: var(--fs-2xs); letter-spacing: 0.3em; color: var(--text-3);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.rb-folio {
  flex: none; height: 34px; box-sizing: border-box;
  display: flex; align-items: center; justify-content: center;
  font-size: var(--fs-2xs); letter-spacing: 0.24em; color: var(--text-3);
}
/* 章首跨的左页:白纸 + 藏书印(不喧哗) */
.rb-exlibris {
  flex: 1; display: flex; align-items: center; justify-content: center;
  font-size: var(--fs-2xs); letter-spacing: 0.3em;
  color: color-mix(in srgb, var(--text-3) 26%, transparent);
}

/* 中缝:装订谷影——谷底线 + 两半页朝中缝渐暗,常压在最上层(翻页时纸从谷里翻过) */
.rb-gutter {
  position: absolute; left: 50%; top: 0; bottom: 0; width: 72px; z-index: 4;
  transform: translateX(-50%); pointer-events: none;
  background:
    linear-gradient(90deg,
      transparent calc(50% - 0.5px), rgba(0, 0, 0, 0.17) calc(50% - 0.5px),
      rgba(0, 0, 0, 0.17) calc(50% + 0.5px), transparent calc(50% + 0.5px)),
    linear-gradient(90deg,
      transparent 0%, rgba(0, 0, 0, 0.16) 30%, rgba(0, 0, 0, 0.30) 48%,
      rgba(0, 0, 0, 0.02) 58%, transparent 70%),
    linear-gradient(90deg,
      transparent 30%, rgba(0, 0, 0, 0.02) 42%, rgba(0, 0, 0, 0.30) 52%,
      rgba(0, 0, 0, 0.16) 70%, transparent 100%);
}

/* 翻面层:半页绕中缝翻转——next=右半页(origin 左=中缝)向左翻开;prev=左半页镜像。
   空闲层是空壳:pointer-events 全关到纸面为止,别挡住底下书页的点词 */
.rb-flip {
  position: absolute; inset: 0; z-index: 3;
  transform-style: preserve-3d; pointer-events: none;
  transition: transform 0.62s cubic-bezier(0.5, 0.08, 0.4, 1);
}
.rb-flip.go-next { left: 50%; width: 50%; transform-origin: left center; transform: rotateY(-178deg); }
.rb-flip.go-prev { left: 0; width: 50%; transform-origin: right center; transform: rotateY(178deg); }
.rb-flip.rb-noanim { transition: none; }
.rb-face { position: absolute; inset: 0; backface-visibility: hidden; pointer-events: none; }
.rb-face.rb-back { transform: rotateY(180deg); }
.rb-face .rb-leaf { pointer-events: auto; }

/* 页边点击区:贴边窄条,平时只露箭头,悬停显形 */
.rb-edge-btn {
  position: absolute; top: 0; bottom: 0; width: 46px; z-index: 5;
  display: flex; align-items: center; justify-content: center;
  font-size: var(--fs-xl); color: var(--text-3); opacity: 0;
  transition: opacity 0.25s var(--ease-out-3), background 0.25s var(--ease-out-3), color 0.25s var(--ease-out-3);
}
.rb-edge-btn-l { left: 0; border-radius: 8px 0 0 8px; }
.rb-edge-btn-r { right: 0; border-radius: 0 8px 8px 0; }
.rb-edge-btn:hover { opacity: 1; color: var(--accent); background: color-mix(in srgb, var(--accent) 6%, transparent); }
.rb-stage:hover .rb-edge-btn { opacity: 0.55; }
/* 首末硬边界:置灰且不可点 */
.rb-edge-btn:disabled { opacity: 0.18 !important; cursor: default; }
.rb-edge-btn:disabled:hover { background: none; color: var(--text-3); }

/* 左侧书口:页叠镜像(对开本两侧都是纸口)——装订谷移到了中缝,书脊条不再贴外缘 */
.rb-stage::after {
  content: ''; position: absolute; top: 5px; bottom: 9px; left: -12px; width: 12px; z-index: 0;
  border-radius: 12px 2px 2px 12px;
  background: repeating-linear-gradient(180deg, rgba(242, 234, 216, 0.92) 0 2px, rgba(160, 148, 118, 0.6) 2px 3px);
  box-shadow: inset 3px 0 5px rgba(0, 0, 0, 0.22), -3px 4px 12px -4px rgba(0, 0, 0, 0.45);
  pointer-events: none;
}

/* ---------- 翻页页脚:安静 mono HUD ---------- */
.rb-pager {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  margin: 16px 0 12px;
}
.rb-pager-mid { font-size: var(--fs-2xs); letter-spacing: 0.2em; color: var(--text-3); }
/* 章内进度轨:翻页落定后走满一格(与书架进度弧同一读法) */
.rb-rail {
  height: 2px; border-radius: 1px; margin: 0 2px 28px;
  background: color-mix(in srgb, var(--text-3) 12%, transparent);
  overflow: hidden;
}
.rb-rail i {
  display: block; height: 100%; border-radius: inherit;
  background: var(--grad-accent);
  transition: width 0.45s var(--ease-out-3);
}

/* ---------- 隐形测量层:与半页同宽(块高分页从这里量,竖向装帧在 JS 里扣) ---------- */
.rb-measure {
  position: absolute; left: 0; top: 0; width: 50%;
  visibility: hidden; pointer-events: none; z-index: -1;
  border: 1px solid transparent; border-radius: 8px 0 0 8px;
  overflow: hidden;
}

/* ---------- 窄屏(≤720px):退成单页书——左半页隐藏、翻面绕左缘、测量层满宽 ---------- */
@media (max-width: 720px) {
  .rb-book-wrap { --font-size-fluid-1: max(1rem, min(4vw, 1.5rem)); } /* 单页满宽,恢复全局流式字号 */
  .rb-leaf.sl { display: none; }
  .rb-leaf.sr, .rb-leaf.side-r {
    left: 0; width: 100%; border-radius: 8px;
    box-shadow: var(--shadow-lg), inset 0 1px 0 color-mix(in srgb, var(--text) 3%, transparent);
  }
  .rb-gutter, .rb-stage::after { display: none; }
  .rb-flip.go-next, .rb-flip.go-prev { left: 0; width: 100%; transform-origin: left center; }
  .rb-measure { width: 100%; border-radius: 8px; }
  /* 窄屏封面 = 单页书:书体占满列宽,书脊/书口收细(高度仍与舞台同 token) */
  .rc-book { width: 100%; }
  .rc-spine { flex-basis: 30px; }
  .rcs-title { font-size: var(--fs-sm); letter-spacing: 0.2em; }
  .rc-edge { flex-basis: 8px; }
}

/* ---------- 词卡:夜读舱装帧语言 —— 夹在书里的批注签(纸纹/金线/衬线/铭牌) ---------- */
/* 卡身:旁注纸签 — 纸纹 + 金线内框 + 左装订直角,与书页 rb-under 同一版式;
   fixed 定位由 placePop() 算出:优先停进正文栏外的空白翼,贴着被点的词,不遮正文 */
.word-pop {
  position: fixed; z-index: 60;
  width: min(380px, calc(100vw - 24px)); padding: 26px 28px 22px;
  border-radius: 8px 14px 14px 8px;
  background:
    repeating-linear-gradient(0deg, rgba(255, 255, 255, 0.013) 0 1px, transparent 1px 3px),
    color-mix(in srgb, var(--surface) 96%, transparent);
  border: 1px solid var(--line);
  box-shadow:
    inset 0 0 0 1px rgba(217, 199, 154, 0.24),
    inset 4px 0 12px -9px rgba(0, 0, 0, 0.4),
    var(--shadow-lg);
  max-height: min(760px, 88vh); overflow-y: auto;
}
.wp-close { position: absolute; top: 10px; right: 10px; z-index: 2; }

/* 任意词 AI 讲解:行式字段(解释/记法/技巧/运用/语法),与句法透镜同一语言 */
.wp-ai-scan { display: flex; align-items: center; gap: 10px; margin-top: 14px; font-size: var(--fs-2xs); color: var(--text-3); letter-spacing: 0.14em; }
.wp-ai-bar { flex: 1; height: 2px; background: var(--surface-sunken); border-radius: 1px; overflow: hidden; }
.wp-ai-bar i { display: block; height: 100%; width: 30%; background: var(--accent); animation: wpAiScan 1.4s ease-in-out infinite; }
@keyframes wpAiScan { 0% { transform: translateX(-100%) } 100% { transform: translateX(330%) } }
.wp-ai-error { margin-top: 12px; font-size: var(--fs-xs); color: var(--warn); line-height: 1.6; }
.wp-ai-body { margin-top: 6px; }
.wp-ai-row { display: grid; grid-template-columns: 44px 1fr; gap: 10px; padding: 7px 0; border-bottom: 1px dashed var(--line); }
.wp-ai-tag { font-size: var(--fs-2xs); color: var(--accent); letter-spacing: 0.08em; align-self: start; padding-top: 2px; }
.wp-ai-val { font-size: var(--fs-sm); line-height: 1.7; color: var(--text); margin: 0; }
.wp-ai-foot { margin-top: 8px; font-size: var(--fs-2xs); letter-spacing: 0.16em; color: var(--text-3); }

/* 词头:衬线大字 + 金线题头(与封面书名同一拍) */
.wp-head { display: flex; flex-direction: column; gap: 4px; padding-right: 26px; }
.wp-press { font-size: var(--fs-2xs); letter-spacing: 0.32em; color: var(--text-3); }
.wp-word {
  margin: 2px 0 0; font-family: var(--serif);
  font-size: 40px; font-weight: 600; line-height: 1.08; color: var(--text);
}
.wp-sub { display: flex; gap: 12px; align-items: baseline; margin-top: 2px; }
.wp-sub .ipa { font-size: var(--fs-base); color: var(--text-2); }
.wp-pos { font-size: var(--fs-xs); font-style: italic; color: var(--warn); }
.wp-rule {
  height: 1px; margin: 10px 0 2px;
  background: linear-gradient(to right, rgba(217, 199, 154, 0.55), rgba(217, 199, 154, 0.12) 72%, transparent);
}
.wp-meaning { font-size: var(--fs-md); color: var(--text); margin: 6px 0 0; }

/* 词根:铅字章 + 词源行 */
.wp-root-stamp {
  margin-top: 16px; display: inline-flex; align-items: baseline; gap: 10px;
  padding: 6px 12px; border-radius: 6px;
  border: 1px solid rgba(217, 199, 154, 0.42);
  background: color-mix(in srgb, #d9c79a 7%, transparent);
}
.wp-stamp-root { font-weight: 600; letter-spacing: 0.1em; color: var(--text); }
.wp-stamp-zh { font-size: var(--fs-xs); color: var(--text-3); }
.wp-ety { font-size: var(--fs-xs); line-height: 1.7; color: var(--text-3); margin: 8px 0 0; }

/* 小节标:金菱刻度打头(全局 wp-label 的纸签版) */
.word-pop .wp-label { position: relative; padding-left: 15px; margin: 20px 0 8px; }
.word-pop .wp-label::before {
  content: ''; position: absolute; left: 0; top: 50%; width: 6px; height: 6px;
  transform: translateY(-50%) rotate(45deg); background: rgba(217, 199, 154, 0.55);
}

/* 记法三段:故事衬线 / 分化链铅字条 / 口诀铭牌 */
.wp-mnemo { display: flex; flex-direction: column; gap: 9px; }
.wp-mnemo-story {
  margin: 0; font-family: var(--serif);
  font-size: var(--fs-sm); line-height: 1.85; color: var(--text-2);
}
.wp-mn-row { display: flex; flex-wrap: wrap; gap: 4px 8px; align-items: baseline; font-size: var(--fs-xs); }
.wp-mn-desc { color: var(--text-3); }
.wp-mn-word {
  padding: 3px 9px; border-radius: 5px; font-size: var(--fs-xs);
  background: color-mix(in srgb, var(--surface) 88%, transparent);
  border: 1px solid var(--line); color: var(--text-2);
  transition: all 0.2s var(--ease);
}
.wp-mn-word i { font-style: normal; font-size: var(--fs-2xs); color: var(--text-3); margin-left: 5px; }
/* 链内当前词:金星标 + 金晕 — 记住词根就带走整串的读法 */
.wp-mn-word.cur {
  border-color: rgba(217, 199, 154, 0.6); color: var(--text);
  background: color-mix(in srgb, #d9c79a 10%, transparent);
  box-shadow: 0 0 14px color-mix(in srgb, #d9c79a 16%, transparent);
}
.wp-mn-word.cur::after { content: '✦'; margin-left: 6px; color: #d9c79a; font-size: var(--fs-2xs); }
.wp-mn-word.cur i { color: var(--text-2); }
/* 口诀:双线铭牌(金外框 + 内衬金线,衬线居中) */
.wp-mnemo-tag {
  margin-top: 2px; padding: 10px 16px 11px; text-align: center;
  font-family: var(--serif);
  font-size: var(--fs-sm); letter-spacing: 0.04em; line-height: 1.7; color: var(--text);
  border: 1px solid rgba(217, 199, 154, 0.45); border-radius: 8px;
  background: color-mix(in srgb, #d9c79a 6%, transparent);
  box-shadow:
    inset 0 0 0 3px color-mix(in srgb, var(--surface) 96%, transparent),
    inset 0 0 0 4px rgba(217, 199, 154, 0.22);
}
.wp-mnemo-tag-cap {
  display: block; font-size: var(--fs-2xs); letter-spacing: 0.34em; text-indent: 0.34em;
  color: var(--text-3); margin-bottom: 4px;
}
.wp-mnemo-confuse { font-size: var(--fs-xs); line-height: 1.7; color: var(--text-3); margin: 0; }

.wp-acts { display: flex; gap: 8px; margin-top: 16px; align-items: center; flex-wrap: wrap; }
.wp-goto { margin-top: 10px; }

/* 解封:分层升起(unsealRise 全局语汇,与圣殿词档案同拍) */
.word-pop .wp-head { animation: unsealRise 0.45s var(--ease) 0.05s backwards; }
.word-pop .wp-root-stamp { animation: unsealRise 0.45s var(--ease) 0.16s backwards; }
.word-pop .wp-ety { animation: unsealRise 0.45s var(--ease) 0.22s backwards; }
.word-pop .wp-label { animation: unsealRise 0.45s var(--ease) 0.28s backwards; }
.word-pop .wp-mnemo { animation: unsealRise 0.45s var(--ease) 0.34s backwards; }
.word-pop .wp-acts { animation: unsealRise 0.45s var(--ease) 0.44s backwards; }
.word-pop .wp-goto { animation: unsealRise 0.45s var(--ease) 0.52s backwards; }

@media (prefers-reduced-motion: reduce) {
  .rb-flip { transition: none; }
  .rc-page { transition: none; }
  .reader-stage-wrap.opening .rb-book-wrap { animation: none; }
}

/* 矮屏:封面元素间距收一收,clamp 下限 560px 的书体高度内也装得下整张封面 */
@media (max-height: 780px) {
  .rc-page { padding: 40px 46px 34px; }
  .rc-open { margin-top: 22px; }
  .rc-author { margin-top: 16px; }
  .rc-press { margin-top: 7px; }
}

@media (max-width: 640px) {
  .rc-page { padding: 44px 26px 40px; }
  .rc-book { height: min(74vh, 680px); }
  .reader-cover { padding: 28px 10px; }
  .rc-col { padding: 0 2px; }
  .reader-body { padding: 0 2px; }
  .rb-stage { height: min(74vh, 680px); }
  .rb-edge-btn { width: 34px; }
  .rb-ticks { display: none; }
  .rb-book-wrap::before { right: -7px; width: 8px; }
  .rb-book-wrap::after { bottom: -10px; height: 22px; }
  .rb-stage::before { inset: -40px -50px; }
}
</style>
