<script setup>
// 英语日记:中文起笔 → AI 逐句译英 → 逐句带读(播放 + 跟读打分) → 保存历史
// 翻译走后端 /api/diary/translate(需 ANTHROPIC/GEMINI key,无 key 时后端给配置指引);
// 草稿自动存 localStorage,刷新不丢;历史存 backend diary_entries
import { ref, computed, watch, onMounted, onUnmounted, onActivated, onDeactivated } from 'vue'
import AppGlyph from '../components/AppGlyph.vue'
import { useUniverse } from '../stores/universe'
import { api } from '../api'
import { speak, stopSpeaking, recognizerSupported } from '../speech'
import { message } from '../ui'
import EmptyState from '../components/EmptyState.vue'
import DiarySentence from '../components/DiarySentence.vue'

const store = useUniverse()

// 词库 IPA 查表:跟读打分优先用词库音标,没收录的词走拼读兜底(同口语竞技场)
const ipaMap = computed(() => new Map(store.words.map((w) => [w.word, w.ipa])))
const ipaOf = (w) => ipaMap.value.get(w)
const recSupported = recognizerSupported()

// ---------- 写作区 ----------
const DRAFT_KEY = 'wv_diary_draft'
const zhText = ref('')
const translating = ref(false)
const translateErr = ref('')
const pairs = ref([])   // [{zh, en}] 逐句对照(AI 译文,可手改)

// 草稿自动保存(debounce 600ms),保存成功后清除
let draftTimer = null
watch(zhText, (v) => {
  clearTimeout(draftTimer)
  draftTimer = setTimeout(() => {
    try { v ? localStorage.setItem(DRAFT_KEY, v) : localStorage.removeItem(DRAFT_KEY) } catch {}
  }, 600)
})

// 中文切句:。!?;和换行(与保存/历史还原用同一套,保证句数可对齐)
function splitZh(text) {
  return String(text)
    .split(/(?<=[。!?!?;；])/) // eslint-disable-line no-useless-escape
    .flatMap((s) => s.split('\n'))
    .map((s) => s.trim())
    .filter(Boolean)
}

// 翻译:切句 → 后端 LLM 逐句对齐
async function translate() {
  const sentences = splitZh(zhText.value)
  if (!sentences.length) { message.warning('先写点中文再翻译'); return }
  translating.value = true
  translateErr.value = ''
  try {
    const r = await api.diaryTranslate(sentences)
    pairs.value = r.pairs
    if (!recSupported) message.info('当前浏览器不支持跟读识别,播放功能可用(Chrome/Edge 支持跟读)')
  } catch (e) {
    translateErr.value = e.message || '翻译失败,请稍后重试'
  } finally {
    translating.value = false
  }
}

// 手改译文(写作区:只改本地,保存时一并入库)
function onEditEn(i, en) {
  if (pairs.value[i]) pairs.value[i] = { ...pairs.value[i], en }
}

// ---------- 朗读 ----------
const rate = ref(1)
const RATES = [0.6, 0.8, 1]
const playingIdx = ref(-1)
let chainToken = 0 // 停止连读:token 失配后旧 onend 链自然断
function playOne(i) {
  ++chainToken
  playingIdx.value = i
  speak(pairs.value[i]?.en || '', { rate: rate.value, absolute: true, onend: () => {
    if (playingIdx.value === i) playingIdx.value = -1
  } })
}
function playAll() {
  const token = ++chainToken
  const step = (i) => {
    if (token !== chainToken || !alive) { playingIdx.value = -1; return }
    if (i >= pairs.value.length) { playingIdx.value = -1; return }
    playingIdx.value = i
    speak(pairs.value[i].en, { rate: rate.value, absolute: true, onend: () => step(i + 1) })
  }
  step(0)
}
function stopPlay() {
  ++chainToken
  stopSpeaking()
  playingIdx.value = -1
}

// ---------- 保存 ----------
const saving = ref(false)
async function save() {
  if (!pairs.value.length) { message.warning('先翻译出英文再保存'); return }
  saving.value = true
  try {
    const entry = await store.createDiary(zhText.value.trim(), pairs.value.map((p) => p.en).join('\n'))
    if (entry) {
      message.success('日记已保存,历史的任意一篇都能回来带读')
      zhText.value = ''
      pairs.value = []
      translateErr.value = ''
      try { localStorage.removeItem(DRAFT_KEY) } catch {}
    }
  } finally { saving.value = false }
}

