<script setup>
import { computed, watch, nextTick, onMounted, onUnmounted, ref } from 'vue'
import AppGlyph from './AppGlyph.vue'
import { useUniverse } from '../stores/universe'
import { api } from '../api'
import { speak } from '../speech'
import { message } from '../ui'
import { formatWordText, wordPermalink } from '../utils/wordText.js'
import { parseRootStory } from '../utils/rootStory.js'
import CopyButton from './CopyButton.vue'
import LookupMenu from './LookupMenu.vue'
import CollectPopover from './CollectPopover.vue'

const store = useUniverse()
const w = computed(() => store.words.find((x) => x.id === store.selectedWordId))
const st = computed(() => (w.value ? store.states[w.value.id] : undefined))
const familyWords = computed(() =>
  w.value ? store.words.filter((x) => x.family === w.value.family && x.id !== w.value.id).slice(0, 8) : [])

const memoryTip = computed(() => {
  const tips = store.tips.filter((t) => t.category === '词汇记忆')
  if (!tips.length || !w.value) return null
  return tips[w.value.id % tips.length]
})

// 记法(词根故事三段式):与夜读舱词卡同一套素材——story 来源叙事 /
// branches 同族分化链(当前词点亮)/ confuse 口诀。有专属记法时,
// 上面的随机通用技巧让位(只在词根没故事的词上兜底)
const mnemo = computed(() => (w.value
  ? parseRootStory(store.rootStories[w.value.root], w.value.word)
  : null))
const hasMnemo = computed(() => !!(mnemo.value && (
  mnemo.value.story || mnemo.value.branches || mnemo.value.loose || mnemo.value.confuse)))

function stateLabel(s) {
  if (!s || s.is_new) return { cls: 'new', label: '还没学过', color: 'dim' }
  const r = s.retrievability ?? s.strength ?? 0 // 记忆概率(FSRS):现在还能想起来的把握
  if (s.due && r < 0.45) return { cls: 'critical', label: '快忘了', color: 'red' }
  if (s.due) return { cls: 'due', label: '该复习了', color: 'amber' }
  if (r > 0.75) return { cls: 'mastered', label: '掌握了', color: 'green' }
  return { cls: 'learning', label: '在学', color: 'cyan' }
}
function barCls(r) { return r > 0.75 ? 'green' : r > 0.45 ? '' : 'red' }

// 关闭(支持 ESC)
function close() { store.selectWord(null) }
function onKey(e) { if (e.key === 'Escape') close() }
onMounted(() => window.addEventListener('keydown', onKey))
onUnmounted(() => window.removeEventListener('keydown', onKey))

// 单词音节数(vowel count 近似,英文母音/3 元音等)
function syllableCount(w) {
  if (!w) return 0
  const s = w.toLowerCase().replace(/[^a-z]/g, '')
  if (!s) return 0
  return s.split(/[aeiouy]+/).filter(Boolean).length
}

const syllables = computed(() => syllableCount(w.value?.word))

function familyState(fw) {
  return stateLabel(store.states[fw.id])
}

// === 3D↔2D 联动:例句中出现的词库单词 → 高亮可点,点击聚焦对应星球 ===
const wordIndex = computed(() => new Map(store.words.map((x) => [String(x.word).toLowerCase(), x.id])))

// 按英文单词边界切分例句(保留标点/空格原样渲染)
function splitExample(en) {
  return String(en || '').split(/([a-zA-Z]+)/)
}

// 例句里的 token 是否是词库单词 → 返回其 id
function exampleWordId(tk) {
  if (!/^[a-zA-Z]+$/.test(tk)) return null
  return wordIndex.value.get(tk.toLowerCase()) ?? null
}

// 该词的例句里存在可联动词才显示提示条
const hasLinkedWords = computed(() => {
  if (!w.value?.examples?.length) return false
  return w.value.examples.some((e) => splitExample(e.en).some((tk) => exampleWordId(tk) != null))
})

// 点击例句高亮词 → 选中该词(引擎会飞行聚焦对应星球 + 聚焦脉冲发光)
function focusExampleWord(id) {
  store.selectWord(id)
}

// === 例句滚动 ↔ 3D 联动:面板滚到哪条例句,3D 里就点亮那句中的星球 ===
const panelEl = ref(null)
const activeEx = ref(-1)
let scrollRaf = 0

