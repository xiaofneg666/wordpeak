<script setup>
// 书页:夜读舱分页阅读的单页内容渲染(章节题头/正文段/章末测/生词表/翻章都按"块"渲染)。
// 翻页动画的 front/back/under 三个面复用它,父视图的隐形测量层也用它来量每块高度做分页。
import { computed, nextTick, ref } from 'vue'
import { api } from '../api'
import { message } from '../ui'
import AppGlyph from './AppGlyph.vue'
import { useUniverse } from '../stores/universe'

const props = defineProps({
  page: { type: Object, default: null },          // { blocks: [{k:'title'|'para'|'quiz-head'|'q'|'verdict'|'vocab'|'turn', ...}] }
  questions: { type: Array, default: () => [] },
  showZh: { type: Boolean, default: true },
  activeSi: { type: Number, default: -1 },
  answered: { type: Object, default: () => ({}) },
  results: { type: Object, default: () => ({}) },
  submitted: { type: Object, default: null },
  sessionWords: { type: Array, default: () => [] },
  chapter: { type: Object, default: null },
  curNo: { type: Number, default: 1 },
  isFirst: { type: Boolean, default: true },
  isLast: { type: Boolean, default: false },
})
const emit = defineEmits(['word', 'anyword', 'sent', 'pick', 'galaxy', 'learn', 'chapter', 'shelf'])

const store = useUniverse()

