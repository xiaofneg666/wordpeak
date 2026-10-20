<script setup>
// 错题本:聚合各模块的错误记录
//   - store.states 中 due + strength < 0.45 → 词库"快忘了"清单
//   - grammar_results:correct=0  / *_results:correct_count<total / speaking score<0.7 / writing score<0.7
//   - 数据走 store.exportData 一次拉全,前端聚合
import { computed, ref, onActivated, onMounted, onUnmounted } from 'vue'
import HowToTrain from '../components/HowToTrain.vue'
import { useUniverse } from '../stores/universe'
import { api } from '../api'
import { message } from '../ui'
import EmptyState from '../components/EmptyState.vue'
import GrammarDetail from '../components/GrammarDetail.vue'

const store = useUniverse()
const showGrammar = ref(null)
// 语法点弹窗:Esc 也能关(与 WordPanel 同款手感)
function onEsc(e) { if (e.key === 'Escape') showGrammar.value = null }
onMounted(() => window.addEventListener('keydown', onEsc))
onUnmounted(() => window.removeEventListener('keydown', onEsc))
const tab = ref('vocab')

const tabs = [
  { key: 'vocab',     label: '词库快忘了' },
  { key: 'grammar',   label: '语法错题' },
  { key: 'reading',   label: '阅读错题' },
  { key: 'listening', label: '听力错题' },
  { key: 'speaking',  label: '口语弱句' },
  { key: 'writing',   label: '写作低分' },
]

// 词库快忘了:strength < 0.45 且 due
const criticalWords = computed(() => {
  return Object.entries(store.states || {})
    .filter(([, s]) => s.due && s.first_learned_at && (s.strength ?? 0) < 0.45)
    .map(([wid]) => store.words.find((w) => w.id === Number(wid)))
    .filter(Boolean)
    .sort((a, b) => (store.states[a.id]?.strength ?? 0) - (store.states[b.id]?.strength ?? 0))
})

// 其它模块错题:走 exportData
const exportData = ref(null)
const loaded = ref(false)
const exportFailed = ref(false) // 拉取失败态:与"没有错题"分开,断网时别把用户伪装成全对
const grammarMap = ref(new Map())
const passageMap = ref(new Map())

const grammarMistakes = computed(() => (exportData.value?.grammar_states || [])
  .filter((g) => !g.correct).sort((a, b) => (b.created_at || '').localeCompare(a.created_at || '')).slice(0, 50))
const listeningMistakes = computed(() => (exportData.value?.listening_results || [])
  .filter((r) => r.correct_count < r.total).sort((a, b) => (b.created_at || '').localeCompare(a.created_at || '')).slice(0, 30))
const readingMistakes = computed(() => (exportData.value?.reading_results || [])
  .filter((r) => r.correct_count < r.total).sort((a, b) => (b.created_at || '').localeCompare(a.created_at || '')).slice(0, 30))
const speakingWeak = computed(() => (exportData.value?.speaking_results || [])
  .filter((r) => r.score < 0.7).sort((a, b) => (b.created_at || '').localeCompare(a.created_at || '')).slice(0, 50))
const writingLow = computed(() => (exportData.value?.writing_results || [])
  .filter((r) => r.score < 0.7).sort((a, b) => (b.created_at || '').localeCompare(a.created_at || '')).slice(0, 30))

// 页头总览:六个模块的薄弱点合计
const totalWeak = computed(() =>
  criticalWords.value.length + grammarMistakes.value.length + readingMistakes.value.length +
  listeningMistakes.value.length + speakingWeak.value.length + writingLow.value.length)