// ---------- 历史 ----------
const expandedId = ref(null)
const deleteArm = ref(null) // 两步确认删除:第一次点击武装,第二次执行
function toggleExpand(id) {
  stopPlay()
  expandedId.value = expandedId.value === id ? null : id
  deleteArm.value = null
}
// 历史条目还原逐句:中文按同一规则切句,英文按 \n 还原(保存时逐句 join 的)
function histPairs(entry) {
  const zh = splitZh(entry.zh_text)
  const en = String(entry.en_text).split('\n')
  if (zh.length !== en.length) return [{ zh: entry.zh_text, en: entry.en_text.replace(/\n/g, ' ') }]
  return zh.map((z, i) => ({ zh: z, en: en[i] }))
}
const histPlaying = ref({ id: null, i: -1 })
let histToken = 0
function histPlayAll(entry) {
  const list = histPairs(entry)
  const token = ++histToken
  const step = (i) => {
    if (token !== histToken || !alive || i >= list.length) { histPlaying.value = { id: null, i: -1 }; return }
    histPlaying.value = { id: entry.id, i }
    speak(list[i].en, { rate: rate.value, absolute: true, onend: () => step(i + 1) })
  }
  step(0)
}
function histPlayOne(entry, i) {
  ++histToken
  histPlaying.value = { id: entry.id, i }
  speak(histPairs(entry)[i]?.en || '', { rate: rate.value, absolute: true, onend: () => {
    histPlaying.value = { id: null, i: -1 }
  } })
}
// 历史里改某句译文:重拼整篇 PATCH
async function histEditEn(entry, i, en) {
  const list = histPairs(entry)
  if (!list[i]) return
  list[i] = { ...list[i], en }
  const ok = await store.updateDiary(entry.id, list.map((p) => p.en).join('\n'))
  if (ok) message.success('译文已修正')
  else message.error('译文没改上(后端不可达)，稍后再试')
}
async function doDelete(id) {
  if (deleteArm.value !== id) { deleteArm.value = id; return }
  deleteArm.value = null
  if (expandedId.value === id) { stopPlay(); ++histToken; histPlaying.value = { id: null, i: -1 } }
  if (await store.removeDiary(id)) message.success('已删除')
}

function fmtDate(iso) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

let alive = true
onMounted(() => {
  try { zhText.value = localStorage.getItem(DRAFT_KEY) || '' } catch {}
})
// KeepAlive 首挂同样会触发 onActivated,历史列表只在这里拉(不再 onMounted+onActivated 双请求)
onActivated(() => { store.loadDiary() })
// KeepAlive 切走:朗读停掉,自动保存定时器清掉(草稿本身已随输入落 localStorage)
onDeactivated(() => { stopSpeaking(); clearTimeout(draftTimer) })
onUnmounted(() => {
  alive = false
  clearTimeout(draftTimer)
  stopSpeaking()
})
</script>

