<script setup>
import { computed, ref, watch } from 'vue'
import { useUniverse } from '../stores/universe'
import EmptyState from '../components/EmptyState.vue'
import { classifyWordState, WORD_STATE_META } from '../utils/wordState'

const store = useUniverse()

// 当前查看的词根(没有时显示词根索引)
const root = computed(() => store.currentRoot)
const familyMeta = computed(() => store.words.find((w) => w.root === root.value)
  || store.words.find((w) => w.family === root.value)
  || null)
const familyWords = computed(() => {
  if (!root.value) return []
  return store.words.filter((w) => w.root === root.value || w.family === root.value)
})

// 词根故事(/api/roots 返回三段式:story 来源故事 / branches 同族分化 / confuse 易混辨析)
const storyInfo = computed(() => (root.value && store.rootStories[root.value]) || null)
const story = computed(() => {
  if (!root.value) return null
  return storyInfo.value?.story
    || `词根 ${root.value.toUpperCase()}- 家族:记住一个词根,就能带走一串词。点下面的词卡,回星系里查看、跟读和复习。`
})
const branches = computed(() => storyInfo.value?.branches || null)
const confuse = computed(() => storyInfo.value?.confuse || null)

// ---- branches 字符串 → 分叉图腾 ----
// 数据形状:「语义描述→word 释义、word 释义；语义描述→word 释义」(root_stories.json 40 词根统一此格式)
// 解析成 [{desc, words:[{word, zh, entry}]}];无箭头的散文段(如 spect 末尾的 spectator 观众…)
// 归入 loose 兜底展示,解析不出来整段退回纯文本——对数据永远不硬编码
const branchList = computed(() => {
  const raw = branches.value
  if (!raw) return null
  const bank = new Map(familyWords.value.map((w) => [w.word.toLowerCase(), w]))
  const list = []
  const loose = []
  for (const frag of raw.split(/[；;]/).map((s) => s.trim()).filter(Boolean)) {
    const arrow = frag.indexOf('→')
    if (arrow < 0) { loose.push(frag); continue }
    const desc = frag.slice(0, arrow).trim()
    const rest = frag.slice(arrow + 1)
    // 箭头段在句号截断:句号后是散文尾巴(如 spect 的「看的人是 spectator 观众…」),归入 loose
    const dot = rest.indexOf('。')
    const head = dot >= 0 ? rest.slice(0, dot) : rest
    const tail = dot >= 0 ? rest.slice(dot + 1).trim() : ''
    const words = []
    const re = /([A-Za-z][A-Za-z-]*)\s*([一-鿿][^、；;。！？A-Za-z]*)/g
    let m
    while ((m = re.exec(head))) {
      words.push({ word: m[1], zh: m[2].split(/[,，]/)[0].trim(), entry: bank.get(m[1].toLowerCase()) || null })
    }
    if (desc && words.length) list.push({ desc, words })
    else loose.push(frag)
    if (tail) loose.push(tail)
  }
  if (!list.length) return null
  return { list, loose }
})

// ---- confuse → 正文 + 口诀铭牌(口诀是这一段真正的钩子,单独托出来) ----
const confuseParts = computed(() => {
  const raw = confuse.value
  if (!raw) return null
  const m = raw.match(/口诀[:：]?\s*(.+)$/)
  return m
    ? { text: raw.slice(0, m.index).trim(), mnemonic: m[1].trim() }
    : { text: raw, mnemonic: null }
})

// 按掌握度排序(已掌握优先,未探索最后);排序权重与 classifyWordState 五态一一对应
const STATE_RANK = ['new', 'critical', 'due', 'learning', 'mastered']
const rankedWords = computed(() => {
  const arr = [...familyWords.value]
  const score = (w) => STATE_RANK.indexOf(classifyWordState(store.states[w.id]))
  return arr.sort((a, b) => score(b) - score(a))
})