// 通知 3D 引擎(GalaxyCanvas 监听 → engine.setActiveExample)
function setActiveEx(i) {
  if (activeEx.value === i) return
  activeEx.value = i
  window.dispatchEvent(new CustomEvent('wv:exampleactive', { detail: { index: i } }))
}

// 例句翻译(展开式):点 ⤓ 调后端 /api/translate,本地降级时显示"含已知词"提示
const translations = ref({}) // exIdx -> { zh, source, note, loading }
async function translateExample(i, en) {
  if (!en || !en.trim()) return
  if (translations.value[i]) { delete translations.value[i]; translations.value = { ...translations.value }; return }
  translations.value = { ...translations.value, [i]: { loading: true } }
  try {
    const data = await api.translate(en, { known_words: store.words.slice(0, 200) })
    translations.value = { ...translations.value, [i]: data }
  } catch (e) {
    translations.value = { ...translations.value, [i]: { error: '翻译服务暂时不可用', source: 'error' } }
  }
}

// 滚动时找「离面板中心最近」的例句作为当前句(rAF 节流)
function onPanelScroll() {
  if (scrollRaf) return
  scrollRaf = requestAnimationFrame(() => {
    scrollRaf = 0
    const el = panelEl.value
    if (!el || !w.value?.examples?.length) return
    const items = el.querySelectorAll('.wp-example')
    const mid = el.scrollTop + el.clientHeight / 2
    let best = 0, bestDist = Infinity
    items.forEach((it, i) => {
      const d = Math.abs(it.offsetTop + it.offsetHeight / 2 - mid)
      if (d < bestDist) { bestDist = d; best = i }
    })
    setActiveEx(best)
  })
}

// 换词/面板滑出:回到顶部,第一条例句即为当前句(3D 同步点亮)
watch(() => w.value?.id, () => {
  activeEx.value = -1
  quizPicked.value = ''
  quizCorrect.value = false
  nextTick(() => {
    if (panelEl.value) panelEl.value.scrollTop = 0
    if (w.value?.examples?.length) setActiveEx(0)
  })
}, { immediate: true })

onUnmounted(() => cancelAnimationFrame(scrollRaf))

// === 星火问答:答对一次,这颗星当场烧亮一档(成绩走复习通道真实入库) ===
// 题型一(优先):例句掏空 + 同族词做干扰 —— 真正的辨析测试(inspect/respect/spectator)
// 题型二(兜底):释义匹配。选项按 word.id 确定性抽取,同一颗星每次问法一致
const quiz = computed(() => {
  const wd = w.value
  if (!wd) return null
  const fam = store.words.filter((x) => x.family === wd.family && x.id !== wd.id)
  const ex = (wd.examples || []).find((e) => e?.en && new RegExp(`\\b${wd.word}\\b`, 'i').test(e.en))
  const exDistract = ex && fam.length >= 3
  const pool = exDistract ? fam : store.words.filter((x) => x.id !== wd.id)
  const keyOf = (x) => (exDistract ? x.word : x.meaning)
  const opts = [keyOf(wd)]
  const used = new Set([wd.id])
  let seed = wd.id * 7 + 13
  while (opts.length < 4 && pool.length) {
    seed = (seed * 48271) % 2147483647
    const c = pool[seed % pool.length]
    const k = keyOf(c)
    if (!used.has(c.id) && k && !opts.includes(k)) { used.add(c.id); opts.push(k) }
  }
  const shuffled = opts
    .map((m, i) => ({ m, s: (((wd.id * 2654435761) ^ (i * 40503)) >>> 0) % 1000 }))
    .sort((a, b) => a.s - b.s)
    .map((o) => o.m)
  if (exDistract) {
    return {
      type: 'blank',
      q: ex.en.replace(new RegExp(`\\b${wd.word}\\b`, 'i'), '______'),
      zh: ex.zh,
      options: shuffled,
      answer: wd.word,
    }
  }
  return { type: 'meaning', q: `${wd.word} 是什么意思？`, options: shuffled, answer: wd.meaning }
})
const quizPicked = ref('')
const quizCorrect = ref(false)
const quizBusy = ref(false)
const quizStart = ref(0)
async function pickQuiz(opt) {
  if (quizPicked.value || quizBusy.value || !w.value) return
  quizBusy.value = true
  quizPicked.value = opt
  quizCorrect.value = opt === quiz.value?.answer
  const ms = Math.max(200, Math.round(performance.now() - quizStart.value))
  try { await store.api_submitReview(w.value.id, quizCorrect.value, ms) } catch { /* 离线时只算本地答感 */ }
  quizBusy.value = false
  if (quizCorrect.value) {
    window.dispatchEvent(new CustomEvent('wv:wordLit', { detail: { wordId: w.value.id } }))
  }
}
watch(() => quiz.value?.q, () => {
  quizPicked.value = ''
  quizCorrect.value = false
  quizStart.value = performance.now()
}, { immediate: true })
</script>

