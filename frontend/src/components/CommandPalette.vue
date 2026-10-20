<script setup>
// 全局命令面板(Cmd/Ctrl+K)
// - 实时模糊搜索词库(全库词,带学习状态的权重)
// - 跳转动作:打开词卡(选词后自动定位星系+展开右侧词卡)、加入复习队列、加入收藏夹
// - 模块快速跳转(词汇圣殿/复习/收藏夹...)
// - 中文 + 英文 + IPA + 词根/释义多字段匹配
// - Esc 关闭;上下箭头 + Enter 选择;Cmd/Ctrl+K 切换
import { computed, ref, watch, nextTick, onMounted, onUnmounted } from 'vue'
import { useUniverse } from '../stores/universe'
import { api } from '../api'
import { speak } from '../speech'
import { message } from '../ui'
import CollectPopover from './CollectPopover.vue'
import AppGlyph from './AppGlyph.vue'

const store = useUniverse()
const emit = defineEmits(['close'])
const props = defineProps({ open: Boolean })

const query = ref('')
const selectedIdx = ref(0)
const inputEl = ref(null)
const listEl = ref(null)

const ACTIONS = [
  { key: 'go:learn',      icon: 'learn', label: '进入学习舱(学新词)', type: 'act', run: () => { store.setView('learn'); return true } },
  { key: 'go:lab',        icon: 'lab', label: '进入记忆工坊',       type: 'act', run: () => { store.setView('lab'); return true } },
  { key: 'go:network',    icon: 'network', label: '进入词汇网络',       type: 'act', run: () => { store.setView('network'); return true } },
  { key: 'go:galaxy',     icon: 'galaxy', label: '进入词汇圣殿',     type: 'act', run: () => { store.setView('galaxy'); return true } },
  { key: 'go:phonetics',  icon: 'phonetics', label: '进入发音舱',       type: 'act', run: () => { store.setView('phonetics'); return true } },
  { key: 'go:grammar',    icon: 'grammar', label: '进入语法机械城',   type: 'act', run: () => { store.setView('grammar'); return true } },
  { key: 'go:listening',  icon: 'listening', label: '进入回声谷',     type: 'act', run: () => { store.setView('listening'); return true } },
  { key: 'go:speaking',   icon: 'speaking', label: '进入口语竞技场',   type: 'act', run: () => { store.setView('speaking'); return true } },
  { key: 'go:reading',    icon: 'reading', label: '进入阅读号列车',   type: 'act', run: () => { store.setView('reading'); return true } },
  { key: 'go:writing',    icon: 'writing', label: '进入写作工坊',     type: 'act', run: () => { store.setView('writing'); return true } },
  { key: 'go:diary',      icon: 'diary', label: '进入英语日记',     type: 'act', run: () => { store.setView('diary'); return true } },
  { key: 'go:dashboard',  icon: 'dashboard', label: '进入观星台',     type: 'act', run: () => { store.setView('dashboard'); return true } },
  { key: 'go:family',     icon: 'family', label: '查看词根群星',     type: 'act', run: () => { store.backToFamilyIndex(); return true } },
  { key: 'go:collections',icon: 'collections', label: '打开收藏夹',       type: 'act', run: () => { store.setView('collections'); return true } },
  { key: 'go:lexicon',    icon: 'node', label: '查全量词库(3.6 万词)', type: 'act', run: () => { store.setView('lexicon'); return true } },
  { key: 'go:bookshelf',  icon: 'bookshelf', label: '进入轨道书库',     type: 'act', run: () => { store.setView('bookshelf'); return true } },
  { key: 'go:mistakes',   icon: 'mistakes', label: '进入暗物质区(错题本)', type: 'act', run: () => { store.setView('mistakes'); return true } },
  { key: 'go:tips',       icon: 'tips', label: '进入技巧库',       type: 'act', run: () => { store.setView('tips'); return true } },
  { key: 'go:review',     icon: 'review', label: '开始今日复习',     type: 'act', run: () => { store.openReview(); return true } },
  { key: 'go:challenge',  icon: 'challenge', label: '打开今日挑战',     type: 'act', run: () => { store.openChallenge(); return true } },
  { key: 'go:settings',   icon: 'settings', label: '进入设置',         type: 'act', run: () => { store.setView('settings'); return true } },
  { key: 'act:today-tip', icon: 'spark', label: '看今日一策',       type: 'act', run: () => {
    // 与 Dashboard「今日一策」同一来源:拉后端智能推荐,带着 tip id 直达技巧库
    if (!store.user) { message.info('请先登录'); return true }
    api.recommend(store.user.id)
      .then((r) => { if (r?.tip) store.openTipRecommend(r.tip); else message.info('今天还没生成推荐,去 Dashboard 看看') })
      .catch(() => message.info('推荐服务暂不可用,去 Dashboard 看看'))
    return true
  } },
]