let exportedAt = 0
let exporting = false // in-flight 锁:KeepAlive 首挂 onMounted+onActivated 双触发时只发一次请求
async function ensureExport() {
  if (!store.user || exporting) return
  // 全量导出可能不小:成功后 60 秒内回页不重拉(KeepAlive 后 onActivated 每次都触发);
  // 失败不缓存——下次进来/点重试直接再试
  if (loaded.value && Date.now() - exportedAt < 60000) return
  exporting = true
  try {
    exportData.value = await api.exportData(store.user.id)
    exportedAt = Date.now()
    loaded.value = true
    exportFailed.value = false
  } catch {
    exportFailed.value = true
  } finally { exporting = false }
  // passage / grammar 标题翻译
  const mP = new Map(), mG = new Map()
  for (const r of [...readingMistakes.value, ...listeningMistakes.value, ...speakingWeak.value]) {
    if (r.passage_id && !mP.has(r.passage_id)) {
      const p = store.passages.find((x) => x.id === r.passage_id)
      if (p) mP.set(r.passage_id, p.title)
    }
  }
  for (const g of grammarMistakes.value) {
    if (g.point_id && !mG.has(g.point_id)) {
      const pt = store.grammar.find((x) => x.id === g.point_id)
      if (pt) mG.set(g.point_id, pt)
    }
  }
  passageMap.value = mP; grammarMap.value = mG
}

// KeepAlive:回暗物质区刷新错题(60s 节流 + in-flight 锁见上);首次挂载也会触发本钩子,
// 所以 onMounted 只负责读本地点亮标记,不再重复拉取
onActivated(() => { ensureExport() })

function openGrammarPoint(pointId) {
  // 深链:GrammarView 挂载时读 pendingGrammarId 直接展开这个点
  store.pendingGrammarId = pointId
  store.setView('grammar')
}
function openPassage(mod, pid) {
  // 深链:目标视图挂载时读 pendingPassage 直接选中这篇语料
  store.pendingPassage = { mod, id: pid }
  store.setView(mod)
}
function startVocabRetry() {
  store.openReview()
  message.info('已开复习,系统会优先抽这些快忘了的词')
}

// ---- 重做闭环:每题一行可点「标为已掌握」→ dm-lit 金 + localStorage 持久化,
// 顶部「已点亮」计数随之累加;点过/重做过的在下次刷新里保持点亮状态。
// 不试图自动监听(跨模块状态零散),而是给用户「这道我重做对了」的明确按钮。
const LIT_KEY = 'wv_dm_lit'
const litSet = ref(new Set())
function loadLit() {
  try { litSet.value = new Set(JSON.parse(localStorage.getItem(LIT_KEY) || '[]')) } catch { litSet.value = new Set() }
}
function markLit(key) {
  const s = new Set(litSet.value)
  if (s.has(key)) return false
  s.add(key)
  litSet.value = s
  try { localStorage.setItem(LIT_KEY, JSON.stringify([...s])) } catch { /* 隐私模式 */ }
  return true
}
const litCount = computed(() => litSet.value.size)
// 错题行可展开:展开后多一行操作(更深的元数据 + 二次入口)
const expanded = ref(new Set())
function toggleExpand(key) {
  const s = new Set(expanded.value)
  s.has(key) ? s.delete(key) : s.add(key)
  expanded.value = s
}
function isExpanded(key) { return expanded.value.has(key) }
function isLit(key) { return litSet.value.has(key) }
onMounted(() => { loadLit() })
</script>