<template>
  <Transition name="slide">
    <aside v-if="w" ref="panelEl" class="word-panel" @click.stop @scroll.passive="onPanelScroll">
      <button class="wp-close" @click="close" title="关闭 (ESC)">✕</button>

      <!-- Hero:大字 + 音标 + 词性 -->
      <header class="wp-hero">
        <div class="wp-title-row">
          <h1 class="wp-word">{{ w.word }}</h1>
          <span class="wp-pos">{{ w.pos }}</span>
          <button class="wp-speak" @click="speak(w.word, { rate: 0.9 })" title="听发音">
            <svg class="spk" viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M11 5 6 9H3v6h3l5 4V5z"/><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M15.5 8.5a5 5 0 0 1 0 7"/><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M18.3 5.7a9 9 0 0 1 0 12.6"/></svg>
          </button>
        </div>
        <div class="wp-meta">
          <span class="ipa wp-ipa">{{ w.ipa }}</span>
          <span v-if="syllables" class="wp-syll" :title="`${syllables} 个音节`">
            <i v-for="n in syllables" :key="n" />
          </span>
          <!-- 复制 / 查询 / 分享 / 收藏(Phase 2+4) -->
          <span class="wp-tools">
            <CopyButton :text="formatWordText(w)" icon="copy" title="复制单词+音标+释义" />
            <LookupMenu :word="w.word" :ipa="w.ipa" />
            <CopyButton :text="wordPermalink(w.id)" icon="link" title="复制永久链接" />
            <CollectPopover :word-id="w.id" />
          </span>
        </div>
        <div class="wp-meaning">{{ w.meaning }}</div>
        <div v-if="st" class="wp-state-row">
          <span class="chip" :class="stateLabel(st).color">{{ stateLabel(st).label }}</span>
          <span v-if="!st.is_new" class="wp-strength" :title="'现在能想起这个词的概率——掉到 90% 以下的那天,它会被排进你的复习队列'">
            <span class="wp-strength-label">记忆概率</span>
            <span class="wp-strength-num">{{ Math.round((st.retrievability ?? st.strength ?? 0) * 100) }}%</span>
          </span>
        </div>
        <div v-if="st && !st.is_new" class="bar" :class="barCls(st.retrievability ?? st.strength ?? 0)" style="margin-top: 10px; height: 4px">
          <i :style="{ width: `${Math.max(4, (st.retrievability ?? st.strength ?? 0) * 100)}%` }" />
        </div>
      </header>

      <!-- 词根家族 -->
      <section v-if="familyWords.length" class="wp-section">
        <div class="wp-section-head">
          <span class="wp-section-title">{{ w.root }}- 家族的其他词</span>
          <button class="btn-small-link" @click="store.openFamily(w.root)">词根详情 →</button>
        </div>
        <div class="wp-family-grid">
          <span
            v-for="fw in familyWords" :key="fw.id"
            class="family-chip" :class="['state-' + familyState(fw).cls]"
            :title="fw.meaning"
            @click="store.selectWord(fw.id)"
          >
            {{ fw.word }}
          </span>
        </div>
      </section>

      <!-- 词源 -->
      <section class="wp-section">
        <div class="wp-section-title">词源</div>
        <div class="wp-root">{{ w.etymology }}</div>
      </section>

      <!-- 记法:词根家族三段式(来源叙事 / 同族分化链当前词点亮 / 口诀) -->
      <section v-if="hasMnemo" class="wp-section">
        <div class="wp-section-title">记法 · {{ w.root }}- 家族这样记</div>
        <div class="wp-mnemo">
          <p v-if="mnemo.story" class="wp-mnemo-story">{{ mnemo.story }}</p>
          <div v-if="mnemo.branches" class="wp-mnemo-branches">
            <div v-for="(row, ri) in mnemo.branches" :key="ri" class="wp-mn-row">
              <span class="wp-mn-desc">{{ row.desc }} →</span>
              <span
                v-for="wd in row.words" :key="wd.word"
                class="wp-mn-word" :class="{ cur: wd.current }"
                :title="wd.current ? '就是这个词 — 从词根推出来的' : `${wd.word} · ${wd.zh}`"
              >{{ wd.word }}<i>{{ wd.zh }}</i></span>
            </div>
          </div>
          <p v-else-if="mnemo.loose" class="wp-mnemo-story">{{ mnemo.loose.join('。') }}</p>
          <div v-if="mnemo.confuse?.mnemonic" class="wp-mnemo-tag">
            <span class="wp-mnemo-tag-cap mono">口诀</span>
            {{ mnemo.confuse.mnemonic }}
          </div>
          <p v-if="mnemo.confuse?.text" class="wp-mnemo-confuse">{{ mnemo.confuse.text }}</p>
        </div>
      </section>

      <!-- 星火问答:答对一次,这颗星当场亮一档(成绩真实入库) -->
      <section v-if="quiz && quiz.options.length >= 2" class="wp-section wp-quiz" :class="{ answered: quizPicked, 'ritual-lit': quizCorrect }">
        <div class="wp-section-title">
          星火问答
          <span class="wp-quiz-hint">答对一次，这颗星会亮一档</span>
        </div>
        <p class="wp-quiz-q">{{ quiz.q }}</p>
        <div v-if="quiz.type === 'blank' && quiz.zh" class="wp-quiz-zh">{{ quiz.zh }}</div>
        <div class="wp-quiz-opts">
          <button
            v-for="opt in quiz.options" :key="opt"
            class="wp-quiz-opt"
            :class="{ right: quizPicked && opt === quiz.answer, wrong: quizPicked === opt && opt !== quiz.answer }"
            :disabled="!!quizPicked || quizBusy"
            @click="pickQuiz(opt)"
          >{{ opt }}</button>
        </div>
        <div v-if="quizPicked" class="wp-quiz-result" :class="quizCorrect ? 'ok' : 'no'">
          <template v-if="quizCorrect"><AppGlyph name="spark" :size="13" /> 点亮 — 这颗星又亮了一档</template>
          <template v-else>还差一点，正确答案是 {{ quiz.answer }}　<button class="wp-quiz-review" @click="store.openReview()">去复习 →</button></template>
        </div>
      </section>

      <!-- 例句(高亮词可点击 → 3D 中聚焦对应星球) -->
      <section v-if="w.examples?.length" class="wp-section">
        <div class="wp-section-title">例句</div>
        <div v-if="hasLinkedWords" class="wp-ex-hint">点例句里发亮的词,画面会带你飞过去</div>
        <div v-for="(e, i) in w.examples" :key="i" class="wp-example" :class="{ 'ex-active': activeEx === i }">
          <div class="wp-example-en">
            <template v-for="(tk, ti) in splitExample(e.en)" :key="ti">
              <span
                v-if="exampleWordId(tk) != null"
                class="ex-word"
                title="点这个词,画面会飞过去"
                @click="focusExampleWord(exampleWordId(tk))"
              >{{ tk }}</span>
              <span v-else>{{ tk }}</span>
            </template>
          </div>
          <div class="wp-example-zh">{{ e.zh }}</div>
          <button class="wp-example-translate" :class="{ active: translations[i] }" :title="translations[i] ? '收起翻译' : '展开整句翻译'" @click="translateExample(i, e.en)">
            <svg v-if="!translations[i]" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 8h14M9 4v4M5 16h13M11 20v-4M3 12h6"/></svg>
            <svg v-else viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>
          </button>
          <button class="wp-example-play" @click="speak(e.en)" title="播放例句">
            <svg class="spk" viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path fill="currentColor" d="M11 5 6 9H3v6h3l5 4V5z"/><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M15.5 8.5a5 5 0 0 1 0 7"/></svg>
          </button>
          <div v-if="translations[i]?.loading" class="wp-ex-transl">翻译中…</div>
          <div v-else-if="translations[i]?.error" class="wp-ex-transl wp-ex-transl-err">{{ translations[i].error }}</div>
          <div v-else-if="translations[i] && translations[i].zh" class="wp-ex-transl fade-in">
            <span class="wp-ex-transl-tag">{{ translations[i].source === 'llm' ? 'AI' : '本地' }}</span>
            {{ translations[i].zh }}
          </div>
          <div v-else-if="translations[i] && !translations[i].zh" class="wp-ex-transl wp-ex-transl-dim">
            <span class="wp-ex-transl-tag">本地</span>
            {{ translations[i].note === 'no_keyword_model' ? '后端没有 AI 翻译 key — 在 .env 加 ANTHROPIC_API_KEY / GEMINI_API_KEY 即可启用整句翻译' : '无法翻译,请检查后端' }}
          </div>
        </div>
      </section>

      <!-- 搭配 -->
      <section v-if="w.collocations?.length" class="wp-section">
        <div class="wp-section-title">高频搭配</div>
        <div v-for="(c, i) in w.collocations" :key="i" class="wp-coll">
          <div class="wp-coll-en">{{ c.en }}</div>
          <div class="wp-coll-zh">{{ c.zh }}</div>
        </div>
      </section>

      <!-- 记忆技巧(技巧库穿插;词根有专属记法故事时让位) -->
      <div v-if="memoryTip && !hasMnemo" class="wp-tip">
        <div class="wp-tip-tag">记这个词的技巧</div>
        <div class="wp-tip-title">{{ memoryTip.title }}</div>
        <p class="wp-tip-content">{{ memoryTip.content }}</p>
        <button class="btn small ghost" @click="store.setView('tips')">更多技巧 →</button>
      </div>

      <!-- 行动 -->
      <div class="wp-actions">
        <button class="btn primary" @click="store.openReview()">开始复习</button>
        <button class="btn ghost" @click="store.openFamily(w.root)">看这个家族</button>
      </div>
    </aside>
  </Transition>