// 掌握度聚合(五态分类走统一 util)
const mastery = computed(() => {
  const total = familyWords.value.length
  const counts = { new: 0, critical: 0, due: 0, learning: 0, mastered: 0 }
  for (const w of familyWords.value) counts[classifyWordState(store.states[w.id])]++
  const learned = total - counts.new
  const masteredPct = total ? Math.round((counts.mastered / total) * 100) : 0
  // 字段名保留旧口径(neu=new),模板不动
  return { total, ...counts, neu: counts.new, learned, masteredPct }
})

function stateOf(w) {
  const k = classifyWordState(store.states[w.id])
  const m = WORD_STATE_META[k]
  return { cls: k, label: m.label, color: m.color }
}

function openWord(w) { store.openWordInGalaxy(w.id) }

// ---- 树状图分支点击:放大某一分支(其余淡化),分支内按掌握度排序;再点返回全树 ----
const activeBranch = ref(null)
const BRANCHES = [
  { key: 'mastered', label: '已掌握', cls: 'green' },
  { key: 'learning', label: '学习中', cls: 'cyan' },
  { key: 'due', label: '待复习', cls: 'amber' },
  { key: 'critical', label: '快忘了', cls: 'red' },
  { key: 'new', label: '还没学', cls: 'dim' },
]
const branchCount = computed(() => ({
  mastered: mastery.value.mastered,
  learning: mastery.value.learning,
  due: mastery.value.due,
  critical: mastery.value.critical,
  new: mastery.value.neu,
}))
const activeBranchLabel = computed(() => BRANCHES.find((b) => b.key === activeBranch.value)?.label || '')
// 分支视图:只保留该分支的词,按掌握度升序(最薄弱在前)
const branchWords = computed(() => {
  if (!activeBranch.value) return rankedWords.value
  return familyWords.value
    .filter((w) => stateOf(w).cls === activeBranch.value)
    .sort((a, b) => (store.states[a.id]?.strength ?? 0) - (store.states[b.id]?.strength ?? 0))
})
function toggleBranch(key) { activeBranch.value = activeBranch.value === key ? null : key }
// 切换词根时回到全树
watch(root, () => { activeBranch.value = null })

// 复习整族:把所有非已掌握的词逐个标记为待复习 + 立即进入复习弹窗
async function reviewFamily() {
  if (!familyWords.value.length) return
  // 标记所有未学/未掌握的为生词进入队列
  for (const w of familyWords.value) {
    const s = store.states[w.id]
    if (!s || s.is_new || (s.strength ?? 0) < 0.75) {
      try { await store.api_learnWord(w.id) } catch { /* 离线 */ }
    }
  }
  store.openReview()
}

// ---- 真返回:family 的入口有 5+ 个(圣殿词卡/观星台/工坊/词汇网/词卡详情),
// openFamily 已把来源记进 store.fromView,这里只负责显示和送回去 ----
const FROM_LABELS = {
  dashboard: '观星台', learn: '学习舱', lab: '记忆工坊', network: '词汇网络',
  galaxy: '词汇圣殿', phonetics: '发音舱', grammar: '语法机械城', listening: '回声谷',
  speaking: '口语竞技场', reading: '阅读号列车', writing: '写作工坊', diary: '英语日记',
  tips: '技巧库', bookshelf: '轨道书库', reader: '夜读舱', collections: '收藏夹',
  mistakes: '暗物质区', settings: '设置',
}
const backTarget = computed(() => {
  const v = store.fromView
  if (!root.value) {
    // 索引态:有真实来源且不是主页才给返回(观星台就是家,不用「返回」)
    if (!v || v === 'dashboard') return null
    return { view: v, label: FROM_LABELS[v] || '上一页' }
  }
  // 详情态:没记录到来源时兜回圣殿(词根详情的主场景)
  const target = v || 'galaxy'
  return { view: target, label: FROM_LABELS[target] || '词汇圣殿' }
})
function goBack() { store.setView(backTarget.value.view) }

function pickSimilar() {
  // 直达技巧库「词根法」那一条(TipsView 深链会自动切分类并高亮)
  const tip = store.tips.find((t) => /词根/.test(t.title))
  if (tip) store.openTipRecommend(tip)
  else store.setView('tips')
}