// 候选条目(命令 + 词);列表总长度限制
const candidates = computed(() => {
  const q = query.value.trim().toLowerCase()
  const actResults = q
    ? ACTIONS.filter((a) => a.label.toLowerCase().includes(q) || a.key.includes(q)).slice(0, 5)
    : ACTIONS.slice(0, 5)
  if (!q || !store.words.length) return actResults
  // 词库搜索(限 30):字段打分 = word前缀命中*3 + word包含*2 + meaning包含*1 + root匹配*2
  // 加 sort 时优先把 is_new=false 的(学过/可复习)放前
  const wordResults = []
  for (const w of store.words) {
    const word = w.word.toLowerCase()
    let score = 0
    if (word.startsWith(q)) score += 3
    else if (word.includes(q)) score += 2
    if ((w.meaning || '').toLowerCase().includes(q)) score += 1
    if ((w.root || '').toLowerCase().includes(q)) score += 2
    if ((w.ipa || '').toLowerCase().includes(q)) score += 1
    if (!score) continue
    if (store.states[w.id] && !store.states[w.id].is_new) score += 0.5
    wordResults.push({ w, score })
  }
  wordResults.sort((a, b) => b.score - a.score)
  const words = wordResults.slice(0, 30).map((x) => ({
    key: 'w:' + x.w.id, icon: 'node', type: 'word',
    label: x.w.word, ipa: x.w.ipa, meaning: x.w.meaning, wordId: x.w.id,
    run: () => { store.openWordInGalaxy(x.w.id); return true },
    addReview: () => store.api_learnWord(x.w.id).then(() => message.success(`「${x.w.word}」已加入复习队列`)),
  }))
  return [...actResults, ...words]
})

watch(() => props.open, (v) => {
  if (v) {
    query.value = ''; selectedIdx.value = 0
    nextTick(() => inputEl.value?.focus())
  }
})

watch(candidates, () => { selectedIdx.value = 0 })

function pick(i) {
  const c = candidates.value[i]
  if (!c) return
  const ok = c.run?.()
  if (ok !== false) emit('close')
}

function addToReview(item) {
  if (item.type !== 'word' || !item.wordId) return
  item.addReview?.()
}

async function pickPlus(e, i) {
  e.stopPropagation()
  const c = candidates.value[i]
  if (c?.type === 'word') addToReview(c)
}

function speakWord(e, item) {
  e.stopPropagation()
  if (item?.label) speak(item.label)
}

// 滚动候选到选中区
watch(selectedIdx, () => {
  nextTick(() => {
    const el = listEl.value?.querySelector('.cmd-row.is-active')
    if (el) el.scrollIntoView({ block: 'nearest' })
  })
})

function onKey(e) {
  if (!props.open) return
  if (e.key === 'Escape') { emit('close'); return }
  if (e.key === 'ArrowDown') { selectedIdx.value = Math.min(selectedIdx.value + 1, candidates.value.length - 1); e.preventDefault() }
  else if (e.key === 'ArrowUp') { selectedIdx.value = Math.max(0, selectedIdx.value - 1); e.preventDefault() }
  else if (e.key === 'Enter') {
    const c = candidates.value[selectedIdx.value]
    if (c && c.type === 'word' && (e.metaKey || e.ctrlKey)) addToReview(c)
    else pick(selectedIdx.value)
    e.preventDefault()
  }
}