</template>

<style scoped>
/* 滑入动画 */
.slide-enter-active, .slide-leave-active { transition: transform 0.35s var(--ease), opacity 0.3s var(--ease); }
.slide-enter-from, .slide-leave-to { transform: translateX(20px); opacity: 0; }

/* Panel:玻璃 + 圆角 20 */
.word-panel {
  position: absolute; top: 80px; right: 16px;
  width: 380px; max-height: calc(100% - 96px); overflow-y: auto;
  z-index: 20; border-radius: 20px; padding: 24px;
  background: color-mix(in srgb, var(--surface) 82%, transparent);
  border: 1px solid var(--line-strong);
  box-shadow: var(--shadow-scene-lg), 0 0 0 1px rgba(255,255,255,0.04) inset;
  backdrop-filter: blur(32px) saturate(1.6);
  -webkit-backdrop-filter: blur(32px) saturate(1.6);
}
.wp-close {
  position: absolute; top: 14px; right: 14px; z-index: 2;
  width: 28px; height: 28px; border-radius: 8px;
  background: var(--surface); border: 1px solid var(--line);
  color: var(--text-2); font-size: var(--fs-xs); cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: all 0.2s var(--ease);
}
.wp-close:hover { background: var(--surface-hover); color: var(--text); }

/* Hero */
.wp-hero { margin-right: 28px; margin-bottom: 18px; }
.wp-title-row { display: flex; align-items: baseline; gap: 10px; margin-bottom: 4px; }
.wp-word {
  font-size: 40px; font-weight: 700; letter-spacing: -0.025em; line-height: 1;
  color: var(--text);
}
.wp-pos { font-size: var(--fs-xs); color: var(--warn); font-style: italic; font-weight: 500; }
.wp-speak {
  background: var(--surface); border: 1px solid var(--line);
  color: var(--text); width: 32px; height: 32px; border-radius: 8px;
  cursor: pointer; font-size: var(--fs-base);
  display: inline-flex; align-items: center; justify-content: center;
  transition: all 0.2s var(--ease);
}
.wp-speak:hover { background: var(--accent-soft); border-color: var(--line-accent); }
.spk { display: block; }
.wp-meta { display: flex; align-items: center; gap: 12px; margin-top: 8px; margin-bottom: 8px; }
.wp-ipa { font-size: var(--fs-base); }
.wp-syll { display: inline-flex; gap: 3px; }
.wp-syll i {
  width: 6px; height: 6px; border-radius: 50%; background: var(--accent);
  box-shadow: 0 0 6px var(--accent);
}
/* 复制/查询/分享工具栏(排在音标/音节同行右侧) */
.wp-tools { display: inline-flex; gap: 5px; margin-left: auto; align-items: center; }
.wp-meaning { font-size: var(--fs-md); color: var(--text); margin-top: 6px; }
.wp-state-row { display: flex; justify-content: space-between; align-items: center; margin-top: 10px; }
.wp-strength { display: flex; align-items: center; gap: 6px; font-size: var(--fs-xs); color: var(--text-3); }
.wp-strength-num { color: var(--text); font-weight: 600; font-variant-numeric: tabular-nums; }