// ---- 词库词命中管道(与阅读号同源:exact 优先,lemma 兜底) ----
function lemma(w) {
  return w.toLowerCase().replace(/[^a-z']/g, '').replace(/(ing|ed|ies|s|es|ly|er|est|ness|ment|tion|ous|ful|less)$/i, '')
}
const lemmaMap = computed(() => {
  const m = new Map()
  for (const w of store.words) m.set(lemma(w.word), w)
  return m
})
const exactMap = computed(() => {
  const m = new Map()
  for (const w of store.words) m.set(w.word.toLowerCase(), w)
  return m
})
function tokenize(sentence) {
  return sentence.split(/(\s+|[,.;:!?'"()—–])/g).filter(Boolean)
}
function wMatch(token) {
  if (!token || /^\s+$/.test(token) || /^[,.;:!?'"()—–-]$/.test(token)) return null
  const w = lemma(token)
  if (!w) return null
  return exactMap.value.get(w) || lemmaMap.value.get(w) || null
}
// 词库之外的英文词也能点:交给 AI 讲解卡(解释/记法/技巧/运用/语法)
function isAnyTok(token) {
  return /^[A-Za-z][A-Za-z'-]{1,}$/.test(token)
}
const learnedIds = computed(() => new Set(Object.keys(store.states).map(Number)))
const sessionIds = computed(() => new Set(props.sessionWords.map((w) => w.id)))
function isLearnedWord(id) { return learnedIds.value.has(id) || sessionIds.value.has(id) }

function optCls(qi, oi, q) {
  if (props.answered[qi] === undefined) return ''
  if (oi === q.answer) return 'correct'
  if (oi === props.answered[qi]) return 'wrong'
  return ''
}

// ---- 句法透镜:每段一颗「寻星镜」钮,点开展开 AI 讲解卡(缓存每段一次) ----
// 键统一用段的基句号 b.si(按钮与卡同键);api.explain 返回的就是字段对象,别再 .data
const lens = ref({}) // si -> { loading, data, error, open }
async function toggleLens(si, sent) {
  const cur = lens.value[si]
  if (cur?.data) {
    lens.value = { ...lens.value, [si]: { ...cur, open: !cur.open } }
    if (!cur.open) lensFollow(si)
    return
  }
  if (cur?.loading) return
  lens.value = { ...lens.value, [si]: { loading: true, open: true } }
  lensFollow(si)
  try {
    const r = await api.explain({ mode: 'sentence', sentence: sent.en, title: props.chapter?.title, userId: store.user?.id })
    lens.value = { ...lens.value, [si]: { data: r, open: true } }
    lensFollow(si) // 讲解就位卡片长高了,再贴一次可见
  } catch (e) {
    lens.value = { ...lens.value, [si]: { error: e?.message || '讲解暂不可用', open: true } }
    message.error('讲解请求失败,稍后再试')
  }
}
// 展开的透镜卡贴进可见:半页版心装不下「句+卡」,页内滚动时别让读者手动找
function lensFollow(si) {
  nextTick(() => document.querySelector(`.rb-lens-card[data-si="${si}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }))
}
function closeLens(si) { lens.value = { ...lens.value, [si]: { ...(lens.value[si] || {}), open: false } } }
</script>

<template>
  <div class="rb-page-inner">
    <template v-for="(b, bi) in page?.blocks || []" :key="bi">

      <!-- 章节题头 -->
      <div v-if="b.k === 'title'" class="rb-mb rb-title">
        <span class="rb-ch-kicker mono">CHAPTER {{ curNo }}</span>
        <h2 class="rb-ch-title">{{ chapter?.title }}</h2>
        <div class="rb-ch-rule" aria-hidden="true" />
      </div>

      <!-- 正文段(tail=段末整段距:译文隐藏时由段自己补上;显示时译块的 tail 已带) -->
      <div v-else-if="b.k === 'para'" class="rb-mb rb-para" :class="{ tail: b.tail && !showZh }">
        <p
          v-for="(s, i) in b.paras" :key="s.en"
          class="rb-sent" :class="{ open: activeSi === b.si + i }"
          @click="emit('sent', b.si + i)"
        >
          <span v-for="(tok, ti) in tokenize(s.en)" :key="ti" class="rb-tok">
            <span
              v-if="wMatch(tok)"
              class="rb-word" :class="{ known: isLearnedWord(wMatch(tok).id) }"
              @click.stop="emit('word', wMatch(tok), $event)"
            >{{ tok }}</span>
            <span
              v-else-if="isAnyTok(tok)"
              class="rb-word any" :title="`点开「${tok}」的讲解`"
              @click.stop="emit('anyword', tok, $event)"
            >{{ tok }}</span>
            <template v-else>{{ tok }}</template>
          </span>
          <button v-if="b.last" class="rb-lens unstyled-btn" :class="{ on: lens[b.si]?.data, busy: lens[b.si]?.loading }" title="句法透镜:点开 AI 讲解" @click.stop="toggleLens(b.si, { en: b.full })">
            <AppGlyph name="lens" :size="14" />
          </button>
        </p>
        <!-- 句法透镜:被点开时,逐段渲染四字段(载入中刻线 → 字段级联);只挂句尾子句 -->
        <div v-if="b.last && lens[b.si]?.open" class="rb-lens-card" :data-si="b.si" @click.stop>
          <button v-if="lens[b.si]?.data" class="rb-lens-close" aria-label="收起" @click="closeLens(b.si)">×</button>
          <div v-if="lens[b.si]?.loading" class="rb-lens-scan">
            <span class="mono">SCANNING</span>
            <span class="rb-lens-bar"><i /></span>
          </div>
          <div v-else-if="lens[b.si]?.error" class="rb-lens-error">{{ lens[b.si].error }}</div>
          <div v-else-if="lens[b.si]?.data" class="rb-lens-body cascade">
            <div class="rb-lens-row">
              <span class="rb-lens-tag mono">LENS · TRANSLATE</span>
              <span class="rb-lens-val">{{ lens[b.si].data.translate }}</span>
            </div>
            <div v-if="lens[b.si].data.grammar" class="rb-lens-row">
              <span class="rb-lens-tag mono">LENS · GRAMMAR</span>
              <span class="rb-lens-val">{{ lens[b.si].data.grammar }}</span>
            </div>
            <div v-if="lens[b.si].data.sense" class="rb-lens-row">
              <span class="rb-lens-tag mono">LENS · SENSE</span>
              <span class="rb-lens-val">{{ lens[b.si].data.sense }}</span>
            </div>
            <div v-if="lens[b.si].data.expression" class="rb-lens-row">
              <span class="rb-lens-tag mono">LENS · EXPRESSION</span>
              <span class="rb-lens-val">{{ lens[b.si].data.expression }}</span>
            </div>
            <div class="rb-lens-foot">
              <span class="mono">{{ lens[b.si].data.source === 'llm' ? 'AI · CLAUDE' : 'LOCAL · 本地查表' }}</span>
              <span>点卡上生词直达词卡</span>
            </div>
          </div>
        </div>
      </div>

      <!-- 段落译文:一段一翻译,整段中文作为独立块跟在段末句后(页界自然分开) -->
      <div v-else-if="b.k === 'zh' && showZh" class="rb-mb rb-zh-line" :class="{ tail: b.tail }">{{ b.text }}</div>

      <!-- 章末测题头 -->
      <div v-else-if="b.k === 'quiz-head'" class="rb-mb rb-quiz-head">
        <div class="rb-sec-head">
          <span class="mono rb-sec-kicker">COMPREHENSION</span>
          <h3>章末测 · 答完这本星的轨道亮一分</h3>
        </div>
      </div>

      <!-- 单道测题 -->
      <div v-else-if="b.k === 'q' && questions[b.qi]" class="rb-mb rb-q">
        <p class="rb-q-text">{{ b.qi + 1 }}. {{ questions[b.qi].q }}</p>
        <div class="rb-opts">
          <button
            v-for="(o, oi) in questions[b.qi].options" :key="oi"
            class="rb-opt unstyled-btn" :class="optCls(b.qi, oi, questions[b.qi])"
            @click="emit('pick', b.qi, oi)"
          ><span class="rb-opt-key mono" aria-hidden="true">{{ String.fromCharCode(65 + oi) }}</span><span class="rb-opt-text">{{ o }}</span></button>
        </div>
        <p v-if="answered[b.qi] !== undefined && questions[b.qi].explain" class="rb-explain">
          <b :class="results[b.qi] ? 'text-success' : 'text-warn'">{{ results[b.qi] ? '答对了' : '答错了' }}</b> · {{ questions[b.qi].explain }}
        </p>
      </div>

      <!-- 判分 -->
      <div v-else-if="b.k === 'verdict' && submitted" class="rb-mb rb-verdict">
        <b>{{ submitted.right }} / {{ submitted.total }}</b>
        <span>{{ submitted.right === submitted.total ? '全对,这章稳了' : '错题会进暗物质区等你重做' }}</span>
      </div>

      <!-- 生词表 -->
      <div v-else-if="b.k === 'vocab' && sessionWords.length" class="rb-mb rb-vocab">
        <div class="rb-sec-head">
          <span class="mono rb-sec-kicker">SESSION WORDS</span>
          <h3>这一章你收进宇宙的词</h3>
        </div>
        <div class="rb-vocab-list">
          <button
            v-for="w in sessionWords" :key="w.id"
            class="rb-vocab-chip unstyled-btn" @click="emit('galaxy', w)"
          >
            <b>{{ w.word }}</b>
            <span>{{ w.meaning }}</span>
          </button>
        </div>
        <p class="rb-vocab-note">点词直达词汇圣殿,看它属于哪个词根家族 →</p>
      </div>

      <!-- 翻章 -->
      <div v-else-if="b.k === 'turn'" class="rb-mb rb-turn">
        <button class="btn ghost" :disabled="isFirst" @click="emit('chapter', curNo - 1)">← 上一章</button>
        <span class="rb-turn-mid mono">
          {{ isFirst ? '书的开头' : isLast ? '最后一章' : 'CH ' + String(curNo).padStart(2, '0') }}
        </span>
        <button v-if="!isLast" class="btn primary" @click="emit('chapter', curNo + 1)">下一章 →</button>
        <button v-else class="btn" @click="emit('shelf')">读完了,回到书库 →</button>
      </div>
    </template>
  </div>
</template>

<style scoped>
/* 书页内边距:半页版心(与父视图测量层同宽同款,分页高度按此计算,勿单独改动) */
.rb-page-inner { padding: 22px 20px 14px; }

/* 块间距用 padding(计入 offsetHeight,分页计算才准;margin 会被测量漏掉) */
.rb-mb { padding-bottom: 20px; }
/* 段内句块间距:句子级分页跨页断段时,非段尾块只留 4px 气口,段尾留整段距 */
.rb-mb.rb-para { padding-bottom: 4px; }
.rb-mb.rb-para.tail { padding-bottom: 24px; }
.rb-mb.rb-q { padding-bottom: 18px; }
.rb-mb.rb-turn { padding-bottom: 0; padding-top: 14px; border-top: 1px solid var(--line); }

/* 章节题头 */
.rb-title { text-align: center; padding-bottom: 24px; }
.rb-ch-kicker { font-size: var(--fs-2xs); letter-spacing: 3px; color: var(--text-3); }
.rb-ch-title {
  font-family: var(--serif);
  font-size: clamp(22px, 3.4vw, 30px); font-weight: 600;
  margin: 10px 0 14px; letter-spacing: 0.04em;
}
.rb-ch-rule { height: 1px; width: 46px; margin: 0 auto; background: var(--accent); opacity: 0.7; }

/* 正文:「纸」的版心——58ch 行长居中,衬线 + 流式字号,行高 1.8 */
.rb-para { position: relative; max-width: 58ch; margin-inline: auto; }
.rb-sent {
  font-family: var(--serif);
  font-size: var(--font-size-fluid-1);
  line-height: 1.75; color: var(--text);
  /* 连排文本流:自然词距 + 两端对齐(书排版)。不用 flex space-between——
     单行短句会被拉开摊满整行,词距失控成散点 */
  text-align: justify;
  cursor: pointer; border-radius: 4px; padding: 2px 6px; margin: 0 -6px;
  transition: background 0.25s var(--ease-out-3);
}
/* 句与句之间留 4px 气口:悬停高亮块不相撞,长段也读得出句界 */
.rb-sent + .rb-sent { padding-top: 4px; }
.rb-sent:hover { background: color-mix(in srgb, var(--accent) 7%, transparent); }
.rb-sent.open { background: color-mix(in srgb, var(--accent) 9%, transparent); }
.rb-lens {
  display: inline-flex; align-items: center; justify-content: center;
  width: 24px; height: 24px; border-radius: 8px;
  margin-left: 8px; vertical-align: middle;
  color: var(--text-3); cursor: pointer; transition: all 0.2s var(--ease-out-3);
}
.rb-lens:hover, .rb-lens.on { color: var(--accent); background: var(--accent-soft); }
.rb-lens.busy { color: var(--accent); animation: lensSpin 1.4s linear infinite; }
@keyframes lensSpin { to { transform: rotate(360deg); } }
.rb-lens-card {
  position: relative; margin: 6px 0 12px; padding: 14px 16px 12px;
  background: color-mix(in srgb, var(--surface) 86%, transparent);
  border: 1px solid var(--line-accent); border-radius: 10px;
  backdrop-filter: blur(8px);
  box-shadow: 0 8px 18px -8px rgba(0, 0, 0, 0.4);
  animation: lensRise 0.3s var(--ease);
}
@keyframes lensRise { from { opacity: 0; transform: translateY(-4px) } to { opacity: 1; transform: none } }
.rb-lens-close {
  position: absolute; top: 6px; right: 8px; width: 22px; height: 22px;
  border-radius: 6px; color: var(--text-3); font-size: var(--fs-md); cursor: pointer;
}
.rb-lens-close:hover { color: var(--text); background: var(--surface-hover); }
.rb-lens-row { display: grid; grid-template-columns: 110px 1fr; gap: 10px; padding: 5px 0; border-bottom: 1px dashed var(--line); }
.rb-lens-row:last-of-type { border-bottom: 0; }
.rb-lens-tag { font-size: var(--fs-2xs); color: var(--accent); letter-spacing: 0.18em; align-self: start; padding-top: 2px; }
.rb-lens-val { font-size: var(--fs-sm); color: var(--text); line-height: 1.7; }
.rb-lens-foot { display: flex; justify-content: space-between; margin-top: 6px; font-size: var(--fs-2xs); color: var(--text-3); letter-spacing: 0.16em; }
.rb-lens-scan { display: flex; align-items: center; gap: 10px; font-size: var(--fs-2xs); color: var(--text-3); letter-spacing: 0.16em; }
.rb-lens-bar { flex: 1; height: 2px; background: var(--surface-sunken); border-radius: 1px; overflow: hidden; }
.rb-lens-bar i { display: block; height: 100%; background: var(--accent); width: 30%; animation: lensScan 1.4s ease-in-out infinite; }
@keyframes lensScan { 0% { transform: translateX(-100%) } 100% { transform: translateX(330%) } }
.rb-lens-error { font-size: var(--fs-xs); color: var(--warn); }
.rb-word {
  color: var(--text); border-bottom: 1.5px dashed color-mix(in srgb, var(--accent) 45%, transparent);
  cursor: pointer;
  transition: color 0.2s var(--ease-out-3), border-color 0.2s var(--ease-out-3);
}
.rb-word:hover { color: var(--accent); border-bottom-style: solid; }
.rb-word.known { color: var(--success); border-bottom-color: color-mix(in srgb, var(--success) 40%, transparent); }
/* 词库外的词:点线更淡(词库词是金色虚线),一眼分得出"已收录/任意点" */
.rb-word.any {
  border-bottom-style: dotted;
  border-bottom-color: color-mix(in srgb, var(--text-3) 38%, transparent);
}
.rb-word.any:hover { color: var(--text); border-bottom-color: var(--text-3); }
.rb-zh-line {
  font-family: var(--serif, 'Songti SC', 'SimSun', serif);
  font-size: var(--fs-base); color: var(--text-3); line-height: 1.7;
  margin: 8px 0 10px; padding-left: 16px;
  border-left: 2px solid color-mix(in srgb, var(--accent) 22%, transparent);
}
/* 段落译文块:与正文段同一套块间距(段内 4px 气口/段尾 24px),不用 .rb-mb 默认 20px */
.rb-mb.rb-zh-line { padding-bottom: 4px; }
.rb-mb.rb-zh-line.tail { padding-bottom: 24px; }

/* 章末区块 */
.rb-quiz-head, .rb-vocab { border-top: 1px solid var(--line); padding-top: 20px; }
.rb-sec-head { margin-bottom: 14px; }
.rb-sec-kicker { display: block; font-size: var(--fs-2xs); letter-spacing: 3px; color: var(--accent); }
.rb-sec-head h3 { font-size: var(--fs-lg); font-weight: 700; margin-top: 6px; }
.rb-q-text { font-size: var(--fs-md); line-height: 1.7; margin-bottom: 10px; }
.rb-opts { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 8px; }
.rb-opt {
  display: flex; align-items: center; gap: 10px; text-align: left;
  font-size: var(--fs-sm); padding: 10px 14px;
  border: 1px solid var(--line); border-radius: 10px; color: var(--text-2);
  transition: border-color 0.2s var(--ease-out-3), background 0.2s var(--ease-out-3), color 0.2s var(--ease-out-3);
}
/* 选项键:mono 字母小方牌,对/错时随整卡换色(彩色底上的字走 --on-* 令牌) */
.rb-opt-key {
  flex: none; width: 20px; height: 20px; border-radius: 6px;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: var(--fs-2xs); font-weight: 700; font-variant-numeric: tabular-nums;
  color: var(--text-3); background: var(--surface-sunken); border: 1px solid var(--line);
  transition: color 0.2s var(--ease-out-3), background 0.2s var(--ease-out-3), border-color 0.2s var(--ease-out-3);
}
.rb-opt-text { flex: 1; min-width: 0; }
.rb-opt:hover { border-color: var(--line-accent); color: var(--text); }
.rb-opt:hover .rb-opt-key { color: var(--accent); border-color: var(--line-accent); }
.rb-opt.correct { border-color: color-mix(in srgb, var(--success) 55%, transparent); color: var(--success); background: color-mix(in srgb, var(--success) 8%, transparent); }
.rb-opt.correct .rb-opt-key { color: var(--on-success); background: var(--success); border-color: var(--success); }
.rb-opt.wrong { border-color: color-mix(in srgb, var(--danger) 50%, transparent); color: var(--danger); background: color-mix(in srgb, var(--danger) 7%, transparent); }
.rb-opt.wrong .rb-opt-key { color: var(--on-danger); background: var(--danger); border-color: var(--danger); }
.rb-explain { font-size: var(--fs-xs); color: var(--text-3); line-height: 1.7; margin-top: 8px; }
.rb-verdict {
  display: flex; align-items: baseline; gap: 10px;
  font-size: var(--fs-sm); color: var(--text-2);
  padding: 12px 16px; border-radius: 12px;
  background: color-mix(in srgb, var(--accent) 7%, transparent);
  border: 1px solid var(--line-accent);
}
.rb-verdict b { font-size: var(--fs-lg); color: var(--accent); }

.rb-vocab-list { display: flex; flex-wrap: wrap; gap: 8px; }
.rb-vocab-chip {
  display: flex; flex-direction: column; align-items: flex-start; gap: 2px;
  padding: 8px 14px; border: 1px solid var(--line); border-radius: 10px;
  transition: border-color 0.25s var(--ease-out-3), transform 0.25s var(--ease-out-3);
}
.rb-vocab-chip:hover { border-color: var(--line-accent); transform: translateY(-2px); }
.rb-vocab-chip b { font-size: var(--fs-base); }
.rb-vocab-chip span { font-size: var(--fs-2xs); color: var(--text-3); }
.rb-vocab-note { font-size: var(--fs-2xs); color: var(--text-3); margin-top: 10px; }

.rb-turn { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.rb-turn-mid { font-size: var(--fs-2xs); letter-spacing: 2px; color: var(--text-3); }

@media (max-width: 640px) {
  .rb-page-inner { padding: 20px 18px 18px; }
  .rb-opts { grid-template-columns: 1fr; }
  .rb-turn { flex-wrap: wrap; justify-content: center; }
}
</style>