<template>
  <div class="view-scroll">
    <div class="view-inner fade-in">
      <div class="terr-head">
        <div class="terr-kicker">TERRITORY · DIARY</div>
        <h2 class="terr-title"><BlurText text="英语日记" as="span" /></h2>
        <div class="terr-latin">LOGBOOK</div>
        <div class="terr-rule" aria-hidden="true" />
        <p class="terr-sub">
          用中文写今天，一键翻成地道英文贴在下面——然后逐句跟读，把「今天做了什么」变成今天说过的话。
        </p>
      </div>
      <div class="ph-stats dy-stats">
        <span class="ph-stat"><b><CountNum :v="store.diary.length" mono /></b> 篇日记</span>
        <span class="ph-stat"><b><CountNum :v="pairs.length" mono /></b> 句待跟读</span>
      </div>

      <!-- 翻译失败:先说人话,部署细节折进折叠区,运维文案不直接怼脸 -->
      <div v-if="translateErr" class="warn-banner dy-key-banner">
        <b>这会儿翻不动：</b>{{ translateErr.includes('key') ? 'AI 翻译还没就绪，写好的中文草稿已自动保留，晚点再点一次就行。' : '网络或服务暂时不通，稍后再试一次。' }}
        <details v-if="translateErr.includes('key')" class="dy-key-details">
          <summary>自己部署的？看这里</summary>
          在 <code>backend-node/.env</code> 里填入 <code>ANTHROPIC_API_KEY</code> 或 <code>GEMINI_API_KEY</code>（参考 <code>.env.example</code>），重启后端即可启用 AI 翻译。
        </details>
      </div>

      <!-- ① 写作区 -->
      <div class="card dy-write-card dots-host">
        <span class="dots-decor dots-fade" aria-hidden="true" style="--dots-o:.18" />
        <div class="card-head">
          <div class="dy-card-title">
            <div class="dy-kicker">FIELD ENTRY</div>
            <div class="h-card">今天,用中文写</div>
          </div>
          <span class="text-3" style="font-size: var(--fs-xs)">草稿自动保存 · {{ zhText.length }} 字</span>
        </div>
        <textarea
          v-model="zhText"
          class="dy-textarea"
          rows="6"
          placeholder="今天天气很好,我去公园读了一本书……&#10;(想写多长都行,会按句子自动切开)"
        />
        <div class="dy-write-actions">
          <button class="btn primary" :disabled="translating || !zhText.trim()" @click="translate">
            {{ translating ? '翻译中…' : '翻译成英文' }}
          </button>
          <button v-if="pairs.length" class="btn" :disabled="saving" @click="save">
            {{ saving ? '保存中…' : '保存这篇日记' }}
          </button>
        </div>
      </div>

      <!-- ② 逐句对照 + 带读 -->
      <div v-if="pairs.length" class="card dy-pairs-card">
        <div class="card-head">
          <div class="dy-card-title">
            <div class="dy-kicker">READ ALOUD</div>
            <div class="h-card">逐句带读</div>
          </div>
          <div class="dy-rate-row">
            <span class="text-3" style="font-size: var(--fs-xs)">语速</span>
            <button
              v-for="r in RATES" :key="r"
              class="dy-rate" :class="{ active: rate === r }"
              @click="rate = r"
            >{{ r }}x</button>
          </div>
        </div>
        <p class="card-sub">每句先点「播放」听示范，再点「跟读」打分；红标词点一下单独重听。觉得 AI 译得不顺，点句尾的笔形钮直接改。</p>
        <div class="dy-pairs stagger">
          <DiarySentence
            v-for="(p, i) in pairs" :key="i"
            :zh="p.zh" :en="p.en" :rate="rate" :ipa-of="ipaOf"
            :playing="playingIdx === i"
            @play="playOne(i)" @save-en="(v) => onEditEn(i, v)"
          />
        </div>
        <div class="dy-pairs-foot">
          <button class="btn" @click="playAll"><AppGlyph name="play" :size="12" /> 整篇连读</button>
          <button class="btn ghost" @click="stopPlay">■ 停止</button>
        </div>
      </div>

      <!-- ③ 历史 -->
      <div class="card dy-hist-card">
        <div class="card-head">
          <div class="dy-card-title">
            <div class="dy-kicker">ARCHIVE</div>
            <div class="h-card">过往日记</div>
          </div>
          <span class="text-3" style="font-size: var(--fs-xs)">{{ store.diary.length ? '点开任意一篇,还能再带读' : '' }}</span>
        </div>
        <EmptyState
          v-if="!store.diary.length" compact icon="记"
          title="还没有存档的日记"
          desc="翻译满意后点「保存这篇日记」,以后随时回来重读带练"
        />
        <div v-else class="dy-hist-list">
          <div
            v-for="(entry, ei) in store.diary" :key="entry.id"
            class="dy-hist-item" :class="{ open: expandedId === entry.id, latest: ei === 0 }"
            :style="{ '--i': ei }"
          >
            <button class="dy-hist-head unstyled-btn" @click="toggleExpand(entry.id)">
              <span class="dy-hist-date text-mono">{{ fmtDate(entry.created_at) }}</span>
              <span class="dy-hist-preview">{{ entry.zh_text.slice(0, 60) }}{{ entry.zh_text.length > 60 ? '…' : '' }}</span>
              <!-- 折叠箭头改 CSS 山形箭头(▾/▸ 字符在部分字体里发虚);指向由 open 态接管 -->
              <span class="dy-hist-caret" aria-hidden="true" />
            </button>
            <template v-if="expandedId === entry.id">
              <div class="dy-hist-body">
                <div class="dy-hist-tools">
                  <button class="btn small" @click="histPlayAll(entry)"><AppGlyph name="play" :size="12" /> 整篇连读</button>
                  <button class="btn small ghost" @click="++histToken; stopSpeaking(); histPlaying = { id: null, i: -1 }">■ 停止</button>
                </div>
                <div class="dy-pairs stagger">
                  <DiarySentence
                    v-for="(p, i) in histPairs(entry)" :key="`${entry.id}-${i}`"
                    :zh="p.zh" :en="p.en" :rate="rate" :ipa-of="ipaOf"
                    :playing="histPlaying.id === entry.id && histPlaying.i === i"
                    @play="histPlayOne(entry, i)"
                    @save-en="(v) => histEditEn(entry, i, v)"
                  />
                </div>
              </div>
              <div class="dy-hist-foot">
                <button
                  class="btn small" :class="deleteArm === entry.id ? 'danger' : 'ghost'"
                  @click="doDelete(entry.id)"
                >{{ deleteArm === entry.id ? '再点一次确认删除' : '删除这篇' }}</button>
              </div>
            </template>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* BlurText 接管「英语日记」入场:全局 terrRise 在本视图置空,避免双重动画 */
