<script setup>
import { computed, watch, ref } from 'vue'
import { useUniverse } from '../stores/universe'
import EmptyState from '../components/EmptyState.vue'
import { NPopconfirm } from 'naive-ui'
import { message } from '../ui'
import { classifyWordState, WORD_STATE_META } from '../utils/wordState'

const store = useUniverse()

// 当前打开的收藏夹
const current = computed(() => store.collections.find((c) => c.id === store.currentCollectionId))

// 词按学习状态自动分优先级(快忘了 > 待复习 > 学习中 > 已掌握 > 还没学),帮复习时一眼看到薄弱词
const PRIORITY = { critical: 0, due: 1, learning: 2, mastered: 3, new: 4 }
const sortedWords = computed(() => {
  return [...store.collectionWords].sort((a, b) => {
    const sa = PRIORITY[stateOf(a.id).cls] ?? 9
    const sb = PRIORITY[stateOf(b.id).cls] ?? 9
    if (sa !== sb) return sa - sb
    return (a.added_at || '').localeCompare(b.added_at || '') // 同优先级按加入时间倒序
  })
})
// 每个词的「掌握状态」徽章(已掌握 / 学习中 / 待复习 / 紧急 / 新)
// (openCol / openInGalaxy 真正定义在下方,模板中靠 hoisting 调用)

// 夹内学习状态:已学 / 未学 / 待复习(只看 store.states,词库里这些词没有 states 就算未学)
function collStats(c) {
  let learned = 0, unlearned = 0, due = 0
  for (const id of c.word_ids || []) {
    const s = store.states[id]
    if (!s || s.is_new) { unlearned++; continue }
    learned++
    if (s.due) due++
  }
  return { learned, unlearned, due, total: (c.word_ids || []).length }
}
function collPct(c, key) {
  const t = (c.word_ids || []).length || 1
  return Math.round((collStats(c)[key] / t) * 100)
}
async function reviewColl(c) {
  // 把夹里已学词逐个推入复习队列(走 store.api_learnWord 走真实 API)
  const ids = (c.word_ids || []).filter((id) => store.states[id] && !store.states[id].is_new)
  if (!ids.length) { message.info('这个夹里还没有学过的词,先学再加复习'); return }
  let ok = 0
  for (const id of ids) { try { await store.api_learnWord(id); ok++ } catch { /* 单条失败继续 */ } }
  message.success(`已把「${c.name}」的 ${ok} 个词推入复习队列`)
}

function stateOf(wid) {
  const k = classifyWordState(store.states[wid])
  return { cls: k, label: WORD_STATE_META[k].label }
}

function back() {
  store.currentCollectionId = null
  store.collectionWords = []
}
function openCol(c) { store.openCollection(c.id) }
function openInGalaxy(w) { store.openWordInGalaxy(w.id) }

async function deleteCol(c, e) {
  e.stopPropagation()
  await store.deleteCollection(c.id)
  message.success(`已删除「${c.name}」`)
}

async function removeWord(wid) {
  if (!store.currentCollectionId) return
  await store.removeFromCollection(store.currentCollectionId, wid)
}