<template>
  <div class="view-scroll">
    <div class="view-inner fade-in">
      <div class="terr-head">
        <div class="terr-kicker">TERRITORY · REVIEW</div>
        <h2 class="terr-title"><BlurText text="暗物质区" as="span" /></h2>
        <div class="terr-latin">DARK MATTER</div>
        <div class="terr-rule" aria-hidden="true" />
        <p class="terr-sub">
          还没点亮的星在这里沉浮。错题不是污点，是暗物质——它们存在，只是还没发光；
          重做一题，就有一颗星亮起来。
        </p>
      </div>

      <!-- 怎么练才有效:方法论条(收起一行,展开步骤) -->
      <HowToTrain view="mistakes" />
      <!-- 拉取失败 ≠ 没有错题:断网时整页换成明确的失败态,别让空列表伪装成"你全对" -->
      <EmptyState
        v-if="exportFailed && !exportData"
        icon="断" title="错题档案没能拉取"
        desc="后端不可达——你的答题记录都在,只是这页暂时读不到;恢复网络后点重试"
      >
        <button class="btn primary" @click="ensureExport">重试拉取 →</button>
        <button class="btn" @click="store.setView('dashboard')">先回观星台 →</button>
      </EmptyState>

      <!-- 新号/全零:六个空卡怼脸观感差,整块换成引导(对齐观星台 hasLearned 收紧策略) -->
      <EmptyState
        v-else-if="!totalWeak && !store.stats?.learned"
        icon="新" title="还没有错题落进来"
        desc="先去练一轮——错题会自动沉到这里,重做一题就有一颗星亮起来"
      >
        <button class="btn primary" @click="store.startSession('cruise')">来一次 5 分钟快闪巡航 →</button>
        <button class="btn" @click="store.setView('dashboard')">回观星台看看今天学什么 →</button>
      </EmptyState>

      <template v-else>
      <!-- 上次的数据还在但这次刷新失败:保留旧数据,给一行说明(不再静默) -->
      <p v-if="exportFailed && exportData" class="terr-sub" style="margin: -6px 0 14px">
        显示的是上次拉到的错题——刚才刷新没能连上后端,稍后回来会自动重试
      </p>
      <div class="signal-hint">DARK MATTER LEDGER · 重做一题,就有一颗星亮起来</div>
      <div class="ph-stats mk-stats">
        <span class="ph-stat"><b><CountNum :v="totalWeak" mono /></b> 颗星等光</span>
        <span class="ph-stat"><b><CountNum :v="litCount" mono /></b> 颗已点亮</span>
        <span class="ph-stat"><b><CountNum :v="criticalWords.length" mono /></b> 个词快忘</span>
      </div>

      <div class="mistake-tabs">
        <button v-for="t in tabs" :key="t.key" class="mistake-tab" :class="{ active: tab === t.key }" @click="tab = t.key">
          {{ t.label }}
          <span class="mistake-num">
            <CountNum
              :v="t.key === 'vocab' ? criticalWords.length
                : t.key === 'grammar' ? grammarMistakes.length
                : t.key === 'reading' ? readingMistakes.length
                : t.key === 'listening' ? listeningMistakes.length
                : t.key === 'speaking' ? speakingWeak.length
                : writingLow.length"
              mono
            />
          </span>
        </button>
      </div>

      <template v-if="tab === 'vocab'">
        <div v-if="!criticalWords.length" class="card">
          <EmptyState title="没有快忘的词" desc="目前的词记忆强度都还不错,继续保持" />
        </div>
        <div v-else class="grid cols-3 stagger">
          <div v-for="w in criticalWords" :key="w.id" class="card hoverable mistake-word dm-hover" :class="isLit('w:'+w.id) && 'dm-lit'" @click="store.openWordInGalaxy(w.id)" role="button" tabindex="0">
            <i class="dm-star" aria-hidden="true" />
            <div v-if="isLit('w:'+w.id)" class="dm-lit-tag" style="margin-bottom: 6px">已点亮</div>
            <div class="mw-top">
              <span class="mw-word">{{ w.word }}</span>
              <span class="chip red"><CountNum :v="Math.round((store.states[w.id]?.strength ?? 0) * 100)" mono />%</span>
            </div>
            <div class="ipa fw-ipa">{{ w.ipa }}</div>
            <div class="mw-zh">{{ w.meaning?.split(/[,，;；]/)[0] }}</div>
            <button v-if="!isLit('w:'+w.id)" class="btn small ghost dm-mark" @click.stop="markLit('w:'+w.id)">标为已掌握</button>
          </div>
        </div>
        <div v-if="criticalWords.length" class="mistake-actions">
          <button class="btn primary" @click="startVocabRetry">把全部「快忘了」拉进复习</button>
        </div>
      </template>

      <template v-else-if="tab === 'grammar'">
        <div v-if="!grammarMistakes.length" class="card">
          <EmptyState title="没有语法错题" desc="机械城里的答题全对了" />
        </div>
        <div v-else class="card mistake-list">
          <div v-for="g in grammarMistakes" :key="g.created_at + g.point_id + g.quiz_index" class="mistake-row dm-hover" :class="isLit('g:'+g.created_at+g.point_id+g.quiz_index) && 'dm-lit'">
            <i class="dm-star sm" aria-hidden="true" />
            <div class="mistake-main" @click="toggleExpand('g:'+g.created_at+g.point_id+g.quiz_index)">
              <div class="mistake-title">
                <button class="link-btn" @click.stop="showGrammar = grammarMap.get(g.point_id) || null">
                  {{ (grammarMap.get(g.point_id) || {}).title || '语法点 #' + g.point_id }}
                </button>
              </div>
              <div class="mistake-sub">第 {{ (g.quiz_index || 0) + 1 }} 题 · 答错 · {{ (g.created_at || '').slice(0, 10) }}</div>
              <div v-if="isExpanded('g:'+g.created_at+g.point_id+g.quiz_index)" class="mistake-ex">
                {{ (grammarMap.get(g.point_id) || {}).explanation || '点下面按钮进入机械城这台机器的讲解页' }}
              </div>
            </div>
            <div class="mistake-actions-cell">
              <button v-if="!isLit('g:'+g.created_at+g.point_id+g.quiz_index)" class="btn small ghost" @click.stop="markLit('g:'+g.created_at+g.point_id+g.quiz_index)">重做对了</button>
              <span v-else class="dm-lit-tag">已点亮</span>
              <button class="btn small primary" @click="openGrammarPoint(g.point_id)">去练 →</button>
            </div>
          </div>
        </div>
      </template>

      <template v-else-if="tab === 'reading'">
        <div v-if="!readingMistakes.length" class="card">
          <EmptyState title="阅读全对" desc="所有阅读理解题都答对了" />
        </div>
        <div v-else class="card mistake-list">
          <div v-for="r in readingMistakes" :key="r.created_at + r.passage_id" class="mistake-row dm-hover" :class="isLit('r:'+r.created_at+r.passage_id) && 'dm-lit'">
            <i class="dm-star sm" aria-hidden="true" />
            <div class="mistake-main" @click="toggleExpand('r:'+r.created_at+r.passage_id)">
              <div class="mistake-title">{{ passageMap.get(r.passage_id) || '短文 #' + r.passage_id }}</div>
              <div class="mistake-sub">答对 {{ r.correct_count }} / {{ r.total }} · {{ (r.created_at || '').slice(0, 10) }}</div>
              <div v-if="isExpanded('r:'+r.created_at+r.passage_id)" class="mistake-ex">答对题数过半但还有错题,建议回到车厢再读一遍错题对应的句子</div>
            </div>
            <div class="mistake-actions-cell">
              <button v-if="!isLit('r:'+r.created_at+r.passage_id)" class="btn small ghost" @click.stop="markLit('r:'+r.created_at+r.passage_id)">重做对了</button>
              <span v-else class="dm-lit-tag">已点亮</span>
              <button class="btn small" @click="openPassage('reading', r.passage_id)">重读 →</button>
            </div>
          </div>
        </div>
      </template>

      <template v-else-if="tab === 'listening'">
        <div v-if="!listeningMistakes.length" class="card">
          <EmptyState title="听力全对" desc="所有听力题都答对了" />
        </div>
        <div v-else class="card mistake-list">
          <div v-for="r in listeningMistakes" :key="r.created_at + r.passage_id" class="mistake-row dm-hover" :class="isLit('l:'+r.created_at+r.passage_id) && 'dm-lit'">
            <i class="dm-star sm" aria-hidden="true" />
            <div class="mistake-main" @click="toggleExpand('l:'+r.created_at+r.passage_id)">
              <div class="mistake-title">{{ passageMap.get(r.passage_id) || '短文 #' + r.passage_id }}</div>
              <div class="mistake-sub">答对 {{ r.correct_count }} / {{ r.total }} · {{ (r.created_at || '').slice(0, 10) }}</div>
              <div v-if="isExpanded('l:'+r.created_at+r.passage_id)" class="mistake-ex">建议调到 0.6x 重听错题对应的句子,看译文的习惯先放一放</div>
            </div>
            <div class="mistake-actions-cell">
              <button v-if="!isLit('l:'+r.created_at+r.passage_id)" class="btn small ghost" @click.stop="markLit('l:'+r.created_at+r.passage_id)">重做对了</button>
              <span v-else class="dm-lit-tag">已点亮</span>
              <button class="btn small" @click="openPassage('listening', r.passage_id)">再听 →</button>
            </div>
          </div>
        </div>
      </template>

      <template v-else-if="tab === 'speaking'">
        <div v-if="!speakingWeak.length" class="card">
          <EmptyState title="没有弱句" desc="近期的口语跟读都过了 0.7 分" />
        </div>
        <div v-else class="card mistake-list">
          <div v-for="r in speakingWeak" :key="r.created_at + r.passage_id + r.sentence_index" class="mistake-row dm-hover" :class="isLit('s:'+r.created_at+r.passage_id+r.sentence_index) && 'dm-lit'">
            <i class="dm-star sm" aria-hidden="true" />
            <div class="mistake-main" @click="toggleExpand('s:'+r.created_at+r.passage_id+r.sentence_index)">
              <div class="mistake-title">{{ passageMap.get(r.passage_id) || '短文 #' + r.passage_id }} · 第 {{ (r.sentence_index || 0) + 1 }} 句</div>
              <div class="mistake-sub">{{ Math.round((r.score || 0) * 100) }} 分 · {{ r.transcript ? '「' + r.transcript + '」' : '未识别' }}</div>
              <div v-if="isExpanded('s:'+r.created_at+r.passage_id+r.sentence_index)" class="mistake-ex">你读成「{{ r.transcript || '—' }}」;把这一句慢速跟读两遍,重点补没读出的词</div>
            </div>
            <div class="mistake-actions-cell">
              <button v-if="!isLit('s:'+r.created_at+r.passage_id+r.sentence_index)" class="btn small ghost" @click.stop="markLit('s:'+r.created_at+r.passage_id+r.sentence_index)">这次跟对了</button>
              <span v-else class="dm-lit-tag">已点亮</span>
              <button class="btn small" @click="openPassage('speaking', r.passage_id)">再跟读 →</button>
            </div>
          </div>
        </div>
      </template>

      <template v-else-if="tab === 'writing'">
        <div v-if="!writingLow.length" class="card">
          <EmptyState title="没有低分写作" desc="近期写的句子/短文都过 0.7 分" />
        </div>
        <div v-else class="card mistake-list">
          <div v-for="r in writingLow" :key="r.id" class="mistake-row dm-hover" :class="isLit('wri:'+r.id) && 'dm-lit'">
            <i class="dm-star sm" aria-hidden="true" />
            <div class="mistake-main" @click="toggleExpand('wri:'+r.id)">
              <div class="mistake-title">{{ r.stage === 'essay' ? '成文' : '造句' }} · {{ Math.round((r.score || 0) * 100) }} 分</div>
              <div class="mistake-sub">{{ (r.created_at || '').slice(0, 10) }} · {{ (r.text || '').slice(0, 60) }}{{ (r.text || '').length > 60 ? '…' : '' }}</div>
              <div v-if="isExpanded('wri:'+r.id)" class="mistake-ex">{{ r.feedback || '回到写作工坊重写一版,看 AI 批注的扣分点' }}</div>
            </div>
            <div class="mistake-actions-cell">
              <button v-if="!isLit('wri:'+r.id)" class="btn small ghost" @click.stop="markLit('wri:'+r.id)">重写过了</button>
              <span v-else class="dm-lit-tag">已点亮</span>
              <button class="btn small" @click="store.pendingWritingId = r.id; store.setView('writing')">再写 →</button>
            </div>
          </div>
        </div>
      </template>

      <div v-if="showGrammar" class="modal" @click.self="showGrammar = null">
        <div class="card mistake-modal">
          <button class="modal-close" @click="showGrammar = null">✕</button>
          <GrammarDetail v-if="showGrammar" :point="showGrammar" />
        </div>
      </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