.terr-title { animation: none; }

/* 页头统计读数(数字 CountNum 滚动):裸条套进「读数台」—— hairline + r-xl + accent 内衬微氛围,
   与语法城 machine-bench 同代语言(统计不再悬空,坐上自己的台面) */
.dy-stats {
  margin: -10px 0 24px; padding: 16px 20px 14px;
  border: 1px solid color-mix(in srgb, var(--accent) 14%, var(--line));
  border-radius: var(--r-xl);
  background:
    radial-gradient(440px 200px at 90% -60px, color-mix(in srgb, var(--accent) 5%, transparent), transparent 65%),
    var(--surface);
  animation: riseIn 0.5s var(--ease) both;
}
/* 台面小标走 ::before,不动模板结构;flex-basis 100% 让它独占首行 */
.dy-stats::before {
  content: 'LOGBOOK READOUT';
  flex-basis: 100%; margin-bottom: 10px;
  font-family: var(--mono); font-size: var(--fs-2xs); font-weight: 600;
  letter-spacing: 0.22em; color: var(--accent);
}
/* 读数 chip 坐在台面上沉一档(与 machine-bench 的 ph-stat 同处理) */
.dy-stats .ph-stat { background: var(--surface-sunken); }

/* 卡片头:mono 仪表 kicker + 原标题,和领地页头同一套命名语言 */
.dy-card-title { display: flex; flex-direction: column; gap: 6px; }
.dy-kicker {
  font-family: var(--mono); font-size: var(--fs-2xs); font-weight: 600;
  letter-spacing: 0.22em; color: var(--accent);
}

.dy-key-banner code {
  font-family: var(--mono); font-size: var(--fs-xs);
  background: color-mix(in srgb, var(--warn) 10%, transparent);
  padding: 1px 5px; border-radius: 5px;
}
/* 部署细节折叠:默认一行"自己部署的?看这里",展开才见运维文案 */
.dy-key-details { margin-top: 8px; font-size: var(--fs-xs); }
.dy-key-details summary {
  cursor: pointer; color: var(--text-3);
  width: fit-content; user-select: none;
}
.dy-key-details summary:hover { color: var(--text-2); }
.dy-key-details[open] summary { margin-bottom: 4px; color: var(--text-2); }
.dy-key-details code { font-size: var(--fs-2xs); }

/* 写作区:观测记录纸 —— 点阵日志页底纹 + 中文稿纸(焦点亮 accent 边,与全局输入焦点同一语言)
   三卡间距统一 24px,读数台与卡同一步距 */
.dy-write-card { position: relative; margin-bottom: 24px; }
.dy-textarea {
  position: relative;
  width: 100%; resize: vertical; min-height: 136px;
  padding: 16px 18px; border-radius: var(--r-md);
  background: var(--surface-sunken); border: 1px solid var(--line);
  color: var(--text); font-size: var(--fs-md); line-height: 1.9; font-family: inherit;
  outline: none;
  transition: border-color 0.25s var(--ease-out-3), box-shadow 0.25s var(--ease-out-3);
}
.dy-textarea:focus { border-color: var(--accent); box-shadow: 0 0 0 4px var(--accent-soft); }
.dy-write-actions { display: flex; gap: 10px; margin-top: 14px; flex-wrap: wrap; }