/* Section */
.wp-section { margin-top: 20px; padding-top: 18px; border-top: 1px solid var(--line); }
.wp-section-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
.wp-section-title { font-size: var(--fs-xs); color: var(--text-3); letter-spacing: 0.08em; text-transform: uppercase; font-weight: 600; }
.btn-small-link {
  background: transparent; border: 0; color: var(--accent); font-size: var(--fs-xs); cursor: pointer;
  font-family: inherit; padding: 0; transition: opacity 0.2s;
}
.btn-small-link:hover { opacity: 0.7; }

/* 家族词 chip */
.wp-family-grid { display: flex; gap: 6px; flex-wrap: wrap; }
.family-chip {
  padding: 5px 11px; border-radius: 999px; font-size: var(--fs-sm); font-weight: 500;
  background: var(--surface); border: 1px solid var(--line);
  color: var(--text); cursor: pointer; transition: all 0.2s var(--ease);
}
/* hover 反馈统一到站点律:translateY(-2px) + 边框变 accent(与全站卡片一致) */
.family-chip:hover { transform: translateY(-2px); border-color: var(--line-accent); background: var(--surface-hover); }
.family-chip.state-mastered { border-color: color-mix(in srgb, var(--success) 40%, transparent); color: var(--success); }
.family-chip.state-critical { border-color: color-mix(in srgb, var(--danger) 50%, transparent); color: var(--danger); }
.family-chip.state-due { border-color: color-mix(in srgb, var(--warn) 45%, transparent); color: var(--warn); }
.family-chip.state-new { opacity: 0.55; }
.family-chip.state-learning { color: var(--accent); border-color: var(--line-accent); }