// 全部词根(用作索引)
const allRoots = computed(() => {
  const map = new Map()
  for (const w of store.words) {
    if (!map.has(w.root)) map.set(w.root, { root: w.root, meaning: w.root_meaning, family: w.family, count: 0, mastered: 0, learning: 0, total: 0, _ids: [] })
    const rec = map.get(w.root)
    rec.count++
    rec.total++
    rec._ids.push(w.id)
    const s = store.states[w.id]
    if (s && !s.is_new) {
      const k = s.strength ?? 0
      if (k > 0.75) rec.mastered++
      else rec.learning++
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count)
})

// 词根索引搜索(按词根/含义/词)
const famQuery = ref('')
const rootsFiltered = computed(() => {
  const q = famQuery.value.trim().toLowerCase()
  if (!q) return allRoots.value
  return allRoots.value.filter((r) =>
    r.root.toLowerCase().includes(q) ||
    (r.meaning || '').toLowerCase().includes(q) ||
    store.words.some((w) => w.root === r.root && (w.word.toLowerCase().includes(q) || (w.meaning || '').toLowerCase().includes(q)))
  )
})
// 词根卡 mastery 环(pct 0-1):已学掌握 / 全部词
function rootMasteryPct(r) {
  return r.total ? Math.min(1, r.mastered / r.total) : 0
}
function rootRingStyle(p) {
  return { background: `conic-gradient(var(--success) 0% ${p * 100}%, var(--surface-active) ${p * 100}% 100%)` }
}

// 家族词星墙(在索引卡和详情头用):每个词一颗 dm-star,按五态着色
function wordStarCls(wid) {
  const s = store.states[wid]
  if (!s || s.is_new) return 'dm-new'
  const k = s.strength ?? 0
  if (s.due && k < 0.45) return 'dm-critical'
  if (s.due) return 'dm-due'
  if (k > 0.75) return 'dm-mastered'
  if (k > 0.45) return 'dm-learning'
  return 'dm-fading'
}
</script>

<template>
  <div class="view-scroll">
    <div class="view-inner fade-in">
      <button v-if="backTarget" class="btn ghost fam-back" @click="goBack">← 返回{{ backTarget.label }}</button>

      <!-- ============ 词根索引(无 currentRoot 时) ============ -->
      <template v-if="!root">
        <div class="terr-head">
          <div class="terr-kicker">TERRITORY · ROOTS</div>
          <h2 class="terr-title"><BlurText text="词根群星" as="span" /></h2>
          <div class="terr-latin">ROOT FAMILIES</div>
          <div class="terr-rule" aria-hidden="true" />
          <p class="terr-sub">
            40 个词根星座——点开任一星座，看它的故事、家族里的全部单词，以及你掌握得怎么样。
          </p>
        </div>
        <EmptyState
          v-if="!allRoots.length"
          icon="星" title="词根索引还没有生成"
          desc="词库刷新一下通常就能加载出来;一直空着,晚点再来"
        />
        <template v-else>
          <!-- 索引搜索:按词根/含义/家族任一词 -->
          <div class="fam-search">
            <input v-model="famQuery" class="fam-search-input" type="search" placeholder="搜词根 / 含义 / 词…（例:port, 看, spec）" />
            <span v-if="famQuery" class="fam-search-clear" @click="famQuery = ''">×</span>
          </div>
          <div v-if="!rootsFiltered.length" class="card">
            <EmptyState title="没有匹配的词根" :desc="`没有词根 / 含义 / 词包含「${famQuery}」`" />
          </div>
          <div v-else class="grid cols-3 stagger">
            <button
              v-for="r in rootsFiltered" :key="r.root"
              class="card root-card unstyled-btn" @click="store.openFamily(r.root)"
            >
              <div class="root-title">{{ r.root.toUpperCase() }}-</div>
              <div class="root-meaning">{{ r.meaning }}</div>
              <!-- 家族星墙:一词一星,五态着色——这个星座里还有几颗没亮,一眼可见 -->
              <div class="root-wall" :title="`已掌握 ${r.mastered} / ${r.total} 词 · 金星=已掌握,暗星=还没学`">
                <i v-for="wid in r._ids" :key="wid" class="dm-star sm" :class="wordStarCls(wid)" />
              </div>
              <div class="root-card-foot">
                <span class="chip cyan">{{ r.count }} 词</span>
                <span v-if="r.mastered" class="chip green">{{ r.mastered }} 已掌握</span>
                <span class="card-hint">进入 →</span>
              </div>
            </button>
          </div>
        </template>
      </template>

      <!-- ============ 词根详情 ============ -->
      <template v-else>
        <!-- 家族星图头卡:kicker → 衬线词根 → 含义 → 星墙(点阵底纹,领地命名式落点) -->
        <div class="family-head card dots-host">
          <span class="dots-decor dots-fade" aria-hidden="true" style="--dots-o:.2" />
          <div class="fam-head-flex">
            <div>
              <div class="fam-kicker">FAMILY CHART · 家族星图</div>
              <div class="family-root">{{ root.toUpperCase() }}-</div>
              <div class="family-meaning">{{ familyMeta?.root_meaning || '—' }} · 全部单词与你的掌握情况</div>
            </div>
            <div class="fam-head-actions">
              <button class="btn" @click="pickSimilar">词根记忆法</button>
              <button class="btn primary" @click="reviewFamily">复习整族</button>
            </div>
          </div>
          <!-- 家族星图 mini:每词一颗四芒星,五态着色,一眼看到这族里还有几颗没亮 -->
          <div class="fam-star-wall" :title="`已掌握 ${mastery.mastered} · 学习中 ${mastery.learning} · 待复习 ${mastery.due} · 濒临 ${mastery.critical} · 未学 ${mastery.new}`">
            <i
              v-for="w in familyWords" :key="w.id"
              class="dm-star" :class="[wordStarCls(w.id), mastery.learned && mastery.total ? '' : 'sm']"
            />
          </div>
        </div>

        <!-- 词源故事:来源故事 / 同族分化(分叉图腾) / 易混辨析(口诀铭牌) -->
        <div class="card story-card">
          <div class="card-head"><div class="h-card">词源故事</div></div>
          <p class="story-text">{{ story }}</p>
          <template v-if="branchList || branches || confuseParts">
            <!-- 同族分化:语义分叉图腾——左脊柱刻线,每根叉 = 一个语义,词按你的掌握度着色 -->
            <div v-if="branchList" class="story-block bm">
              <div class="story-tag">同族分化 · 一根生出一树</div>
              <div class="bm-tree">
                <div v-for="(b, i) in branchList.list" :key="i" class="bm-node" :style="{ '--i': i }">
                  <span class="bm-desc">{{ b.desc }}</span>
                  <div class="bm-words">
                    <template v-for="w in b.words" :key="w.word">
                      <button v-if="w.entry" class="bm-word" :class="stateOf(w.entry).cls" title="点词回星系" @click="openWord(w.entry)">
                        <b>{{ w.word }}</b><i>{{ w.zh }}</i>
                      </button>
                      <span v-else class="bm-word dim"><b>{{ w.word }}</b><i>{{ w.zh }}</i></span>
                    </template>
                  </div>
                </div>
              </div>
              <p v-for="(t, i) in branchList.loose" :key="'l' + i" class="story-text bm-loose">{{ t }}</p>
            </div>
            <div v-else-if="branches" class="story-block">
              <div class="story-tag">同族分化</div>
              <p class="story-text">{{ branches }}</p>
            </div>
            <!-- 易混辨析:正文 + 口诀铭牌 -->
            <div v-if="confuseParts" class="story-block">
              <div class="story-tag">易混辨析</div>
              <p class="story-text">{{ confuseParts.text }}</p>
              <blockquote v-if="confuseParts.mnemonic" class="story-mnemonic">
                <span class="mn-tag">口诀</span>
                <p>{{ confuseParts.mnemonic }}</p>
              </blockquote>
            </div>
          </template>
        </div>

        <!-- 掌握度统计(全局 .stat-tile 大数字磁贴) -->
        <div class="grid cols-3 stat-row">
          <div class="card stat-tile">
            <div class="num"><CountNum :v="mastery.learned" mono /><i class="st-sep">/</i><CountNum :v="mastery.total" mono /></div>
            <div class="lbl">已学</div>
          </div>
          <div class="card stat-tile">
            <div class="num green"><CountNum :v="mastery.masteredPct" mono /><i class="st-sep">%</i></div>
            <div class="lbl">掌握率({{ mastery.mastered }})</div>
          </div>
          <div class="card stat-tile">
            <div class="num red"><CountNum :v="mastery.critical" mono /></div>
            <div class="lbl">快忘了</div>
          </div>
        </div>

        <!-- 该词根全词表(可按分支放大) -->
        <div class="card">
          <div class="card-head">
            <div class="h-card">{{ root.toUpperCase() }}- 家族{{ activeBranch ? activeBranchLabel + '分支' : '全部单词' }} ({{ branchWords.length }})</div>
            <button v-if="activeBranch" class="btn small ghost" @click="activeBranch = null">返回全部</button>
          </div>
          <p class="card-sub">
            {{ activeBranch
              ? `现在只看「${activeBranchLabel}」这些词,掌握得最弱的排在前面,点词卡回星系`
              : '点词卡回星系查看;点状态标签可以只看这一类词' }}
          </p>

          <!-- 分支节点:点一下放大,再点返回全树 -->
          <div class="branch-row">
            <button
              v-for="b in BRANCHES" :key="b.key"
              class="branch-btn" :class="[b.cls, { active: activeBranch === b.key, faded: !!activeBranch && activeBranch !== b.key }]"
              @click="toggleBranch(b.key)"
            >{{ b.label }} <span class="branch-n">{{ branchCount[b.key] }}</span></button>
          </div>

          <div class="family-grid">
            <div
              v-for="w in branchWords" :key="w.id"
              class="family-word card" :class="stateOf(w).cls"
              role="button" tabindex="0"
              @click="openWord(w)"
              @keydown.enter="openWord(w)"
            >
              <div class="fw-top">
                <span class="fw-word">{{ w.word }}</span>
                <span class="chip branch-chip" :class="stateOf(w).color" title="点标签放大该分支" @click.stop="toggleBranch(stateOf(w).cls)">{{ stateOf(w).label }}</span>
              </div>
              <div class="ipa fw-ipa">{{ w.ipa }}</div>
              <div class="fw-zh">{{ w.meaning.split(/[,，;；]/)[0] }}</div>
            </div>
          </div>
          <EmptyState
            v-if="!branchWords.length" compact icon="空"
            title="这个分支还没有单词"
            desc="这个家族里暂时没有属于该状态的词,点下面的按钮回去看全部单词"
          >
            <button class="btn small" @click="activeBranch = null">返回全部</button>
          </EmptyState>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
/* BlurText 接管「词根群星」入场:全局 terrRise 在本视图置空,避免双重动画 */
.terr-title { animation: none; }

.fam-back { margin-bottom: 14px; }
.stat-row { margin-bottom: 16px; }

/* ===== 家族星图头卡:点阵底纹 + mono kicker + 衬线词根(星图命名式) ===== */
.family-head { margin-bottom: 16px; background: linear-gradient(135deg, color-mix(in srgb, var(--accent) 7%, transparent), color-mix(in srgb, var(--accent-2) 7%, transparent)); }
.fam-kicker {
  font-family: var(--mono); font-size: var(--fs-2xs); font-weight: 600;
  letter-spacing: 0.3em; color: var(--accent); opacity: 0.85; margin-bottom: 10px;
}
.family-root {
  font-family: var(--serif);
  font-size: clamp(36px, 4vw, 46px); font-weight: 600; letter-spacing: 0.12em; line-height: 1.1;
  background: var(--grad-accent); -webkit-background-clip: text; background-clip: text;
  -webkit-text-fill-color: transparent; color: transparent;
}
.family-meaning { color: var(--text-2); font-size: var(--fs-base); margin-top: 4px; }
.fam-head-flex { display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 16px; }
.fam-head-actions { display: flex; gap: 8px; flex-wrap: wrap; }

/* 家族星墙:每词一颗四芒星,五态着色,一眼看到这族里还有几颗没亮 */
.fam-star-wall { display: flex; flex-wrap: wrap; gap: 7px; margin-top: 16px; padding-top: 14px; border-top: 1px dashed var(--line); }
.fam-star-wall .dm-star { transition: all 0.3s var(--ease); }
.fam-star-wall .dm-star.dm-new { background: var(--text-3); opacity: 0.35; }
.fam-star-wall .dm-star.dm-critical { background: var(--danger); opacity: 0.95; }
.fam-star-wall .dm-star.dm-due { background: var(--warn); opacity: 0.95; }
.fam-star-wall .dm-star.dm-learning { background: var(--accent); opacity: 0.95; }
.fam-star-wall .dm-star.dm-mastered { background: var(--gold); opacity: 1; filter: drop-shadow(0 0 4px color-mix(in srgb, var(--gold) 40%, transparent)); }
[data-theme='light'] .fam-star-wall .dm-star.dm-mastered { filter: none; }
.fam-star-wall .dm-star.dm-fading { background: var(--warn); opacity: 0.85; }

/* ===== 词根索引:搜索 + 星座卡 ===== */
.fam-search { position: relative; max-width: 460px; margin: 0 0 20px; }
.fam-search-input {
  width: 100%; padding: 10px 40px 10px 16px; border-radius: var(--r-md);
  background: var(--surface); border: 1px solid var(--line-strong);
  color: var(--text); font-family: inherit; font-size: var(--fs-sm);
  transition: all 0.2s var(--ease); outline: none;
}
.fam-search-input::placeholder { color: var(--text-4); }
.fam-search-input:focus { border-color: var(--line-accent); box-shadow: 0 0 0 3px var(--accent-soft); }
.fam-search-clear { position: absolute; right: 12px; top: 50%; transform: translateY(-50%); cursor: pointer; color: var(--text-3); font-size: var(--fs-xl); line-height: 1; padding: 2px 6px; border-radius: var(--r-xs); }
.fam-search-clear:hover { color: var(--text); background: var(--surface-hover); }

.root-card { cursor: pointer; text-align: left; transition: transform 0.22s var(--ease), border-color 0.22s var(--ease); }
.root-card:hover { transform: translateY(-4px); border-color: var(--line-accent); }
.root-title { font-family: var(--mono); font-size: var(--fs-xl); font-weight: 800; color: var(--accent); letter-spacing: 0.02em; }
.root-meaning { font-size: var(--fs-base); color: var(--text-2); margin-top: 4px; min-height: 22px; }
/* 星墙:悬停整族提亮——靠近一个星座,它的星都醒过来 */
.root-wall { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 12px; padding-top: 12px; border-top: 1px dashed var(--line); min-height: 28px; align-content: flex-start; }
.root-wall .dm-star { transition: transform 0.3s var(--ease), background 0.3s var(--ease), opacity 0.3s var(--ease); }
.root-wall .dm-star.sm { width: 9px; height: 9px; }
.root-wall .dm-star.dm-new { background: var(--text-3); opacity: 0.3; }
.root-wall .dm-star.dm-critical { background: var(--danger); opacity: 0.95; }
.root-wall .dm-star.dm-due { background: var(--warn); opacity: 0.95; }
.root-wall .dm-star.dm-learning { background: var(--accent); opacity: 0.9; }
.root-wall .dm-star.dm-mastered { background: var(--gold); opacity: 1; filter: drop-shadow(0 0 4px color-mix(in srgb, var(--gold) 40%, transparent)); }
[data-theme='light'] .root-wall .dm-star.dm-mastered { filter: none; }
.root-wall .dm-star.dm-fading { background: var(--warn); opacity: 0.85; }
.root-card:hover .root-wall .dm-star { transform: scale(1.15); }
.root-card-foot { display: flex; justify-content: space-between; align-items: center; margin-top: 12px; }

/* ===== 统计磁贴:数字 CountNum 从 0 滚上来 ===== */
.stat-tile .num { display: inline-flex; align-items: baseline; gap: 3px; }
.st-sep { font-style: normal; font-size: var(--fs-xl); font-weight: 600; color: var(--text-4); }

/* ===== 词源故事 ===== */
.story-card { margin-bottom: 16px; border-color: color-mix(in srgb, var(--warn) 22%, transparent); background: color-mix(in srgb, var(--warn) 4%, transparent); }
.story-text { line-height: 1.85; color: var(--text-2); }
/* 三段式:分段用细分隔,标签小而克制不抢戏(mono 刻字) */
.story-block { margin-top: 12px; padding-top: 12px; border-top: 1px dashed color-mix(in srgb, var(--warn) 25%, transparent) }
.story-tag { font-family: var(--mono); font-size: var(--fs-2xs); font-weight: 600; letter-spacing: 0.26em; color: var(--warn); margin-bottom: 8px; opacity: 0.9; }

/* ===== 同族分化:分叉图腾 =====
   左脊柱刻线 + 每根叉一根横刻线,语义是中文标签,词是按掌握度着色的星 */
.bm-tree {
  margin: 14px 0 4px; padding-left: 18px;
  border-left: 1px solid color-mix(in srgb, var(--warn) 32%, transparent);
  display: flex; flex-direction: column; gap: 8px;
}
.bm-node {
  position: relative;
  display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap;
  animation: unsealRise 0.45s var(--ease) calc(min(var(--i, 0), 12) * 70ms) backwards;
}
.bm-node::before {
  content: ''; position: absolute; left: -18px; top: 0.55em;
  width: 14px; height: 1px;
  background: color-mix(in srgb, var(--warn) 45%, transparent);
}
.bm-desc {
  font-size: var(--fs-xs); font-weight: 600; color: var(--warn);
  letter-spacing: 0.04em; flex-shrink: 0;
}
.bm-words { display: flex; gap: 6px; flex-wrap: wrap; }
.bm-word {
  font-family: inherit; cursor: pointer;
  display: inline-flex; align-items: baseline; gap: 6px;
  padding: 3px 10px; border-radius: 999px;
  background: var(--surface); border: 1px solid var(--line);
  transition: all 0.2s var(--ease);
}
.bm-word b { font-family: var(--mono); font-size: var(--fs-xs); font-weight: 700; color: var(--text); }
.bm-word i { font-style: normal; font-size: var(--fs-2xs); color: var(--text-3); }
.bm-word:hover { transform: translateY(-2px); border-color: color-mix(in srgb, var(--accent) 45%, transparent); }
/* 掌握度着色:与家族词卡同源 */
.bm-word.mastered { border-color: color-mix(in srgb, var(--success) 45%, transparent) }
.bm-word.mastered b { color: var(--success) }
.bm-word.learning b { color: var(--accent) }
.bm-word.due { border-color: color-mix(in srgb, var(--warn) 45%, transparent) }
.bm-word.due b { color: var(--warn) }
.bm-word.critical { border-color: color-mix(in srgb, var(--danger) 45%, transparent) }
.bm-word.critical b { color: var(--danger) }
.bm-word.new { opacity: 0.72 }
.bm-word.dim { cursor: default; }
.bm-word.dim b { color: var(--text-2) }
.bm-loose { margin-top: 10px; }

/* ===== 易混辨析:口诀铭牌 ===== */
.story-mnemonic {
  margin: 12px 0 0; padding: 12px 16px;
  border-left: 2px solid var(--warn);
  border-radius: 0 var(--r-md) var(--r-md) 0;
  background: color-mix(in srgb, var(--warn) 7%, transparent);
}
.story-mnemonic p { margin: 0; font-size: var(--fs-md); line-height: 1.8; color: var(--text); }
.mn-tag {
  display: inline-block; font-family: var(--mono); font-size: var(--fs-2xs); font-weight: 700;
  letter-spacing: 0.24em; color: var(--warn); margin-bottom: 4px;
}

/* ===== 家族词表 ===== */
.family-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 12px; }
/* 分支节点条:点一下放大该分支,再点返回全树 */
.branch-row { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 16px; }
.branch-btn {
  font-family: inherit; font-size: var(--fs-xs); padding: 5px 12px; border-radius: 999px; cursor: pointer;
  background: color-mix(in srgb, var(--info) 6%, transparent); border: 1px solid var(--line); color: var(--text-2);
  transition: all 0.22s var(--ease);
}
.branch-btn:hover { border-color: color-mix(in srgb, var(--accent) 45%, transparent); color: var(--text); }
.branch-btn.active { transform: translateY(-2px) scale(1.06); color: var(--text); }
.branch-btn.active.green { background: color-mix(in srgb, var(--success) 14%, transparent); border-color: color-mix(in srgb, var(--success) 50%, transparent); }
.branch-btn.active.cyan { background: color-mix(in srgb, var(--accent) 12%, transparent); border-color: color-mix(in srgb, var(--accent) 45%, transparent); }
.branch-btn.active.amber { background: color-mix(in srgb, var(--warn) 12%, transparent); border-color: color-mix(in srgb, var(--warn) 45%, transparent); }
.branch-btn.active.red { background: color-mix(in srgb, var(--danger) 13%, transparent); border-color: color-mix(in srgb, var(--danger) 50%, transparent); }
.branch-btn.active.dim { background: color-mix(in srgb, var(--text-3) 12%, transparent); border-color: color-mix(in srgb, var(--text-3) 40%, transparent); }
.branch-btn.faded { opacity: 0.4; }
.branch-n { font-size: var(--fs-2xs); opacity: 0.75; margin-left: 2px; }
.branch-chip { cursor: pointer; }
/* 词卡:左缘状态刻线,hover 立起,颜色跟五态(与信号行同一语言) */
.family-word { position: relative; cursor: pointer; padding: 12px 14px; transition: transform 0.18s var(--ease), border-color 0.18s var(--ease); overflow: hidden; }
.family-word::before {
  content: ''; position: absolute; left: 0; top: 10px; bottom: 10px; width: 2px;
  background: var(--accent); transform: scaleY(0); transform-origin: top;
  transition: transform 0.3s var(--ease), background 0.3s var(--ease);
}
.family-word:hover { transform: translateY(-3px); border-color: color-mix(in srgb, var(--accent) 45%, transparent); }
.family-word:hover::before { transform: scaleY(1); }
.family-word.mastered::before { background: var(--success); }
.family-word.due::before { background: var(--warn); }
.family-word.critical::before { background: var(--danger); }
.family-word:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.family-word.new { opacity: 0.7 }
.family-word.mastered { border-color: color-mix(in srgb, var(--success) 30%, transparent); }
.family-word.critical { border-color: color-mix(in srgb, var(--danger) 40%, transparent); animation: pulseRed 2s infinite; }
.fw-top { display: flex; justify-content: space-between; align-items: center; gap: 6px }
.fw-word { font-weight: 700; font-size: var(--fs-md) }
.fw-ipa { font-size: var(--fs-xs); margin: 4px 0 2px }
.fw-zh { font-size: var(--fs-xs); color: var(--text-3) }
@keyframes pulseRed {
  0%, 100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--danger) 0%, transparent); }
  50% { box-shadow: 0 0 0 4px color-mix(in srgb, var(--danger) 18%, transparent); }
}

@media (max-width: 768px) {
  .family-root { font-size: 34px; }
  .stat-tile .num { font-size: 34px; }
  .st-sep { font-size: var(--fs-lg); }
}
</style>