/* 逐句带读区:顶部右角 accent 微氛围(write 卡是点阵,这边用 radial,密度互补不打架) */
.dy-pairs-card {
  margin-bottom: 24px;
  background:
    radial-gradient(460px 210px at 88% -80px, color-mix(in srgb, var(--accent) 5%, transparent), transparent 65%),
    var(--surface);
}
.dy-rate-row { display: flex; align-items: center; gap: 6px; }
.dy-rate {
  padding: 4px 11px; border-radius: 999px; cursor: pointer;
  background: var(--surface); border: 1px solid var(--line);
  color: var(--text-2); font-size: var(--fs-xs); font-family: var(--mono); font-weight: 600;
  transition: color 0.18s var(--ease-out-3), border-color 0.18s var(--ease-out-3), background 0.18s var(--ease-out-3), box-shadow 0.18s var(--ease-out-3);
}
.dy-rate:hover { border-color: var(--line-accent); color: var(--text); }
.dy-rate.active {
  background: var(--accent-soft); border-color: var(--line-accent); color: var(--accent);
  box-shadow: inset 0 0 0 1px var(--line-accent);
}
.dy-pairs { display: flex; flex-direction: column; gap: 10px; }
.dy-pairs-foot { display: flex; gap: 12px; margin-top: 16px; }

/* 历史:观测档案条 —— 信号轨道的条目语言(mono 日期戳 + 进场级联 + 展开刻线)
   顶部左角 accent 微氛围,与带读卡的右角呼应 */
.dy-hist-card {
  margin-bottom: 24px;
  background:
    radial-gradient(460px 210px at 12% -80px, color-mix(in srgb, var(--accent) 5%, transparent), transparent 65%),
    var(--surface);
}
.dy-hist-list { display: flex; flex-direction: column; gap: 8px; }
.dy-hist-item {
  position: relative;
  border: 1px solid var(--line); border-radius: var(--r-md); overflow: hidden;
  background: var(--surface);
  animation: sigRise 0.5s var(--ease-out-4) backwards;
  animation-delay: calc(min(var(--i, 0), 8) * 45ms);
  transition: border-color 0.25s var(--ease-out-3), transform 0.25s var(--ease-out-3), box-shadow 0.25s var(--ease-out-3);
}
/* 档案条悬浮:轻抬 -2px + 小影,和全站「hover 升起」同一节拍 */
.dy-hist-item:hover { border-color: var(--line-strong); transform: translateY(-2px); box-shadow: var(--shadow-sm); }
.dy-hist-item.open { border-color: var(--line-accent); }
/* 展开项:左缘 accent 刻线立起(与信号轨道/车厢刻线同一语言) */
.dy-hist-item.open::before {
  content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 2px; z-index: 1;
  background: var(--accent);
  transform-origin: top; animation: unsealBar 0.4s var(--ease-out-3);
}
.dy-hist-head {
  display: flex; align-items: center; gap: 12px;
  padding: 12px 16px; width: 100%; text-align: left;
  transition: background 0.18s var(--ease-out-3);
}
.dy-hist-head:hover { background: var(--surface-hover); }
.dy-hist-date { color: var(--accent); font-size: var(--fs-xs); font-weight: 700; flex-shrink: 0; letter-spacing: 0.04em; }
.dy-hist-preview { color: var(--text-2); font-size: var(--fs-sm); flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* 折叠箭头:CSS 山形箭头 —— border-right+bottom 组成 ">"，-45° 指右、45° 指下,open 时旋转过渡自然翻转 */
.dy-hist-caret {
  width: 7px; height: 7px; flex-shrink: 0; margin: 0 2px;
  border-right: 1.5px solid var(--text-3); border-bottom: 1.5px solid var(--text-3);
  transform: rotate(-45deg);
  transition: transform 0.25s var(--ease-out-3), border-color 0.25s var(--ease-out-3);
}
.dy-hist-item.open .dy-hist-caret { transform: rotate(45deg); border-color: var(--accent); }
/* 最新一篇(列表首项,后端按 created_at 倒序):金点 + 金 mono 日期 —— 档案里最新一盏刚点亮 */
.dy-hist-item.latest .dy-hist-date { color: var(--gold); }
.dy-hist-item.latest .dy-hist-date::before {
  content: ''; display: inline-block; width: 5px; height: 5px; border-radius: 50%;
  background: var(--gold); margin-right: 7px; vertical-align: 2px;
  box-shadow: 0 0 8px color-mix(in srgb, var(--gold) 45%, transparent);
}
.dy-hist-body { padding: 8px 16px 16px; border-top: 1px solid var(--line); animation: unsealRise 0.35s var(--ease-out-3); }
.dy-hist-tools { display: flex; gap: 8px; margin: 10px 0; }
.dy-hist-foot { display: flex; justify-content: flex-end; padding: 0 16px 12px; }
</style>