/* 词源 */
.wp-root {
  padding: 12px 14px; border-radius: 10px;
  background: var(--accent-soft);
  border: 1px solid var(--line-accent);
  font-size: var(--fs-sm); line-height: 1.7; color: var(--text-2);
}

/* === 记法:词根故事三段式(story / 分化链 / 口诀,与夜读舱词卡同款) === */
.wp-mnemo { display: flex; flex-direction: column; gap: 9px; }
.wp-mnemo-story { font-size: var(--fs-sm); line-height: 1.75; color: var(--text-2); margin: 0; }
.wp-mn-row { display: flex; flex-wrap: wrap; gap: 4px 8px; align-items: baseline; font-size: var(--fs-xs); }
.wp-mn-desc { color: var(--text-3); }
.wp-mn-word {
  padding: 2px 8px; border-radius: 6px; font-size: var(--fs-xs);
  background: var(--surface); border: 1px solid var(--line); color: var(--text-2);
  transition: all 0.2s var(--ease);
}
.wp-mn-word i { font-style: normal; font-size: var(--fs-2xs); color: var(--text-3); margin-left: 5px; }
/* 当前词:分化链里点谁谁亮 — 记住词根就带走整串的读法 */
.wp-mn-word.cur {
  border-color: var(--line-accent); color: var(--accent); background: var(--accent-soft);
  box-shadow: 0 0 12px color-mix(in srgb, var(--accent) 14%, transparent);
}
.wp-mn-word.cur::after { content: '✦'; margin-left: 6px; color: var(--accent); font-size: var(--fs-2xs); }
.wp-mn-word.cur i { color: var(--accent); opacity: 0.8; }
/* 口诀铭牌:小字帽 + 衬线居中(与夜读舱词卡同一拍) */
.wp-mnemo-tag {
  padding: 10px 14px 11px; text-align: center; border-radius: 8px;
  font-family: var(--serif);
  font-size: var(--fs-sm); letter-spacing: 0.04em; line-height: 1.7; color: var(--text);
  background: var(--accent-soft); border: 1px solid var(--line-accent);
  box-shadow:
    inset 0 0 0 3px color-mix(in srgb, var(--surface) 84%, transparent),
    inset 0 0 0 4px color-mix(in srgb, var(--accent) 22%, transparent);
}
.wp-mnemo-tag-cap {
  display: block; font-size: var(--fs-2xs); letter-spacing: 0.34em; text-indent: 0.34em;
  color: var(--accent); opacity: 0.8; margin-bottom: 4px;
}
.wp-mnemo-confuse { font-size: var(--fs-xs); line-height: 1.7; color: var(--text-3); margin: 0; }