// 通用下载器:根据 mime + content 生成 .json/.csv/.tsv 文件
function download(name, content, mime) {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

async function getPayload() {
  if (!current.value) return null
  const p = await store.exportCollection(store.currentCollectionId)
  if (!p) { message.error('没有可导出的词'); return null }
  return p
}

async function exportJSON() {
  const p = await getPayload(); if (!p) return
  download(`wordpeak-${p.collection.name}-${new Date().toISOString().slice(0, 10)}.json`,
    JSON.stringify(p, null, 2), 'application/json')
  message.success('已导出 JSON')
}

// CSV(逗号分隔,字段含逗号/引号/换行的加引号转义):Excel / Numbers / Google Sheets 直接打开
function csvEscape(s) {
  if (s == null) return ''
  const v = String(s)
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}
async function exportCSV() {
  const p = await getPayload(); if (!p) return
  const head = ['word', 'ipa', 'pos', 'meaning', 'root', 'root_meaning', 'family', 'level']
  const rows = p.words.map((w) => [w.word, w.ipa, w.pos, w.meaning, w.root, w.root_meaning, w.family, w.level].map(csvEscape).join(','))
  // 头部加 BOM 让 Excel 正确识别 UTF-8 中文
  const content = '﻿' + head.join(',') + '\n' + rows.join('\n')
  download(`wordpeak-${p.collection.name}-${new Date().toISOString().slice(0, 10)}.csv`, content, 'text/csv')
  message.success('已导出 CSV(Excel 可直接打开)')
}

// Anki 桌面版导入:标准 TSV,front=`word [ipa]` / back=`pos  meaning  root(义)` / tags=词根家族
// Anki 导入流程:File → Import → 选 .txt → Separator: Tab → 字段映射 front/back → 完成
function ankiEscape(s) {
  if (s == null) return ''
  return String(s).replace(/[\t\r\n]/g, ' ').trim()
}
async function exportAnki() {
  const p = await getPayload(); if (!p) return
  const tag = `wordpeak ${p.collection.name}`.replace(/[ ,]/g, '_')
  const rows = p.words.map((w) =>
    [ankiEscape(`${w.word} [${w.ipa}]`), ankiEscape(`${w.pos} ${w.meaning}`),
      ankiEscape(`词根 ${w.root}- · ${w.root_meaning}`), tag].join('\t'))
  download(`wordpeak-${p.collection.name}-anki.txt`, rows.join('\n'), 'text/plain')
  message.success('已导出 Anki 格式(File → Import 选 .txt 即可)')
}

// 进入页面就拉一次(也用于跨页后回弹保持最新)
watch(() => store.user, () => { if (store.user) store.loadCollections() }, { immediate: true })
</script>

<template>
  <div class="view-scroll">
    <div class="view-inner fade-in">
      <!-- 夹列表态 = 收藏夹领地;进了某个夹 = 回到工作态页头(功能性优先) -->
      <div v-if="!current" class="terr-head">
        <div class="terr-kicker">TERRITORY · COLLECTIONS</div>
        <h2 class="terr-title"><BlurText text="收藏夹" as="span" /></h2>
        <div class="terr-latin">COLLECTIONS</div>
        <div class="terr-rule" aria-hidden="true" />
        <p class="terr-sub">
          把值得反复看的词归类放进来——比如「CET-6 重点」「外刊高频」「我的最爱」。跨家族组织你的生词。
        </p>
      </div>
      <div v-else class="ph-header">
        <div>
          <div class="cl-kicker">COLLECTION · 收藏册页</div>
          <div class="section-title">{{ current.name }}</div>
          <div class="section-sub">
            共 <b class="cl-count"><CountNum :v="current.word_count || 0" mono /></b> 个词 · 点击卡片回星系查看 · 页面底部可导出 CSV / Anki / JSON
          </div>
        </div>
        <div class="cl-head-actions">
          <button class="btn ghost" @click="back">← 返回收藏夹列表</button>
          <button class="btn danger small" @click="(e) => deleteCol(current, e)">删除夹</button>
        </div>
      </div>

      <!-- 无收藏夹选中:网格 + 新建卡 -->
      <template v-if="!current">
        <EmptyState
          v-if="!store.collections.length && !store.user"
          title="先登录"
          desc="收藏夹跟账号绑定,登录后即可使用"
        />
        <EmptyState
          v-else-if="!store.collections.length"
          icon="夹" title="还没有收藏夹"
          desc="点词汇圣殿的任意星球,右侧词卡里有「收藏」书签钮 → 选择或新建"
        >
          <button class="btn primary" @click="store.setView('galaxy')">去词汇圣殿选词 →</button>
        </EmptyState>
        <template v-else>
          <!-- 领地读数:在册的夹与词星 -->
          <div class="ph-stats coll-stats">
            <span class="ph-stat"><b><CountNum :v="store.collections.length" mono /></b> 个收藏夹</span>
            <span class="ph-stat"><b><CountNum :v="store.collections.reduce((a, c) => a + (c.word_count || 0), 0)" mono /></b> 颗词星在册</span>
          </div>
        <div class="grid cols-3 stagger">
          <div
            v-for="c in store.collections" :key="c.id"
            class="card coll-card hoverable coll-wrap-cell"
            role="button" tabindex="0"
            @click="openCol(c)"
            @keydown.enter="openCol(c)"
          >
            <div class="coll-head">
              <span class="coll-color" :class="`is-${c.color || 'accent'}`" />
              <span class="coll-name">{{ c.name }}</span>
              <span class="coll-count"><CountNum :v="c.word_count || 0" mono /> 词</span>
            </div>
            <!-- 夹内星墙:一词一星五态着色,还没点开就知道这夹的成色 -->
            <div class="coll-wall" :title="`已学 ${collStats(c).learned} · 待复习 ${collStats(c).due} · 未学 ${collStats(c).unlearned} · 每颗星一个词`">
              <i
                v-for="wid in (c.word_ids || []).slice(0, 24)" :key="wid"
                class="dm-star sm" :class="classifyWordState(store.states[wid])"
              />
              <span v-if="(c.word_ids || []).length > 24" class="coll-more">+{{ (c.word_ids || []).length - 24 }}</span>
            </div>
            <div class="coll-foot">
              <span class="foot-date">{{ new Date(c.created_at).toLocaleDateString() }}</span>
              <button v-if="collStats(c).learned" class="coll-rev" @click.stop="reviewColl(c)" title="把这个夹的已学词拉进复习">复习整夹</button>
              <n-popconfirm
                :show-arrow="false"
                placement="top"
                @positive-click="deleteCol(c, $event)"
                positive-text="删除"
                negative-text="保留"
              >
                <template #trigger>
                  <span class="text-3 coll-del" @click.stop title="删除">✕</span>
                </template>
                「{{ c.name }}」将被永久删除({{ c.word_count }} 个词会一起移除)
              </n-popconfirm>
            </div>
          </div>
        </div>
        </template>
      </template>

      <!-- 选中收藏夹:词卡网格 -->
      <template v-else>
        <EmptyState
          v-if="!store.collectionWords.length"
          compact
          title="这个收藏夹还是空的"
          desc="点词汇圣殿的星球,在弹窗里选这个夹即可加入"
        />
        <div v-else class="grid cols-3 stagger coll-words">
          <div
            v-for="w in sortedWords" :key="w.id"
            class="card coll-word hoverable"
            :class="stateOf(w.id).cls"
            role="button" tabindex="0"
            @click="openInGalaxy(w)"
            @keydown.enter="openInGalaxy(w)"
          >
            <div class="cw-top">
              <span class="cw-word">{{ w.word }}</span>
              <span class="chip" :class="stateOf(w.id).cls === 'new' ? 'dim' : stateOf(w.id).cls">{{ stateOf(w.id).label }}</span>
            </div>
            <div class="ipa fw-ipa">{{ w.ipa }}</div>
            <div class="cw-zh">{{ w.meaning?.split(/[,，;；]/)[0] }}</div>
            <button class="cw-remove" title="从夹中移除" @click.stop="removeWord(w.id)">✕</button>
          </div>
        </div>

        <div v-if="store.collectionWords.length" class="coll-export">
          <span class="coll-export-note">SORTED BY URGENCY · 已按学习优先级排序(快忘了优先)</span>
          <div class="coll-export-btns">
            <button class="btn small" @click="exportCSV" title="Excel/Numbers/Sheets 直接打开">导出 CSV</button>
            <button class="btn small" @click="exportAnki" title="桌面 Anki File → Import 即可导入">导出 Anki</button>
            <button class="btn" @click="exportJSON" title="完整 JSON(词卡所有字段)">导出 JSON</button>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
/* BlurText 接管「收藏夹」入场:全局 terrRise 在本视图置空,避免双重动画 */
.terr-title { animation: none; }

/* 领地读数行 */
.coll-stats { margin: -10px 0 22px; }

/* ===== 夹卡:四芒星徽标 + 家族星墙 ===== */
.coll-card { text-align: left; display: flex; flex-direction: column; }
.coll-head { display: flex; align-items: center; gap: 10px; }
/* 夹徽标:圆点升级为四芒星(收藏的星,不是文件夹) */
.coll-color {
  width: 13px; height: 13px; flex-shrink: 0;
  clip-path: polygon(50% 0, 58% 42%, 100% 50%, 58% 58%, 50% 100%, 42% 58%, 0 50%, 42% 42%);
}
.coll-color.is-accent { background: var(--accent); }
.coll-color.is-accent-2 { background: var(--accent-2); }
.coll-color.is-success { background: var(--success); }
.coll-color.is-warn { background: var(--warn); }
.coll-color.is-danger { background: var(--danger); }
.coll-color.is-info { background: var(--info); }
.coll-name { flex: 1; font-weight: 600; font-size: var(--fs-md); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.coll-count { font-family: var(--mono); font-size: var(--fs-xs); color: var(--text-3); font-variant-numeric: tabular-nums; }
/* 星墙:一词一星,悬停整墙提亮——靠近这夹,它的星都醒过来 */
.coll-wall { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 12px; padding-top: 12px; border-top: 1px dashed var(--line); min-height: 28px; align-content: flex-start; }
.coll-wall .dm-star { transition: transform 0.3s var(--ease), background 0.3s var(--ease), opacity 0.3s var(--ease); }
.coll-wall .dm-star.sm { width: 9px; height: 9px; }
.coll-wall .dm-star.new { background: var(--text-3); opacity: 0.3; }
.coll-wall .dm-star.critical { background: var(--danger); opacity: 0.95; }
.coll-wall .dm-star.due { background: var(--warn); opacity: 0.95; }
.coll-wall .dm-star.learning { background: var(--accent); opacity: 0.9; }
.coll-wall .dm-star.mastered { background: var(--gold); opacity: 1; filter: drop-shadow(0 0 4px color-mix(in srgb, var(--gold) 40%, transparent)); }
[data-theme='light'] .coll-wall .dm-star.mastered { filter: none; }
.coll-card:hover .coll-wall .dm-star { transform: scale(1.15); }
.coll-more { font-family: var(--mono); font-size: var(--fs-2xs); color: var(--text-3); align-self: center; margin-left: 2px; }
.coll-rev { background: none; border: 1px solid var(--line-accent); color: var(--accent); padding: 3px 10px; border-radius: 999px; font-size: var(--fs-2xs); cursor: pointer; transition: all 0.2s var(--ease); margin-right: 8px; font-family: inherit; }
.coll-rev:hover { background: var(--accent-soft); }
.coll-foot { display: flex; justify-content: space-between; align-items: center; margin-top: 14px; padding-top: 10px; border-top: 1px dashed var(--line); }
.coll-foot .foot-date { font-size: var(--fs-2xs); color: var(--text-3); }
.coll-del { width: 22px; height: 22px; display: flex; align-items: center; justify-content: center; border-radius: var(--r-xs); cursor: pointer; transition: background 0.15s var(--ease); }
.coll-del:hover { background: var(--surface-hover); color: var(--danger); }

/* ===== 进夹页头(工作态优先):kicker + 读数 ===== */
.cl-head-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.cl-kicker {
  font-family: var(--mono); font-size: var(--fs-2xs); font-weight: 600;
  letter-spacing: 0.3em; color: var(--accent); opacity: 0.85; margin-bottom: 6px;
}
.cl-count { font-family: var(--mono); font-weight: 700; color: var(--text); }

.coll-words { margin-bottom: 16px; }
/* 词卡:左缘状态刻线,hover 立起,颜色跟五态(与信号行/家族词卡同一语言) */
.coll-word { position: relative; cursor: pointer; padding: 16px 18px; transition: transform 0.18s var(--ease), border-color 0.18s var(--ease); }
.coll-word::before {
  content: ''; position: absolute; left: 0; top: 10px; bottom: 10px; width: 2px;
  background: var(--accent); transform: scaleY(0); transform-origin: top;
  transition: transform 0.3s var(--ease), background 0.3s var(--ease);
}
.coll-word:hover::before { transform: scaleY(1); }
.coll-word.mastered::before { background: var(--success); }
.coll-word.due::before { background: var(--warn); }
.coll-word.critical::before { background: var(--danger); }
.coll-word:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.coll-word.mastered { border-color: color-mix(in srgb, var(--success) 30%, transparent); }
.coll-word.critical { border-color: color-mix(in srgb, var(--danger) 40%, transparent); animation: cwPulse 2s ease-in-out infinite; }
.coll-word.due { border-color: color-mix(in srgb, var(--warn) 30%, transparent); }
.coll-word.new { opacity: 0.8; }
@keyframes cwPulse {
  0%, 100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--danger) 0%, transparent); }
  50% { box-shadow: 0 0 0 4px color-mix(in srgb, var(--danger) 18%, transparent); }
}
.cw-top { display: flex; align-items: baseline; gap: 8px; margin-bottom: 4px; padding-right: 22px; }
.cw-word { font-weight: 700; font-size: var(--fs-lg); letter-spacing: -0.01em; }
.fw-ipa { font-size: var(--fs-xs); margin: 2px 0; }
.cw-zh { font-size: var(--fs-sm); color: var(--text-3); margin-top: 4px; }
.cw-remove {
  position: absolute; top: 8px; right: 8px;
  width: 22px; height: 22px; border-radius: var(--r-sm);
  background: transparent; border: 1px solid transparent; color: var(--text-3); cursor: pointer;
  font-size: var(--fs-sm); line-height: 1;
  display: flex; align-items: center; justify-content: center;
  transition: all 0.15s var(--ease);
}
.cw-remove:hover { background: var(--surface-hover); color: var(--danger); border-color: var(--line); }

/* 导出条:mono 刻字说明 */
.coll-export { display: flex; justify-content: space-between; align-items: center; margin-top: 8px; flex-wrap: wrap; gap: 8px; }
.coll-export-note { font-family: var(--mono); font-size: var(--fs-2xs); letter-spacing: 0.14em; color: var(--text-3); }
.coll-export-btns { display: flex; gap: 8px; flex-wrap: wrap; }
.coll-wrap-cell { cursor: pointer; }
.coll-wrap-cell:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
</style>