/* BlurText 接管「暗物质区」入场:全局 terrRise 在本视图置空,避免双重动画 */
.terr-title { animation: none; }

.mk-stats { margin: 0 0 22px; }

/* ===== 六模块 tab:mono 数字徽标,active 走 accent 刻线语言 ===== */
.mistake-tabs { display: flex; gap: 8px; flex-wrap: wrap; margin: 0 0 20px; }
.mistake-tab {
  padding: 8px 14px; border-radius: 999px; cursor: pointer;
  background: var(--surface); border: 1px solid var(--line-strong);
  color: var(--text-2); font-family: inherit; font-size: var(--fs-sm); font-weight: 500;
  transition: all 0.2s var(--ease); display: inline-flex; align-items: center; gap: 7px;
}
.mistake-tab:hover { color: var(--text); border-color: var(--line-accent); background: var(--surface-hover); }
.mistake-tab.active { background: var(--accent-soft); border-color: var(--line-accent); color: var(--accent); font-weight: 600; }
.mistake-num {
  font-family: var(--mono); font-size: var(--fs-2xs); padding: 1px 7px; border-radius: 999px;
  background: var(--surface-active); color: var(--text-3); font-variant-numeric: tabular-nums;
}
.mistake-tab.active .mistake-num { background: color-mix(in srgb, var(--accent) 18%, transparent); color: var(--accent); }

