<script setup>
// 记忆工坊:四种记忆方法各一节「原理 → 互动 → 我的数据」。
// 不只讲方法论,还用用户自己的学习数据现场演示(最易忘的词、你的遗忘曲线),
// 让「为什么这样安排你复习」变得可见、可讲。认知科学依据见 data/methods.json。
import { computed, onActivated, ref } from 'vue'
import AppGlyph from '../components/AppGlyph.vue'
import methodsData from '../data/methods.json'
import { api } from '../api.js'
import { speak } from '../speech.js'
import { useUniverse } from '../stores/universe'

const store = useUniverse()
const active = ref(methodsData[0].id)
// 四法的仪器小标:装配环(拆解)/四芒星(挂钩)/书页(语境)/轨道回环(对抗遗忘)
const LAB_GLYPHS = { morph: 'grammar', keyword: 'spark', context: 'reading', retrieval: 'review' }
const activeMethod = computed(() => methodsData.find((m) => m.id === active.value))

// 确定性伪随机(同参数同序列,不闪变)
function lcg(seed) {
  let s = seed % 2147483647
  if (s <= 0) s += 2147483646
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646 }
}
function shuffle(arr, seed) {
  const rnd = lcg(seed || 1)
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// 已学词(含记忆概率),按 R 升序 = 最易忘在前
const learnedWords = computed(() => {
  const out = []
  for (const [id, s] of Object.entries(store.states)) {
    if (s.is_new) continue
    const w = store.words.find((x) => x.id === Number(id))
    if (w) out.push({ w, r: s.retrievability ?? s.strength ?? 0 })
  }
  return out.sort((a, b) => a.r - b.r)
})

// ============ 方法一:词根拆解互动 ============
// 从词库挑「词根段拼起来恰好等于单词」的词,把词根段打乱,让用户按序点选拼装
const morphParsed = (word) => {
  const first = String(word.etymology || '').split('→')[0] || ''
  if (!first.includes('+')) return null
  const chips = first.split('+').map((s) => s.trim()).filter(Boolean).map((raw) => {
    const m = /^(.+?)\((.+)\)$/.exec(raw)
    return m ? { plain: m[1], gloss: m[2], raw } : { plain: raw, gloss: '', raw }
  })
  const joined = chips.map((c) => c.plain).join('')
  return joined === word.word ? chips : null // 拼不还原的(前后缀异形)不出题
}
const morphCandidates = computed(() => {
  const pool = []
  for (const w of store.words) {
    const chips = morphParsed(w)
    if (chips && w.word.length >= 5) pool.push({ w, chips })
  }
  return pool.slice(0, 40)
})
const morphIdx = ref(0)
const morphItem = computed(() => morphCandidates.value[morphIdx.value % Math.max(1, morphCandidates.value.length)] || null)
const morphChips = computed(() => (morphItem.value ? shuffle(morphItem.value.chips, morphItem.value.w.id) : []))
const morphPicked = ref([])
const morphDone = computed(() => {
  if (!morphItem.value) return null
  const assembled = morphPicked.value.map((c) => c.plain).join('')
  if (assembled === morphItem.value.w.word) return true
  if (morphPicked.value.length >= morphChips.value.length) return false
  return null // 还没拼完
})
function pickChip(c) {
  if (morphDone.value != null) return
  morphPicked.value.push(c)
}
function undoPick() { morphPicked.value.pop() }
function nextMorph() {
  morphIdx.value++
  morphPicked.value = []
}
// 我的数据:已学词的词根分布
const learnedRoots = computed(() => {
  const m = new Map()
  for (const { w } of learnedWords.value) m.set(w.root, (m.get(w.root) || 0) + 1)
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
})

// ============ 方法二:谐音图像互动(先遮后揭) ============
// 有 mnemonic 的词走真谐音(遮谐音与释义,先回忆);暂无则用释义回忆降级
const keywordPool = computed(() => {
  const withM = store.words.filter((w) => w.mnemonic)
  if (withM.length) return withM
  return learnedWords.value.map((x) => x.w).concat(store.words).slice(0, 12)
})
const kwIdx = ref(0)
const kwRevealed = ref(false)
const kwItem = computed(() => keywordPool.value[kwIdx.value % Math.max(1, keywordPool.value.length)] || null)
function nextKw() { kwIdx.value++; kwRevealed.value = false }
// 我的数据:最易忘的三颗星(R 最低已学词)
const riskyWords = computed(() => learnedWords.value.slice(0, 3))

// ============ 方法三:语境相遇统计 ============
// 一个词在全库例句/搭配/语料里的出现 = 你(将来)与它相遇的次数
const encounterWord = computed(() => learnedWords.value[0]?.w || store.words[0] || null)
const encounters = computed(() => {
  const w = encounterWord.value
  if (!w) return { count: 0, sentences: [] }
  const re = new RegExp(`\\b${w.word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\w{0,3}\\b`, 'i')
  const hits = []
  for (const other of store.words) {
    for (const ex of other.examples || []) {
      if (other.id !== w.id && re.test(ex.en)) hits.push(ex.en)
    }
    for (const c of other.collocations || []) {
      if (other.id !== w.id && re.test(c.en)) hits.push(c.en)
    }
  }
  for (const p of store.passages) {
    for (const s of p.sentences || []) {
      if (re.test(s.en)) hits.push(s.en)
    }
  }
  // 自身例句也算相遇
  for (const ex of w.examples || []) hits.unshift(ex.en)
  const uniq = [...new Set(hits)]
  return { count: uniq.length, sentences: uniq.slice(0, 5) }
})

// ============ 方法四:你的遗忘曲线 ============
// 调后端 /api/review/forecast 拿本人数据(前端只渲染不复算公式)
const curve = ref(null)
const curveErr = ref(false)
const curveWord = ref(null)
const loadingCurve = ref(false)
async function loadCurve() {
  if (!store.user || !learnedWords.value.length) return
  const target = learnedWords.value[0]
  curveWord.value = target.w
  loadingCurve.value = true
  curveErr.value = false
  try {
    curve.value = await api.reviewForecast(store.user.id, target.w.id, 60)
  } catch {
    curveErr.value = true
  }
  loadingCurve.value = false
}
// SVG 折线几何
const CW = 560, CH = 180, PAD = { l: 34, r: 14, t: 14, b: 22 }
const curvePath = computed(() => {
  const pts = curve.value?.points
  if (!pts?.length) return null
  const xs = (d) => PAD.l + (d / pts[pts.length - 1].day) * (CW - PAD.l - PAD.r)
  const ys = (r) => PAD.t + (1 - r) * (CH - PAD.t - PAD.b)
  return pts.map((p, i) => `${i ? 'L' : 'M'}${xs(p.day).toFixed(1)},${ys(p.retrievability).toFixed(1)}`).join(' ')
})
const curveThresholdY = computed(() => {
  const t = curve.value?.threshold ?? 0.9
  return PAD.t + (1 - t) * (CH - PAD.t - PAD.b)
})
const dueDay = computed(() => {
  const pts = curve.value?.points
  const t = curve.value?.threshold ?? 0.9
  if (!pts?.length) return null
  return pts.find((p) => p.retrievability < t)?.day ?? null
})

// 词库为空时区分「加载中」和「加载失败」:失败给重试,别停在永久「加载中…」
const wordsFailed = ref(false)
function loadWords() {
  wordsFailed.value = false
  store.loadUniverse()
    .then(() => { wordsFailed.value = false })
    .catch(() => { wordsFailed.value = true })
}
onActivated(() => {
  if (!store.words.length) loadWords()
  if (store.user && !store.plan) store.loadPlan()
})
</script>

<template>
  <div class="view-scroll">
    <div class="view-inner fade-in">
      <div class="terr-head">
        <div class="terr-kicker">TERRITORY · MNEMONIC FORGE</div>
        <h2 class="terr-title"><BlurText text="记忆工坊" as="span" /></h2>
        <div class="terr-latin">THE MNEMONIC FORGE</div>
        <div class="terr-rule" aria-hidden="true" />
        <p class="terr-sub">
          「记不住」很少是天赋问题,多数是方法问题。这里拆开四种被实验反复验证的记忆方法——并且用你自己的学习数据现场演示:你最该担心哪颗星,复习为什么排在那天。
        </p>
      </div>

      <!-- 四法导航 -->
      <div class="lab-tabs">
        <button
          v-for="m in methodsData" :key="m.id"
          class="lab-tab" :class="{ active: active === m.id }"
          @click="active = m.id; if (m.id === 'retrieval') loadCurve()"
        >
          <span class="lab-tab-glyph"><AppGlyph :name="LAB_GLYPHS[m.id] || 'spark'" :size="15" /></span>
          <span class="lab-tab-kicker">{{ m.kicker }}</span>
          <span class="lab-tab-title">{{ m.title }}</span>
        </button>
      </div>

      <section v-if="activeMethod" class="lab-method">
        <!-- 原理 -->
        <div class="lab-block">
          <div class="lab-block-kicker">原理</div>
          <p v-for="(p, i) in activeMethod.principle" :key="i" class="lab-p">{{ p }}</p>
          <p class="lab-science">{{ activeMethod.science }}</p>
        </div>

        <!-- 方法一 互动:拆词装配(点阵实验台,零件都摆在台面上) -->
        <div v-if="active === 'morph'" class="lab-block bench dots-host">
          <span class="dots-decor dots-fade" aria-hidden="true" style="--dots-o:.16" />
          <div class="lab-block-kicker">练一下 · 把词根零件装回原词</div>
          <template v-if="morphItem">
            <p class="lab-task">
              目标词义是「{{ morphItem.w.meaning }}」,词根 {{ morphItem.w.root }}- 意为「{{ morphItem.w.root_meaning }}」——按顺序点选零件,拼出这个词
            </p>
            <div class="lab-assembly">
              <span v-for="(c, i) in morphPicked" :key="`p${i}`" class="lab-chip picked">{{ c.raw }}</span>
              <span v-if="!morphPicked.length" class="lab-assembly-empty">点下面的零件开始装配</span>
            </div>
            <div class="lab-chip-row">
              <button
                v-for="(c, i) in morphChips" :key="`c${i}`"
                class="lab-chip" :class="{ used: morphPicked.includes(c) }"
                :disabled="morphPicked.includes(c)"
                @click="pickChip(c)"
              >{{ c.raw }}</button>
            </div>
            <div class="lab-ops">
              <button v-if="morphPicked.length" class="btn small ghost" @click="undoPick">撤回</button>
              <span v-if="morphDone === true" class="lab-verdict ok">装配正确——{{ morphItem.w.word }} = {{ morphItem.w.etymology }}</span>
              <span v-else-if="morphDone === false" class="lab-verdict no">顺序不对,撤回重拼(想想哪个零件是前缀)</span>
              <button v-if="morphDone != null" class="btn small" @click="nextMorph">下一题</button>
            </div>
          </template>
          <template v-else-if="wordsFailed">
            <p class="lab-p dim">词库拉不下来——网络或服务没连上。</p>
            <button class="btn small" @click="loadWords">重新加载词库 →</button>
          </template>
          <p v-else class="lab-p dim">词库加载中…</p>
        </div>

        <!-- 方法一 我的数据 -->
        <div v-if="active === 'morph' && learnedRoots.length" class="lab-block mine">
          <div class="lab-block-kicker">你的数据</div>
          <p class="lab-p">你已点亮的词里,词根分布是——认识一个根,同族词都是半个熟人:</p>
          <div class="lab-root-bars">
            <span v-for="([root, n], ri) in learnedRoots" :key="root" class="lab-root-bar" :style="{ '--i': ri }">
              <b>{{ root }}-</b>
              <i :style="{ width: `${Math.max(8, n / learnedRoots[0][1] * 100)}%` }" />
              <em>{{ n }}</em>
            </span>
          </div>
        </div>

        <!-- 方法二 互动:先遮后揭(点阵实验台) -->
        <div v-if="active === 'keyword'" class="lab-block bench dots-host">
          <span class="dots-decor dots-fade" aria-hidden="true" style="--dots-o:.16" />
          <div class="lab-block-kicker">练一下 · 先自己想,再揭答案</div>
          <template v-if="kwItem">
            <div class="lab-kw-word">
              <h3 class="lab-kw-head">{{ kwItem.word }}</h3>
              <span class="lab-kw-ipa">{{ kwItem.ipa }}</span>
              <button class="lab-speak-mini" @click="speak(kwItem.word)">读一遍</button>
            </div>
            <p v-if="!kwRevealed" class="lab-kw-cover">先别看答案——努力想它的意思和画面,想 5 秒再揭开(这一下的费力,正是记忆在加固)</p>
            <template v-else>
              <p class="lab-kw-meaning">{{ kwItem.meaning }}</p>
              <p v-if="kwItem.mnemonic" class="lab-kw-mnemonic">{{ kwItem.mnemonic }}</p>
              <p v-else class="lab-p dim">这个词还没有谐音钩子——记忆法的创作里,最难的就是为每个词找到那个自然的钩子</p>
            </template>
            <div class="lab-ops">
              <button v-if="!kwRevealed" class="btn small primary" @click="kwRevealed = true">揭晓</button>
              <button v-else class="btn small" @click="nextKw">换一个词</button>
            </div>
          </template>
        </div>
        <div v-if="active === 'keyword' && riskyWords.length" class="lab-block mine">
          <div class="lab-block-kicker">你的数据 · 最该挂上画面钩子的三颗星</div>
          <!-- 最该担心的三颗星 = 暗物质:挂上暗星,hover 补光预览(与暗物质区同一语言) -->
          <div class="lab-risky-row">
            <span v-for="x in riskyWords" :key="x.w.id" class="lab-risky dm-hover" @click="store.openWordInGalaxy(x.w.id)">
              <span class="dm-star sm" aria-hidden="true" />
              <span class="risky-text">
                <b>{{ x.w.word }}</b>
                <i>记忆 {{ Math.round(x.r * 100) }}%</i>
              </span>
            </span>
          </div>
          <p class="lab-p dim">记忆概率最低的已学词——给它们编个荒诞画面,是性价比最高的一次努力</p>
        </div>

        <!-- 方法三 互动:语境相遇(点阵实验台) -->
        <div v-if="active === 'context'" class="lab-block bench dots-host">
          <span class="dots-decor dots-fade" aria-hidden="true" style="--dots-o:.16" />
          <div class="lab-block-kicker">看看语境里它长什么样</div>
          <template v-if="encounterWord">
            <p class="lab-task">
              以「{{ encounterWord.word }}{{ learnedWords.length ? '(你最该担心的那颗星)' : '' }}」为例——它在整个词峰宇宙里有 <b class="lab-enc-num"><CountNum :v="encounters.count" mono /></b> 个语境相遇点:
            </p>
            <div class="lab-enc-list cascade">
              <p v-for="(s, i) in encounters.sentences" :key="i" class="lab-enc-sentence">{{ s }}</p>
            </div>
            <p class="lab-p dim">阅读号/回声谷/口语竞技场里遇见它,都算一次相遇——10 到 20 次之后,它才真正变成你的词。</p>
          </template>
        </div>

        <!-- 方法四 互动:你的遗忘曲线(点阵实验台) -->
        <div v-if="active === 'retrieval'" class="lab-block bench dots-host">
          <span class="dots-decor dots-fade" aria-hidden="true" style="--dots-o:.16" />
          <div class="lab-block-kicker">你的数据 · 记忆概率曲线</div>
          <template v-if="!store.user">
            <p class="lab-p dim">登录后这里会画出你自己的曲线。</p>
          </template>
          <template v-else-if="!learnedWords.length">
            <p class="lab-p">还没有已学词——先去学习舱点亮第一颗星,回来就能看到它的记忆概率怎么随时间衰减。</p>
            <button class="btn small primary" @click="store.openLearn()">进入学习舱</button>
          </template>
          <template v-else>
            <p class="lab-task">
              这是你最容易忘的词「{{ curveWord?.word || learnedWords[0].w.word }}」的记忆概率——曲线往下掉是正常的,遗忘不是失败,是记忆的默认状态;复习的意义是「在它掉到虚线之前接住它」。
            </p>
            <div v-if="loadingCurve" class="lab-p dim">正在调取你的复习档案…</div>
            <p v-else-if="curveErr" class="lab-p dim">曲线暂时拉取不到(后端不可达),稍后再试。</p>
            <svg v-else-if="curvePath" class="lab-curve" :viewBox="`0 0 ${CW} ${CH}`" role="img" aria-label="记忆概率衰减曲线">
              <!-- 75/50/25% 概率网格:曲率可读 -->
              <line
                v-for="gr in [0.75, 0.5, 0.25]" :key="gr" class="lab-c-grid"
                :x1="PAD.l" :x2="CW - PAD.r"
                :y1="PAD.t + (1 - gr) * (CH - PAD.t - PAD.b)" :y2="PAD.t + (1 - gr) * (CH - PAD.t - PAD.b)"
              />
              <!-- 90% 阈值线 -->
              <line class="lab-c-th" :x1="PAD.l" :y1="curveThresholdY" :x2="CW - PAD.r" :y2="curveThresholdY" />
              <text class="lab-c-th-label" :x="CW - PAD.r" :y="curveThresholdY - 4" text-anchor="end">{{ Math.round((curve.threshold ?? 0.9) * 100) }}% 复习线</text>
              <!-- R 曲线:pathLength=1 归一化,自左向右当面绘制 -->
              <path class="lab-c-line" :d="curvePath" pathLength="1" />
              <!-- 复习时机交点 -->
              <circle v-if="dueDay != null" class="lab-c-dot" :cx="PAD.l + (dueDay / 60) * (CW - PAD.l - PAD.r)" :cy="curveThresholdY" r="4" />
              <!-- 轴 -->
              <line class="lab-c-axis" :x1="PAD.l" :y1="CH - PAD.b" :x2="CW - PAD.r" :y2="CH - PAD.b" />
              <text class="lab-c-tick" :x="PAD.l" :y="CH - 6">今天</text>
              <text class="lab-c-tick" :x="CW - PAD.r" :y="CH - 6" text-anchor="end">60 天后</text>
            </svg>
            <p v-if="dueDay != null" class="lab-c-caption">
              曲线穿过虚线的那一天(约第 {{ dueDay }} 天)就是算法给你排的复习日——再晚,提取就太费力;再早,是浪费你的时间。
            </p>
            <p class="lab-p dim">这条线不是估计:FSRS 算法用你的每次作答更新曲线参数(稳定度/难度),它对每个词算的线都不一样。</p>
          </template>
        </div>

        <!-- 去练 -->
        <div class="lab-block lab-go">
          <button class="btn" @click="activeMethod.practice === 'learn' ? store.openLearn() : activeMethod.practice === 'family' ? store.backToFamilyIndex() : store.setView(activeMethod.practice)">
            去实践这一法{{ activeMethod.practice === 'family' ? ' · 词根群星' : activeMethod.practice === 'learn' ? ' · 学习舱' : '' }}
          </button>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
/* BlurText 接管「记忆工坊」入场:全局 terrRise 在本视图置空,避免双重动画 */
.terr-title { animation: none; }

/* 四法拨杆:mono 小标 + hover 抬半格 + active 左缘点亮(仪器开关) */
.lab-tabs { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 26px; }
.lab-tab {
  display: flex; flex-direction: column; gap: 3px; align-items: flex-start;
  padding: 12px 14px; background: var(--surface); border: 1px solid var(--line); border-radius: 12px;
  cursor: pointer; text-align: left;
  transition: border-color .18s var(--ease), background .18s var(--ease), transform .18s var(--ease), box-shadow .18s var(--ease);
}
.lab-tab:hover { border-color: var(--line-accent); transform: translateY(-1px); }
.lab-tab.active {
  border-color: var(--accent); background: color-mix(in srgb, var(--accent) 8%, var(--surface));
  box-shadow: inset 2px 0 0 var(--accent);
}
.lab-tab-glyph { color: var(--text-3); display: inline-flex; margin-bottom: 2px; }
.lab-tab.active .lab-tab-glyph, .lab-tab:hover .lab-tab-glyph { color: var(--accent); }
.lab-tab-kicker { font-family: var(--mono); font-size: var(--fs-2xs); letter-spacing: 0.2em; color: var(--text-3); }
.lab-tab.active .lab-tab-kicker { color: var(--accent); opacity: 0.85; }
.lab-tab-title { font-size: var(--fs-md); font-weight: 600; color: var(--text); }
@media (max-width: 768px) { .lab-tabs { grid-template-columns: repeat(2, 1fr); } }

.lab-method { max-width: 720px; }
.lab-block { margin-bottom: 26px; animation: terrRise 0.5s var(--ease) 0.08s backwards; }
.lab-block-kicker {
  font-family: var(--mono); font-size: var(--fs-2xs); letter-spacing: 0.24em;
  color: var(--text-3); margin-bottom: 12px;
  display: flex; align-items: center; gap: 8px;
}
.lab-block-kicker::after { content: ''; flex: 1; height: 1px; background: var(--line); }
/* 点阵实验台:互动区坐上台面,零件/读数自动抬到点阵之上;台上 kicker 点亮 */
.lab-block.bench {
  position: relative;
  border: 1px solid color-mix(in srgb, var(--accent) 14%, var(--line));
  border-radius: var(--r-lg);
  padding: 18px 22px 20px;
  background:
    radial-gradient(420px 240px at 94% -30%, color-mix(in srgb, var(--accent) 10%, transparent), transparent 65%),
    var(--surface);
}
.lab-block.bench .lab-block-kicker { color: var(--accent); opacity: 0.9; }
.lab-p { font-size: var(--fs-md); line-height: 1.95; color: var(--text-2); margin-bottom: 12px; }
.lab-p.dim { font-size: var(--fs-sm); color: var(--text-3); }
.lab-science {
  font-size: var(--fs-xs); color: var(--text-3); border-left: 2px solid var(--accent); padding-left: 14px; line-height: 1.8;
}
.lab-block.mine { border: 1px solid var(--line); border-radius: 14px; padding: 18px; background: var(--surface); }

.lab-task { font-size: var(--fs-base); color: var(--text-2); line-height: 1.9; margin-bottom: 14px; }
.lab-enc-num { font-size: var(--fs-xl); color: var(--accent); font-variant-numeric: tabular-nums; }

/* 装配轨道:沉底虚线槽,零件点进去落位 */
.lab-assembly {
  display: flex; align-items: center; gap: 8px; min-height: 44px; margin-bottom: 14px;
  padding: 8px 12px; border-radius: 8px;
  background: var(--surface-sunken); border: 1px dashed var(--line-strong);
}
.lab-assembly-empty { font-size: var(--fs-sm); color: var(--text-3); }
.lab-chip-row { display: flex; flex-wrap: wrap; gap: 8px; }
.lab-chip {
  font-family: var(--serif, Georgia, serif); font-size: var(--fs-md); color: var(--text);
  border: 1px solid var(--line); border-radius: 8px; padding: 6px 13px; background: var(--surface);
  cursor: pointer;
  transition: border-color .18s var(--ease), opacity .18s var(--ease), transform .18s var(--ease);
}
.lab-chip:hover:not(:disabled) { border-color: var(--accent); transform: translateY(-1px); }
.lab-chip.used { opacity: 0.35; cursor: default; }
.lab-chip.picked { border-color: var(--accent); color: var(--accent); animation: dotPop 0.4s var(--ease-snap); }
.lab-ops { display: flex; align-items: center; gap: 12px; margin-top: 14px; flex-wrap: wrap; }
.lab-verdict { font-size: var(--fs-sm); line-height: 1.7; }
.lab-verdict.ok { color: var(--success); }
.lab-verdict.no { color: var(--warn); }

/* 词根分布:逐条从零拉满(级联),最大一族点金——认识一个根,半个星区都是熟人 */
.lab-root-bars { display: flex; flex-direction: column; gap: 8px; }
.lab-root-bar { display: grid; grid-template-columns: 86px 1fr 30px; align-items: center; gap: 10px; }
.lab-root-bar b { font-size: var(--fs-base); color: var(--text); font-weight: 600; }
.lab-root-bar i {
  display: block; height: 8px; border-radius: 4px; background: var(--accent); opacity: 0.75;
  transform-origin: left;
  animation: labBarIn 0.6s var(--ease-out-3) calc(var(--i, 0) * 70ms) backwards;
}
.lab-root-bar em { font-style: normal; font-size: var(--fs-xs); color: var(--text-3); font-variant-numeric: tabular-nums; }
.lab-root-bar:first-child i { background: var(--gold); opacity: 0.9; }
@keyframes labBarIn { from { transform: scaleX(0); } }

.lab-kw-word { display: flex; align-items: baseline; gap: 12px; margin-bottom: 14px; flex-wrap: wrap; }
.lab-kw-head { font-family: var(--serif, Georgia, serif); font-size: 40px; font-weight: 600; color: var(--text); }
.lab-kw-ipa { font-size: var(--fs-base); color: var(--text-3); font-family: var(--mono, monospace); }
.lab-speak-mini {
  background: none; border: 1px solid var(--line); border-radius: 999px; color: var(--text-2);
  font-size: var(--fs-xs); padding: 4px 12px; cursor: pointer;
  transition: color .2s var(--ease), border-color .2s var(--ease), background .2s var(--ease);
}
.lab-speak-mini:hover { color: var(--accent); border-color: var(--accent); background: var(--accent-soft); }
.lab-kw-cover { font-size: var(--fs-base); color: var(--text-3); line-height: 1.8; }
/* 揭晓一刻:回忆从失焦里亮起来(fade-in-bloom),不是弹出 */
.lab-kw-meaning { font-size: var(--fs-lg); color: var(--text); animation: fade-in-bloom 0.7s var(--ease-3) both; }
.lab-kw-mnemonic {
  font-size: var(--fs-md); color: var(--text-2); line-height: 1.8;
  border-left: 2px solid var(--accent); padding-left: 14px; margin-top: 10px;
  animation: fade-in-bloom 0.7s var(--ease-3) 0.1s both;
}
/* 最该担心的三颗星:逐个浮现,hover 补光(dm-hover 点亮四芒暗星) */
.lab-risky-row { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 10px; }
.lab-risky {
  display: inline-flex; align-items: center; gap: 10px; cursor: pointer;
  border: 1px solid var(--line); border-radius: 10px; padding: 8px 14px;
  transition: border-color .18s var(--ease), transform .18s var(--ease);
  animation: riseIn 0.45s var(--ease) backwards;
}
.lab-risky:nth-child(1) { animation-delay: .05s }
.lab-risky:nth-child(2) { animation-delay: .12s }
.lab-risky:nth-child(3) { animation-delay: .19s }
.lab-risky:hover { border-color: var(--accent); transform: translateY(-1px); }
.risky-text { display: inline-flex; flex-direction: column; gap: 2px; }
.lab-risky b { font-size: var(--fs-md); color: var(--text); font-weight: 600; }
.lab-risky i { font-style: normal; font-size: var(--fs-2xs); color: var(--text-3); font-family: var(--mono, monospace); }

/* 语境相遇:沉底引文栏,一句一条 accent 细轨,逐条升起(cascade) */
.lab-enc-list {
  border: 1px solid var(--line); border-radius: 12px; padding: 14px 18px; margin-bottom: 12px;
  background: var(--surface-sunken);
}
.lab-enc-sentence {
  font-family: var(--serif);
  font-size: var(--fs-md); color: var(--text-2); line-height: 1.8;
  padding-left: 12px; border-left: 2px solid color-mix(in srgb, var(--accent) 25%, transparent);
}
.lab-enc-sentence + .lab-enc-sentence { margin-top: 8px; }

.lab-curve { width: 100%; height: auto; }
/* 概率网格:刻度感,不抢曲线 */
.lab-c-grid { stroke: var(--line); stroke-width: 1; stroke-dasharray: 2 4; }
/* R 曲线:pathLength=1 归一化后自左向右当面绘制(与终幕星座连线同语言) */
.lab-c-line {
  fill: none; stroke: var(--accent); stroke-width: 2.2; stroke-linecap: round;
  stroke-dasharray: 1; stroke-dashoffset: 1;
  animation: labDraw 1.1s var(--ease-out-3) 0.15s forwards;
}
@keyframes labDraw { to { stroke-dashoffset: 0; } }
.lab-c-th { stroke: var(--accent-3); stroke-width: 1.2; stroke-dasharray: 5 5; opacity: 0.8; animation: labFade 0.5s var(--ease) both; }
.lab-c-th-label { fill: var(--accent-3); font-size: var(--fs-2xs); font-family: var(--mono, monospace); animation: labFade 0.5s var(--ease) both; }
@keyframes labFade { from { opacity: 0; } }
/* 接住它的那天:全图唯一暖点(词之心塔尖灯色;晴空换暗琥珀),曲线画完再弹出 */
.lab-c-dot { fill: var(--gold); animation: dotPop 0.45s var(--ease-snap) 1.15s backwards; transform-box: fill-box; transform-origin: center; }
.lab-c-axis { stroke: var(--line); stroke-width: 1; animation: labFade 0.5s var(--ease) both; }
.lab-c-tick { fill: var(--text-3); font-size: var(--fs-2xs); font-family: var(--mono, monospace); animation: labFade 0.5s var(--ease) both; }
.lab-c-caption { font-size: var(--fs-sm); color: var(--text-2); line-height: 1.8; margin: 10px 0 8px; }

.lab-go { display: flex; justify-content: flex-start; }
</style>
