<script setup>
// 全量词库:五源词表扩展词(family='general',3.6 万条),与 40 词根星系分开检索。
// 星系只保留精选词根词;这里承担"查得到"的职责,分页 + 中英文模糊搜索。
import { ref, computed, watch, onMounted } from 'vue'
import { api } from '../api'
import { speak } from '../speech'
import EmptyState from '../components/EmptyState.vue'
import CountNum from '../components/CountNum.vue'

const PAGE_SIZE = 20
const query = ref('')
const page = ref(1)
const total = ref(0)
const items = ref([])
const loading = ref(false)
const expanded = ref(null)
let timer = null

const pages = computed(() => Math.max(1, Math.ceil(total.value / PAGE_SIZE)))

async function load() {
  loading.value = true
  try {
    const r = await api.lexicon(query.value.trim(), page.value, PAGE_SIZE)
    total.value = r.total
    items.value = r.items
    expanded.value = null
  } catch {
    items.value = []
    total.value = 0
  } finally {
    loading.value = false
  }
}

watch(query, () => {
  clearTimeout(timer)
  timer = setTimeout(() => { page.value = 1; load() }, 250)
})

function go(p) {
  const next = Math.min(pages.value, Math.max(1, p))
  if (next === page.value) return
  page.value = next
  load()
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

function toggle(id) { expanded.value = expanded.value === id ? null : id }
function say(w) { try { speak(w) } catch { /* 浏览器不支持时静默 */ } }

onMounted(load)
</script>

<template>
  <div class="lexicon-page">
    <div class="terr-head">
      <div class="terr-kicker">TERRITORY · LEXICON</div>
      <h2 class="terr-title">全量词库</h2>
      <div class="terr-latin">FULL LEXICON</div>
      <div class="terr-rule" aria-hidden="true" />
      <p class="terr-sub">
        五个开源词表的全部单词，按字母分页。40 词根星系之外的词在这里查：释义、音标、真实例句与搭配。
      </p>
    </div>

    <div class="ph-stats" style="margin: -10px 0 20px">
      <span class="ph-stat"><b><CountNum :v="total" mono /></b> 条词条</span>
      <span class="ph-stat">第 <b>{{ page }}</b> / {{ pages }} 页</span>
    </div>

    <div class="lex-controls">
      <input
        v-model="query"
        class="lex-search"
        type="search"
        placeholder="搜索英文单词或中文释义…"
        autocomplete="off"
      />
      <span v-if="loading" class="lex-loading">检索中…</span>
      <span v-else-if="query.trim()" class="lex-loading">匹配 {{ total }} 条</span>
    </div>

    <EmptyState
      v-if="!loading && !items.length"
      icon="典" title="没有匹配的词"
      :desc="query.trim() ? `没有找到和「${query.trim()}」相关的词，换个关键词试试` : '词库暂时没有加载出来，稍后再试'"
    />

    <div v-else class="lex-list stagger">
      <article
        v-for="w in items" :key="w.id"
        class="card lex-card" :class="{ open: expanded === w.id }"
        @click="toggle(w.id)"
      >
        <div class="lex-main">
          <div class="lex-word-line">
            <span class="lex-word">{{ w.word }}</span>
            <button
              v-if="w.ipa" class="lex-speak" :title="`朗读 ${w.word}`"
              @click.stop="say(w.word)"
            >▶</button>
            <span v-if="w.ipa" class="lex-ipa">{{ w.ipa }}</span>
            <span class="chip cyan">{{ w.pos || 'n.' }}</span>
            <span class="lex-level">L{{ w.level }}</span>
          </div>
          <p class="lex-meaning">{{ w.meaning }}</p>
          <div v-if="expanded === w.id" class="lex-detail">
            <div v-if="w.collocations?.length" class="lex-block">
              <div class="lex-block-title">搭配</div>
              <div v-for="c in w.collocations" :key="c.en" class="lex-pair">
                <span class="lex-en">{{ c.en }}</span>
                <span class="lex-zh">{{ c.zh }}</span>
              </div>
            </div>
            <div v-if="w.examples?.length" class="lex-block">
              <div class="lex-block-title">例句</div>
              <div v-for="e in w.examples" :key="e.en" class="lex-pair">
                <span class="lex-en">{{ e.en }}</span>
                <span class="lex-zh">{{ e.zh }}</span>
              </div>
            </div>
            <div v-if="!w.collocations?.length && !w.examples?.length" class="lex-none">
              这个词条暂时没有真实例句/搭配，先记住读音和释义。
            </div>
          </div>
        </div>
        <span class="lex-toggle" aria-hidden="true">{{ expanded === w.id ? '−' : '+' }}</span>
      </article>
    </div>

    <div v-if="pages > 1" class="lex-pager">
      <button class="btn ghost small" :disabled="page <= 1 || loading" @click="go(page - 1)">上一页</button>
      <span class="lex-page-num">{{ page }} / {{ pages }}</span>
      <button class="btn ghost small" :disabled="page >= pages || loading" @click="go(page + 1)">下一页</button>
    </div>
  </div>
</template>

<style scoped>
.lexicon-page { max-width: 1040px; margin: 0 auto; padding: 0 4px 48px; }
.lex-controls {
  display: flex; align-items: center; gap: 12px; margin-bottom: 18px;
}
.lex-search {
  flex: 1; height: 44px; padding: 0 16px; border-radius: 12px;
  background: var(--surface); border: 1px solid var(--line);
  color: var(--text); font-size: var(--fs-md); font-family: inherit; outline: none;
  transition: border-color .18s var(--ease), box-shadow .18s var(--ease);
}
.lex-search:focus {
  border-color: var(--line-accent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 14%, transparent);
}
.lex-loading { font-size: var(--fs-xs); color: var(--text-3); white-space: nowrap; }
.lex-list { display: flex; flex-direction: column; gap: 10px; }
.lex-card {
  display: flex; align-items: flex-start; gap: 12px;
  padding: 16px 18px; cursor: pointer;
  transition: border-color .18s var(--ease), background .18s var(--ease);
}
.lex-card:hover { border-color: var(--line-accent); }
.lex-card.open { border-color: var(--line-accent); background: color-mix(in srgb, var(--surface) 82%, var(--accent) 18%); }
.lex-main { flex: 1; min-width: 0; }
.lex-word-line { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.lex-word { font-family: var(--font-mono, ui-monospace, monospace); font-size: 18px; color: var(--text); font-weight: 600; }
.lex-speak {
  width: 22px; height: 22px; border-radius: 50%; border: 1px solid var(--line);
  background: transparent; color: var(--text-3); font-size: 9px; line-height: 1;
  cursor: pointer; display: inline-flex; align-items: center; justify-content: center;
}
.lex-speak:hover { color: var(--accent); border-color: var(--line-accent); }
.lex-ipa { font-size: var(--fs-xs); color: var(--text-3); }
.lex-level { margin-left: auto; font-size: var(--fs-xs); color: var(--text-3); }
.lex-meaning { margin: 7px 0 0; color: var(--text-2); font-size: var(--fs-sm); line-height: 1.65; }
.lex-toggle { color: var(--text-3); font-size: 18px; line-height: 1; padding-top: 2px; }
.lex-detail { margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--line); display: flex; flex-direction: column; gap: 12px; }
.lex-block-title { font-size: var(--fs-xs); color: var(--text-3); letter-spacing: .08em; margin-bottom: 6px; }
.lex-pair { display: flex; flex-wrap: wrap; gap: 4px 10px; padding: 3px 0; font-size: var(--fs-sm); }
.lex-en { color: var(--text); }
.lex-zh { color: var(--text-3); }
.lex-none { font-size: var(--fs-xs); color: var(--text-3); }
.lex-pager { display: flex; align-items: center; justify-content: center; gap: 16px; margin-top: 24px; }
.lex-page-num { font-size: var(--fs-xs); color: var(--text-3); font-variant-numeric: tabular-nums; }
</style>