// 外部命令:Cmd/Ctrl+K 触发(无论 open 状态)+ 关闭(已 open 时再次按 K)
function globalKey(e) {
  const k = (e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')
  if (k) {
    e.preventDefault()
    props.open ? emit('close') : /* parent 监听 open prop + 同步 store.showCommand;在 App.vue 端控状态 */
    window.dispatchEvent(new CustomEvent('wv:toggleCommand'))
  }
}
onMounted(() => window.addEventListener('keydown', onKey))
onMounted(() => window.addEventListener('keydown', globalKey))
onUnmounted(() => window.removeEventListener('keydown', onKey))
onUnmounted(() => window.removeEventListener('keydown', globalKey))
</script>

<template>
  <Teleport to="body">
    <Transition name="cmd-fade">
      <div v-if="open" class="cmd-mask" @click.self="emit('close')">
        <div class="cmd-box" role="dialog" aria-label="快速搜索">
          <div class="cmd-input-row">
            <span class="cmd-prefix"><AppGlyph name="search" :size="15" /></span>
            <input
              ref="inputEl" v-model="query" class="cmd-input"
              placeholder="搜词 / 模块 / 动作…（例: port,发音舱,挑战）"
              autocomplete="off" spellcheck="false"
            />
            <kbd class="cmd-kbd">Esc</kbd>
          </div>
          <div ref="listEl" class="cmd-list">
            <div v-if="!candidates.length" class="cmd-empty">
              <span class="dm-star" aria-hidden="true" />
              没找到匹配 — 试试别的关键词
            </div>
            <template v-for="(c, i) in candidates" :key="c.key">
              <div
                class="cmd-row" :class="{ 'is-active': selectedIdx === i, 'cmd-row-word': c.type === 'word', 'cmd-row-act': c.type === 'act' }"
                @click="pick(i)" @mouseenter="selectedIdx = i"
              >
                <span class="cmd-icon"><AppGlyph v-if="c.type === 'act'" :name="c.icon" :size="15" /><template v-else>{{ c.icon === 'node' ? '' : c.icon }}</template></span>
                <div class="cmd-main">
                  <div class="cmd-label">
                    <span v-if="c.type === 'word'" class="cmd-word-en">{{ c.label }}</span>
                    <span v-else>{{ c.label }}</span>
                  </div>
                  <div v-if="c.type === 'word'" class="cmd-sub">
                    <span class="ipa">{{ c.ipa }}</span>
                    <span class="cmd-meaning">{{ c.meaning }}</span>
                  </div>
                </div>
                <div v-if="c.type === 'word'" class="cmd-row-actions">
                  <button class="cmd-act-btn" title="发音" @click="speakWord($event, c)"><AppGlyph name="sound" :size="13" /></button>
                  <button class="cmd-act-btn cmd-act-primary" title="加入复习队列" @click="pickPlus($event, i)">+ 复习</button>
                </div>
                <div v-else class="cmd-row-meta">
                  <kbd class="cmd-kbd">↵</kbd>
                </div>
              </div>
            </template>
          </div>
          <div class="cmd-foot">
            <span><kbd class="cmd-kbd">↑↓</kbd> 切换</span>
            <span><kbd class="cmd-kbd">↵</kbd> 打开</span>
            <span><kbd class="cmd-kbd">⌘/Ctrl</kbd>+<kbd class="cmd-kbd">↵</kbd> 词 → 直接加入复习</span>
            <span class="cmd-foot-spacer" />
            <span class="cmd-hint">{{ candidates.length }} 项</span>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.cmd-mask {
  position: fixed; inset: 0; z-index: 200;
  background: var(--scrim-strong);
  backdrop-filter: blur(10px) saturate(1.3);
  -webkit-backdrop-filter: blur(10px) saturate(1.3);
  display: flex; align-items: flex-start; justify-content: center; padding-top: 14vh;
}
.cmd-box {
  width: min(620px, 92vw); max-height: 64vh;
  background: color-mix(in srgb, var(--surface) 92%, transparent);
  border: 1px solid var(--line-strong);
  border-radius: 14px;
  box-shadow: var(--shadow-xl), inset 0 1px 0 color-mix(in srgb, var(--text) 4%, transparent);
  backdrop-filter: blur(24px) saturate(1.5);
  -webkit-backdrop-filter: blur(24px) saturate(1.5);
  display: flex; flex-direction: column; overflow: hidden;
  animation: cmdRise 0.26s var(--ease-out-4);
}
@keyframes cmdRise { from { transform: translateY(-14px) scale(0.985); opacity: 0; } to { transform: none; opacity: 1; } }
.cmd-input-row {
  display: flex; align-items: center; gap: 12px;
  padding: 14px 16px; border-bottom: 1px solid var(--line);
}
.cmd-prefix { color: var(--accent); font-size: var(--fs-lg); }
.cmd-input {
  flex: 1; padding: 6px 0; background: transparent; border: 0; outline: none;
  color: var(--text); font-size: var(--fs-md); font-family: inherit;
  caret-color: var(--accent);
}
.cmd-input::placeholder { color: var(--text-3); }
/* mono 快捷键帽:下缘一道压边,像真的键帽 */
.cmd-kbd {
  display: inline-block; padding: 2px 7px; border-radius: 6px;
  background: var(--surface-active); border: 1px solid var(--line);
  border-bottom-color: color-mix(in srgb, var(--text-3) 30%, transparent);
  color: var(--text-2); font-family: var(--mono); font-size: var(--fs-2xs); font-weight: 600;
  box-shadow: 0 1.5px 0 color-mix(in srgb, var(--text-3) 25%, transparent);
}
/* 列表滚动条:贴面板暗色面,细窄不抢戏(主题令牌驱动,四套主题自动跟随) */
.cmd-list {
  flex: 1; overflow-y: auto; padding: 6px 6px; min-height: 120px;
  scrollbar-width: thin;
  scrollbar-color: color-mix(in srgb, var(--text-3) 40%, transparent) transparent;
}
.cmd-list::-webkit-scrollbar { width: 8px; }
.cmd-list::-webkit-scrollbar-track { background: transparent; }
.cmd-list::-webkit-scrollbar-thumb {
  background: color-mix(in srgb, var(--text-3) 32%, transparent);
  border-radius: 4px;
}
.cmd-list::-webkit-scrollbar-thumb:hover { background: color-mix(in srgb, var(--text-3) 55%, transparent); }
.cmd-empty {
  display: flex; align-items: center; justify-content: center; gap: 9px;
  padding: 28px; color: var(--text-3); font-size: var(--fs-sm);
}
.cmd-row {
  position: relative;
  display: flex; align-items: center; gap: 10px;
  padding: 10px 12px; border-radius: 8px; cursor: pointer;
  transition: background 0.15s var(--ease-out-3);
}
/* 选中/hover:accent 沉底 + 左缘刻线(信号轨道同一语言) */
.cmd-row::before {
  content: ''; position: absolute; left: 4px; top: 9px; bottom: 9px; width: 2px;
  border-radius: 1px; background: var(--accent);
  transform: scaleY(0); transform-origin: center;
  transition: transform 0.18s var(--ease-out-3);
}
.cmd-row.is-active::before { transform: scaleY(1); }
.cmd-row.is-active {
  background: color-mix(in srgb, var(--accent) 15%, transparent);
  box-shadow: inset 0 0 0 1px var(--line-accent);
}
.cmd-row.is-active .cmd-icon { color: var(--accent); }
.cmd-row.is-active .cmd-kbd { color: var(--accent); border-color: var(--line-accent); }
.cmd-icon { width: 22px; text-align: center; color: var(--text-3); font-size: var(--fs-base); flex-shrink: 0; }
.cmd-main { flex: 1; min-width: 0; }
.cmd-label { font-size: var(--fs-base); color: var(--text); }
.cmd-word-en { font-weight: 600; }
.cmd-sub { margin-top: 3px; font-size: var(--fs-xs); color: var(--text-3); display: flex; gap: 8px; }
.cmd-sub .ipa { color: var(--accent); }
.cmd-row-actions { display: flex; gap: 4px; opacity: 0; transition: opacity 0.15s; }
.cmd-row.is-active .cmd-row-actions { opacity: 1; }
.cmd-act-btn {
  padding: 4px 9px; border-radius: 6px;
  background: var(--surface); border: 1px solid var(--line);
  color: var(--text-2); font-family: inherit; font-size: var(--fs-xs); cursor: pointer;
  transition: all 0.15s var(--ease);
}
.cmd-act-btn:hover { background: var(--surface-hover); color: var(--text); }
.cmd-act-btn.cmd-act-primary { background: var(--accent-soft); border-color: var(--line-accent); color: var(--accent); font-weight: 600; }
.cmd-row-meta { color: var(--text-3); font-size: var(--fs-2xs); }
.cmd-foot {
  display: flex; gap: 14px; flex-wrap: wrap; align-items: center;
  padding: 10px 14px; border-top: 1px solid var(--line);
  font-size: var(--fs-xs); color: var(--text-3);
}
.cmd-foot-spacer { flex: 1; }
.cmd-hint { font-family: var(--mono); font-size: var(--fs-2xs); }

.cmd-fade-enter-active, .cmd-fade-leave-active { transition: opacity 0.18s var(--ease-out-4); }
.cmd-fade-enter-from, .cmd-fade-leave-to { opacity: 0; }
</style>