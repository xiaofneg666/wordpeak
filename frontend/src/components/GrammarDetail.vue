<script setup>
import { ref, computed } from 'vue'
import { NModal } from 'naive-ui'
import { useUniverse } from '../stores/universe'
import { speak } from '../speech'
import MachineBelt from './MachineBelt.vue'
import GrammarAssembly from './GrammarAssembly.vue'
import CopyButton from './CopyButton.vue'
import LookupMenu from './LookupMenu.vue'
import CollectPopover from './CollectPopover.vue'
import { formatWordText, wordPermalink } from '../utils/wordText.js'

const props = defineProps({
  point: { type: Object, required: true },
  mastery: { type: Number, default: undefined },
})

// 例句里第一个可收藏的词(在 store.words 里命中的):找不到返回 0 → CollectPopover 自动忽略
function pickVocabId(en) {
  const tokens = (en || '').toLowerCase().split(/[^a-z']+/).filter(Boolean)
  for (const t of tokens) {
    const w = store.words.find((x) => String(x.word).toLowerCase() === t)
    if (w) return w.id
  }
  return 0
}
const emit = defineEmits(['close'])

const store = useUniverse()
const answers = ref({})
const results = ref({})
const busy = ref(false)
const show = ref(true)

function close() { show.value = false }

const allRight = computed(() =>
  Object.keys(results.value).length === props.point.quiz.length && Object.values(results.value).every(Boolean))
const running = computed(() => allRight.value)
const masteryChip = computed(() =>
  props.mastery > 0.8 ? 'green' : props.mastery > 0.4 ? 'amber' : 'red')
const masteryText = computed(() => {
  if (props.mastery === undefined) return ''
  const pct = Math.round(props.mastery * 100)
  if (pct >= 80) return `这个语法点你已经掌握了 ${pct}%`
  if (pct > 0) return `这个语法点你掌握了 ${pct}%`
  return '这个语法点你还没开始学'
})

async function pick(qi, oi) {
  if (answers.value[qi] !== undefined || busy.value) return
  busy.value = true
  const correct = oi === props.point.quiz[qi].answer
  answers.value = { ...answers.value, [qi]: oi }
  results.value = { ...results.value, [qi]: correct }
  try {
    await store.submitGrammarApi(props.point.id, qi, correct)
    store.refreshStats()
  } catch { /* 容忍离线 */ }
  busy.value = false
}

function optCls(qi, oi, q) {
  if (answers.value[qi] === undefined) return ''
  if (oi === q.answer) return oi === answers.value[qi] ? 'correct ritual-lit' : 'correct'
  if (oi === answers.value[qi]) return 'wrong'
  return ''
}

// 四步粘性导航:公式 → 讲解 → 装配 → 闯关(长弹窗里的车间导轨,点哪步飞哪步)
const STEPS = [
  { key: 'gd-sec-formula', label: '公式' },
  { key: 'gd-sec-explain', label: '讲解' },
  { key: 'gd-sec-assembly', label: '装配' },
  { key: 'gd-sec-quiz', label: '闯关' },
]
function jumpStep(id) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
</script>

<template>
  <n-modal
    :show="show" preset="card" :bordered="false" closable class="gd-modal"
    :content-style="{ maxHeight: '88vh', overflowY: 'auto', padding: '8px 32px 28px' }"
    @close="close" @after-leave="emit('close')"
  >
    <template #header>
      <div class="gd-head">
        <h2 class="gd-title">{{ point.title }}</h2>
        <div class="gd-chips">
          <span class="chip cyan">{{ point.category }}</span>
          <span v-if="mastery !== undefined" class="chip" :class="masteryChip">
            {{ masteryText }}
          </span>
        </div>
      </div>
    </template>

    <!-- 四步导轨(粘性):这台机器的四个工位 -->
    <nav class="gd-steps" aria-label="讲解步骤">
      <button v-for="s in STEPS" :key="s.key" class="gd-step" @click="jumpStep(s.key)">
        <i class="gd-step-tick" aria-hidden="true" />{{ s.label }}
      </button>
    </nav>

    <!-- 结构公式 — 工程图风 -->
    <section id="gd-sec-formula" class="gd-section">
      <div class="gd-label">结构公式</div>
      <div class="gd-formula">
        <span class="formula-bar" />
        <span class="formula-mono">{{ point.formula }}</span>
        <span class="formula-bar" />
      </div>
    </section>

    <!-- 机械装配演示(零件随语法类别换装) -->
    <section class="gd-section">
      <div class="gd-label">机械装配演示<span class="gd-label-sub">{{ running ? '全答对了,机器转起来了' : '先答题,机器才会转' }}</span></div>
      <MachineBelt :parts="point.machine?.parts || []" :running="running" :category="point.category" />
    </section>

    <!-- 规则讲解 -->
    <section id="gd-sec-explain" class="gd-section">
      <div class="gd-label">规则讲解</div>
      <p class="gd-explanation">{{ point.explanation }}</p>
    </section>

    <!-- 例句 -->
    <section v-if="point.examples?.length" class="gd-section">
      <div class="gd-label">例句</div>
      <div v-for="(e, i) in point.examples" :key="i" class="gd-example">
        <div style="flex: 1; min-width: 0">
          <div class="gd-example-en">{{ e.en }}</div>
          <div class="gd-example-zh">{{ e.zh }}</div>
        </div>
        <!-- 例句工具栏:复制整句 / 查词 / 收藏(关联词整句+整例共享) -->
        <div class="gd-example-tools">
          <CopyButton :text="`${e.en}\n${e.zh}`" icon="copy" title="复制整句" />
          <LookupMenu :word="e.en" :ipa="''" />
          <CollectPopover :word-id="pickVocabId(e.en)" />
        </div>
        <button class="gd-speak" @click="speak(e.en)" title="听例句" aria-label="读这句例句">
          <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
            <path d="M3 9v6h4l5 4V5L7 9H3z" fill="currentColor" />
            <path d="M16.5 8.5a5 5 0 0 1 0 7" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" />
          </svg>
        </button>
      </div>
    </section>

    <!-- 拖拽装配车间 -->
    <section id="gd-sec-assembly" class="gd-section">
      <div class="gd-label">动手装一遍 <span class="gd-label-sub">拖动零件到装配台,拼出正确的句子</span></div>
      <GrammarAssembly :point="point" />
    </section>

    <!-- 闯关 -->
    <section id="gd-sec-quiz" class="gd-section">
      <div class="gd-label">闯关答题 <span class="gd-label-sub">{{ Object.keys(answers).length }} / {{ point.quiz.length }}</span></div>
      <div v-for="(q, qi) in point.quiz" :key="qi" class="gd-quiz">
        <div class="gd-q-title">
          <span class="gd-q-num">{{ qi + 1 }}</span>
          <span>{{ q.question }}</span>
          <span v-if="answers[qi] !== undefined" class="gd-q-tag" :class="results[qi] ? 'ok' : 'no'">
            {{ results[qi] ? '答对了' : '答错了' }}
          </span>
        </div>
        <div class="gd-options">
          <button
            v-for="(o, oi) in q.options" :key="oi"
            class="gd-opt" :class="optCls(qi, oi, q)"
            :disabled="answers[qi] !== undefined" @click="pick(qi, oi)"
          >{{ o }}</button>
        </div>
        <div v-if="answers[qi] !== undefined" class="gd-feedback fade-in">
          <span v-if="results[qi]" class="ok">答对了。{{ q.explain }}</span>
          <span v-else class="no">答错了。{{ q.explain }}<span class="text-3">(这题记进了错题档案,连续答对后结案)</span></span>
          <div class="gd-feedback-tools">
            <CopyButton :text="formatWordText(q.word)" icon="copy" size="sm" title="复制单词" />
            <LookupMenu :word="q.word.word" :ipa="q.word.ipa" />
            <CollectPopover :word-id="q.word.id" />
            <CopyButton :text="wordPermalink(q.word.id)" icon="link" size="sm" title="复制链接" />
          </div>
        </div>
      </div>
    </section>
  </n-modal>
</template>

<style scoped>
/* 弹窗卡片样式(替代原内联 style 对象) */
:global(.gd-modal) {
  width: min(880px, 94vw) !important;
  background: var(--surface) !important;
  border: 1px solid var(--line-strong) !important;
  box-shadow: 0 24px 64px color-mix(in srgb, var(--bg) 50%, transparent) !important;
  border-radius: 20px !important;
}

.gd-head { display: flex; flex-direction: column; gap: 10px; padding: 4px 0; }
.gd-title { font-size: var(--fs-xl); font-weight: 700; letter-spacing: -0.015em; }
.gd-chips { display: flex; gap: 6px; }

/* 四步导轨:粘在弹窗内容顶端,滚动时一直在 */
.gd-steps {
  position: sticky; top: 0; z-index: 5;
  display: flex; gap: 6px; flex-wrap: wrap;
  padding: 10px 0; margin-top: 4px;
  background: color-mix(in srgb, var(--surface) 92%, transparent);
  backdrop-filter: blur(12px);
  border-bottom: 1px solid var(--line);
}
.gd-step {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 6px 14px; border-radius: 999px; cursor: pointer;
  background: var(--surface-sunken); border: 1px solid var(--line);
  color: var(--text-2); font-size: var(--fs-xs); font-weight: 500; font-family: inherit;
  transition: all 0.2s var(--ease);
}
.gd-step-tick {
  width: 7px; height: 7px; border-radius: 50%;
  background: var(--text-3); opacity: 0.5;
  transition: all 0.2s var(--ease);
}
.gd-step:hover { color: var(--text); border-color: var(--line-accent); }
.gd-step:hover .gd-step-tick { opacity: 0.9; background: var(--accent); }

.gd-section { margin-top: 24px; }
.gd-label {
  font-size: var(--fs-2xs); color: var(--text-3); letter-spacing: 0.08em;
  text-transform: uppercase; font-weight: 600;
  display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px;
}
.gd-label-sub { font-size: var(--fs-xs); color: var(--accent); font-weight: 500; }

/* 工程图风公式 */
.gd-formula {
  display: flex; align-items: center; gap: 12px;
  padding: 14px 18px; border-radius: 12px;
  background: var(--surface-sunken); border: 1px dashed var(--line-strong);
}
.gd-formula .formula-bar {
  flex: 1; height: 1px; background: linear-gradient(90deg, transparent, var(--line-strong), transparent);
}
.gd-formula .formula-mono {
  font-family: var(--mono); font-size: var(--fs-base); color: var(--text);
  letter-spacing: 0.5px; white-space: nowrap;
}

/* 讲解(学习正文:字号与行距优先,读起来不费眼) */
.gd-explanation { color: var(--text-2); line-height: 1.9; font-size: var(--fs-md); }

/* 例句 */
.gd-example { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 10px; background: var(--surface-sunken); border: 1px solid var(--line); margin-bottom: 6px; transition: all 0.2s var(--ease); }
.gd-example:hover { background: var(--surface); border-color: var(--line-strong); }
.gd-example-tools { display: inline-flex; gap: 4px; flex-shrink: 0; }
.gd-example-en { font-size: var(--fs-md); color: var(--text); line-height: 1.75; }
.gd-example-zh { font-size: var(--fs-xs); color: var(--text-3); margin-top: 2px; }
.gd-speak {
  width: 30px; height: 30px; border-radius: 8px;
  background: var(--surface); border: 1px solid var(--line);
  color: var(--text-2); cursor: pointer; font-size: var(--fs-xs);
  display: flex; align-items: center; justify-content: center;
  transition: all 0.2s;
}
.gd-speak:hover { background: var(--accent-soft); color: var(--accent); }

/* 答题 */
.gd-quiz { margin-bottom: 14px; padding: 16px; border-radius: 14px; background: var(--surface-sunken); border: 1px solid var(--line); }
.gd-q-title { display: flex; align-items: center; gap: 10px; font-size: var(--fs-base); margin-bottom: 10px; }
.gd-q-num {
  width: 24px; height: 24px; border-radius: 8px; display: flex; align-items: center; justify-content: center;
  font-family: var(--mono); font-size: var(--fs-xs); font-weight: 700; color: var(--accent);
  background: var(--accent-soft); border: 1px solid var(--line-accent);
}
.gd-q-tag { margin-left: auto; padding: 3px 10px; border-radius: 999px; font-size: var(--fs-xs); font-weight: 600; }
.gd-q-tag.ok { background: color-mix(in srgb, var(--success) 15%, transparent); color: var(--success); }
.gd-q-tag.no { background: color-mix(in srgb, var(--danger) 12%, transparent); color: var(--danger); }
.gd-options { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.gd-opt {
  padding: 12px 16px; border-radius: 10px; cursor: pointer;
  background: var(--surface); border: 1px solid var(--line);
  color: var(--text); font-family: inherit; font-size: var(--fs-sm); text-align: left;
  transition: all 0.2s var(--ease);
}
.gd-opt:hover:not(:disabled) { border-color: var(--line-accent); background: var(--surface-hover); transform: translateY(-1px); }
.gd-opt.correct { background: color-mix(in srgb, var(--success) 15%, transparent); border-color: var(--success); color: var(--success); }
.gd-opt.wrong { background: color-mix(in srgb, var(--danger) 12%, transparent); border-color: var(--danger); color: var(--danger); }
.gd-feedback { margin-top: 10px; font-size: var(--fs-sm); line-height: 1.6; }
.gd-feedback-tools { display: flex; gap: 5px; flex-wrap: wrap; margin-top: 8px; }
.gd-feedback .ok { color: var(--success); }
.gd-feedback .no { color: var(--danger); }
</style>