/* ===== 快忘词卡 ===== */
.mistake-word { text-align: left; padding: 16px 18px; transition: transform 0.18s var(--ease), border-color 0.18s var(--ease); }
.mistake-word .dm-star { display: block; margin-bottom: 10px; }
.mw-top { display: flex; align-items: baseline; gap: 8px; margin-bottom: 4px; }
.mw-word { font-weight: 700; font-size: var(--fs-lg); letter-spacing: -0.01em; }
.fw-ipa { font-size: var(--fs-xs); margin: 2px 0; }
.mw-zh { font-size: var(--fs-xs); color: var(--text-3); }
.mistake-actions { text-align: center; margin-top: 20px; }

/* 已点亮徽标:实底 success + on-success 文字(暖夜自动换深字),点亮一瞬弹出 */
.dm-lit-tag {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 3px 10px; border-radius: 999px;
  background: var(--success); color: var(--on-success);
  font-size: var(--fs-2xs); font-weight: 600; letter-spacing: 0.04em;
  animation: litPop 0.45s var(--ease-squish-2);
}
@keyframes litPop { from { transform: scale(0.6); opacity: 0; } }

/* ===== 错题行:信号行语言(左缘刻线 + hover 抬底 + mono 副行) ===== */
.mistake-list { display: flex; flex-direction: column; gap: 8px; padding: 16px; }
.mistake-row {
  position: relative; overflow: hidden;
  display: flex; align-items: center; gap: 14px;
  padding: 12px 14px 12px 16px; border-radius: var(--r-md);
  background: var(--surface-sunken); border: 1px solid var(--line);
  transition: background 0.25s var(--ease), border-color 0.25s var(--ease);
}
.mistake-row:hover { background: var(--surface-hover); border-color: var(--line-strong); }
.mistake-row::before {
  content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 2px;
  background: var(--accent); transform: scaleY(0); transform-origin: top;
  transition: transform 0.3s var(--ease);
}
.mistake-row:hover::before { transform: scaleY(1); }
.mistake-main { flex: 1; min-width: 0; cursor: pointer; }
.mistake-title { font-size: var(--fs-base); font-weight: 500; color: var(--text); }
.mistake-sub { font-family: var(--mono); font-size: var(--fs-2xs); color: var(--text-3); margin-top: 4px; letter-spacing: 0.04em; }
.mistake-ex { margin-top: 8px; font-size: var(--fs-xs); color: var(--text-2); line-height: 1.7; padding: 8px 12px; background: var(--surface); border-radius: var(--r-sm); border-left: 2px solid var(--accent); }
.mistake-actions-cell { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.link-btn { background: transparent; border: 0; padding: 0; color: var(--accent); font-family: inherit; font-size: var(--fs-base); font-weight: 500; cursor: pointer; transition: opacity 0.2s var(--ease); }
.link-btn:hover { text-decoration: underline; text-underline-offset: 4px; }
.dm-mark { margin-top: 8px; }

.mistake-modal { width: min(780px, 92vw); max-height: 86vh; overflow-y: auto; padding: 24px 26px; position: relative; }

@media (max-width: 768px) {
  .mistake-actions-cell { flex-wrap: wrap; justify-content: flex-end; }
}
</style>