/* === 星火问答 === */
.wp-quiz-hint {
  margin-left: auto; font-size: var(--fs-2xs); color: var(--text-3);
  font-weight: 400; text-transform: none; letter-spacing: 0.02em;
}
.wp-quiz { display: flex; flex-direction: column; gap: 10px; }
.wp-quiz .wp-section-title { display: flex; align-items: baseline; }
.wp-quiz-q {
  font-size: var(--fs-base); color: var(--text); line-height: 1.7; font-weight: 500;
  font-family: 'Georgia', 'Times New Roman', serif; font-style: italic;
}
.wp-quiz-zh { font-size: var(--fs-xs); color: var(--text-3); }
.wp-quiz-opts { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.wp-quiz-opt {
  padding: 9px 10px; border-radius: 10px; cursor: pointer; text-align: left;
  background: var(--surface); border: 1px solid var(--line);
  color: var(--text-2); font-size: var(--fs-sm); font-family: inherit; line-height: 1.5;
  transition: all 0.2s var(--ease);
}
.wp-quiz-opt:not(:disabled):hover {
  transform: translateY(-2px); border-color: var(--line-accent);
  background: var(--accent-soft); color: var(--text);
}
.wp-quiz.answered .wp-quiz-opt { cursor: default; opacity: 0.75; }
.wp-quiz-opt.right {
  opacity: 1; border-color: color-mix(in srgb, var(--success) 55%, transparent);
  background: color-mix(in srgb, var(--success) 10%, var(--surface)); color: var(--success);
}
.wp-quiz-opt.wrong {
  opacity: 1; border-color: color-mix(in srgb, var(--danger) 50%, transparent);
  background: color-mix(in srgb, var(--danger) 8%, var(--surface)); color: var(--danger);
}
.wp-quiz-result { font-size: var(--fs-xs); line-height: 1.6; }
.wp-quiz-result.ok { color: var(--accent); }
.wp-quiz-result.no { color: var(--text-3); }
.wp-quiz-review {
  background: none; border: 0; padding: 0; cursor: pointer;
  color: var(--accent); font-size: var(--fs-xs); font-family: inherit;
}
.wp-quiz-review:hover { opacity: 0.75; }

/* 例句 / 搭配 */
.wp-example {
  display: grid; grid-template-columns: 1fr; gap: 4px;
  padding: 10px 12px; border-radius: 10px;
  background: var(--surface-sunken); border: 1px solid var(--line);
  margin-bottom: 6px; position: relative;
  padding-right: 80px; /* 留给播放+翻译按钮 */
}
.wp-example-en { font-size: var(--fs-base); color: var(--text); }
.wp-example-zh { font-size: var(--fs-xs); color: var(--text-3); }
/* 当前句(面板滚到可视区中心):3D 里同步点亮该句中的星球 */
.wp-example.ex-active {
  border-color: var(--line-accent);
  background: var(--accent-soft);
  box-shadow: 0 0 14px color-mix(in srgb, var(--accent) 12%, transparent);
}
/* 例句联动高亮词(点击 → 3D 聚焦该词星球) */
.wp-ex-hint { font-size: var(--fs-2xs); color: var(--accent); opacity: 0.75; margin-bottom: 8px; }
.ex-word {
  color: var(--accent); font-weight: 600; cursor: pointer;
  border-bottom: 1px dashed var(--line-accent);
  padding: 0 1px; border-radius: 2px;
  transition: background 0.2s var(--ease), text-shadow 0.2s var(--ease);
}
.ex-word:hover {
  background: var(--accent-soft);
  /* 白底上发光收淡一档:纯 accent 的 text-shadow 在浅色页会糊成色块 */
  text-shadow: 0 0 12px color-mix(in srgb, var(--accent) 40%, transparent);
}
.wp-example-play {
  position: absolute; right: 10px; top: 14px; transform: none;
  width: 28px; height: 28px; border-radius: 8px; border: 1px solid var(--line);
  background: var(--surface); color: var(--text-2); cursor: pointer; font-size: var(--fs-xs);
  display: flex; align-items: center; justify-content: center;
  transition: all 0.2s;
}
.wp-example-play:hover { background: var(--accent-soft); color: var(--accent); }
/* 整句翻译按钮(放播放按钮左边,绝对收起中) */
.wp-example-translate {
  position: absolute; right: 42px; top: 14px;
  width: 28px; height: 28px; border-radius: 8px; border: 1px solid var(--line);
  background: var(--surface); color: var(--text-2); cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: all 0.2s;
}
.wp-example-translate:hover { background: var(--accent-soft); color: var(--accent); border-color: var(--line-accent); }
.wp-example-translate.active { background: var(--accent-soft); color: var(--accent); border-color: var(--line-accent); }
.wp-ex-transl {
  margin-top: 8px; padding: 8px 12px; border-radius: 8px;
  font-size: var(--fs-xs); color: var(--text); line-height: 1.7;
  background: var(--surface); border: 1px dashed var(--line-accent);
  grid-column: 1 / -1;
}
.wp-ex-transl-tag {
  display: inline-block; padding: 1px 7px; border-radius: 4px;
  background: var(--accent-soft); color: var(--accent);
  font-size: var(--fs-2xs); font-weight: 600; margin-right: 6px;
  vertical-align: 1px;
}
.wp-ex-transl-err { color: var(--danger); border-color: color-mix(in srgb, var(--danger) 30%, transparent); }
.wp-ex-transl-dim { color: var(--text-3); font-style: italic; }
.wp-coll {
  display: flex; flex-direction: column; gap: 2px;
  padding: 8px 12px; border-radius: 8px; background: var(--surface-sunken);
  border: 1px solid var(--line); margin-bottom: 4px;
}
.wp-coll-en { font-size: var(--fs-sm); }
.wp-coll-zh { font-size: var(--fs-xs); color: var(--text-3); }

/* 记忆技巧卡 */
.wp-tip {
  margin-top: 20px; padding: 16px; border-radius: 12px;
  background: linear-gradient(135deg, var(--accent-soft), transparent);
  border: 1px solid var(--line-accent);
}
.wp-tip-tag { font-size: var(--fs-2xs); color: var(--accent); letter-spacing: 0.08em; text-transform: uppercase; font-weight: 600; }
.wp-tip-title { font-size: var(--fs-md); font-weight: 600; margin: 6px 0 8px; color: var(--text); }
.wp-tip-content { font-size: var(--fs-sm); color: var(--text-2); line-height: 1.65; margin-bottom: 10px; }

.wp-actions { display: flex; gap: 8px; margin-top: 22px; }
.wp-actions .btn { flex: 1; justify-content: center; }

/* --- 响应式:窄屏近乎全屏,保证可读性(从全局 styles.css 收敛至此) --- */
@media (max-width: 600px) {
  .word-panel { right: 10px; left: 10px; width: auto; top: 70px; }
}
@media (max-width: 768px) {
  .word-panel {
    left: 10px; right: 10px; top: 10px; width: auto;
    max-height: calc(100% - 20px);
    padding: 20px 18px;
    z-index: 30;
  }
  .wp-actions { flex-wrap: wrap; }
  .wp-actions .btn { min-width: 44%; }
}
</style>
