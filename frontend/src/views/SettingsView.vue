<script setup>
import { ref, computed, onActivated } from 'vue'
import { useUniverse } from '../stores/universe'
import { api } from '../api'
import { speak } from '../speech'
import { NModal, NButton, NSpace } from 'naive-ui'
import { message as _msg } from '../ui'

const store = useUniverse()

const theme = computed({
  get: () => store.settings.theme,
  set: (v) => store.applySettings({ theme: v }),
})
const rate = computed({
  get: () => store.settings.speechRate,
  set: (v) => store.applySettings({ speechRate: v }), // 拖动即时生效(本地)
})
// 松手才落服务端档案,避免拖动过程中反复请求(回声谷恢复的就是这份 prefs.speechRate)
function commitRate() { store.setPref('speechRate', rate.value) }

// 目标记忆保持率(FSRS desired retention):决定复习时机——
// 保持率越高复习越勤(85% 省时间 / 90% 默认 / 95% 备考冲刺),经 setPref 落档案
const RETENTION_OPTIONS = [
  { value: 0.85, label: '85%', desc: '省时档 · 复习更少' },
  { value: 0.90, label: '90%', desc: '推荐档 · 记得牢' },
  { value: 0.95, label: '95%', desc: '冲刺档 · 备考用' },
]
const retention = computed(() => Number(store.profile.prefs.desiredRetention) || 0.9)
function setRetention(v) { store.setPref('desiredRetention', v) }

// 复习提醒开关(默认开,localStorage 持久化——和偏好独立,免得改偏好一不小心也把它清了)
const reviewNudge = ref(true)
try { reviewNudge.value = localStorage.getItem('wv_review_nudge') !== 'off' } catch {}
function toggleNudge(on) {
  reviewNudge.value = on
  try { localStorage.setItem('wv_review_nudge', on ? 'on' : 'off') } catch {}
}

// 主题切换由 App.vue 统一应用(data-theme + toast + 3D 通知),这里只写 store
// 每卡自带预览色板(--pv-accent/--pv-line 注入卡内,不随当前主题漂移)
const THEMES = [
  { key: 'light', label: '宣纸', desc: '默认 · 暖白 × 海军蓝 × 香槟金', color: '#3D5A85', bg: '#F7F5F0', line: 'rgba(32,54,83,0.16)' },
  { key: 'dark', label: '深空', desc: '夜间 · 极光青 × 紫电宇宙', color: '#22d3ee', bg: '#05070f', line: 'rgba(255,255,255,0.10)' },
  { key: 'violet', label: '紫罗兰', desc: '柔和紫调', color: '#c084fc', bg: '#0a0814', line: 'rgba(255,255,255,0.10)' },
  { key: 'catppuccin', label: '暖夜', desc: 'Catppuccin · 柔和粉彩暗色', color: '#cba6f7', bg: '#1e1e2e', line: 'rgba(205,214,244,0.12)' },
]

// ---- 数据导出:调后端 GET /users/:id/export,下载完整 JSON ----
async function exportData() {
  if (!store.user) return _msg.error('请先登录再导出')
  try {
    const data = await api.exportData(store.user.id)
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `wordpeak-export-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
    _msg.success('导出完成,JSON 已开始下载')
  } catch { _msg.error('导出失败，稍后再试一次') }
}

// ---- 数据导入:选文件 → POST /users/:id/import → 刷新 store ----
const fileInput = ref(null)
const importBusy = ref(false)
async function onImportFile(e) {
  const file = e.target.files?.[0]
  e.target.value = ''
  if (!file) return
  if (!store.user) return _msg.error('请先登录再导入')
  let payload
  try { payload = JSON.parse(await file.text()) } catch { return _msg.error('文件不是有效的 JSON') }
  importBusy.value = true
  try {
    const r = await api.importData(store.user.id, payload)
    await store.loadUniverse()
    await Promise.all([store.refreshStats(), store.refreshPhonetics()])
    await loadModCounts()
    const c = r?.imported || {}
    _msg.success(`导入成功:单词状态 ${c.word_states ?? 0} 条 · 语法 ${c.grammar_states ?? 0} 条 · 听说读写 ${[c.listening_results, c.speaking_results, c.reading_results, c.writing_results].filter(Boolean).length} 类已恢复`)
  } catch (err) { _msg.error('导入失败:' + (err?.message || '数据校验未通过')) }
  importBusy.value = false
}

// ---- 资源打包下载:CSV/JSON 生成器(纯前端从 store 现有数据出) ----
// 资源卡数字口径与"关于"卡一致:全部来自 store,数据变了文案跟着变
const grammarQuizCount = computed(() =>
  store.grammar.reduce((a, g) => a + (g.quiz || []).length, 0))
function csvEscape(s) {
  if (s == null) return ''
  const v = String(s)
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}
function downloadFile(name, content, mime) {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url)
}
function todayTag() { return new Date().toISOString().slice(0, 10) }

function downloadWords() {
  const head = ['word', 'ipa', 'pos', 'meaning', 'root', 'root_meaning', 'family', 'level']
  const rows = store.words.map((w) => [w.word, w.ipa, w.pos, w.meaning, w.root, w.root_meaning, w.family, w.level].map(csvEscape).join(','))
  downloadFile(`wordpeak-words-${todayTag()}.csv`, '﻿' + head.join(',') + '\n' + rows.join('\n'), 'text/csv')
  _msg.success(`已导出 ${store.words.length} 词`)
}
function downloadGrammar(fmt) {
  if (fmt === 'csv') {
    const head = ['title', 'category', 'formula', 'examples_count', 'quiz_count']
    const rows = store.grammar.map((g) => [g.title, g.category, g.formula, (g.examples || []).length, (g.quiz || []).length].map(csvEscape).join(','))
    downloadFile(`wordpeak-grammar-${todayTag()}.csv`, '﻿' + head.join(',') + '\n' + rows.join('\n'), 'text/csv')
    _msg.success(`已导出 ${store.grammar.length} 个语法点`)
  } else {
    downloadFile(`wordpeak-grammar-${todayTag()}.json`, JSON.stringify(store.grammar, null, 2), 'application/json')
    _msg.success('已导出 JSON 完整带题库')
  }
}
function downloadPassages() {
  const head = ['type', 'title', 'level', 'sentences_count', 'questions_count']
  const rows = store.passages.map((p) => [p.type, p.title, p.level, (p.sentences || []).length, (p.questions || []).length].map(csvEscape).join(','))
  downloadFile(`wordpeak-passages-${todayTag()}.csv`, '﻿' + head.join(',') + '\n' + rows.join('\n'), 'text/csv')
  _msg.success(`已导出 ${store.passages.length} 篇语料`)
}
function downloadPhonemes() {
  const head = ['symbol', 'type', 'name', 'voiced', 'level', 'tip']
  const rows = store.phonemes.map((p) => [p.symbol, p.type, p.name, p.voiced ? '1' : '0', p.level, p.tip].map(csvEscape).join(','))
  downloadFile(`wordpeak-phonemes-${todayTag()}.csv`, '﻿' + head.join(',') + '\n' + rows.join('\n'), 'text/csv')
  _msg.success(`已导出 ${store.phonemes.length} 个音标`)
}

// ---- 按模块清空记录:模块粒度清空 + 各模块当前记录数 ----
const RESET_MODULES = [
  { key: 'vocab', name: '词汇 · 单词复习状态', short: '词汇' },
  { key: 'grammar', name: '语法 · 答题记录', short: '语法' },
  { key: 'listening', name: '听力 · 答题记录', short: '听力' },
  { key: 'speaking', name: '口语 · 跟读记录', short: '口语' },
  { key: 'phonetics', name: '发音舱 · 练习记录', short: '发音舱' },
  { key: 'reading', name: '阅读 · 答题记录', short: '阅读' },
  { key: 'writing', name: '写作 · 写作工坊记录', short: '写作' },
]
const selectedMods = ref([])
const modCounts = ref(null)
// 记录数来自后端导出接口(它本来就返回全部行,顺便当计数用)
async function loadModCounts() {
  if (!store.user) return
  try {
    const data = await api.exportData(store.user.id)
    modCounts.value = {
      vocab: data.word_states?.length || 0,
      grammar: data.grammar_states?.length || 0,
      listening: data.listening_results?.length || 0,
      speaking: data.speaking_results?.length || 0,
      phonetics: data.phonetic_results?.length || 0,
      reading: data.reading_results?.length || 0,
      writing: data.writing_results?.length || 0,
    }
  } catch { modCounts.value = null }
}
onActivated(loadModCounts) // KeepAlive:回设置页刷新各模块记录数

// 当前勾选的模块(确认弹窗里列出真实记录数)
const selectedReset = computed(() => RESET_MODULES.filter((m) => selectedMods.value.includes(m.key)))
// 只勾了一个且有记录数时,弹窗里说人话:"确定要清掉听力的 23 条记录吗?"
const singleReset = computed(() =>
  selectedReset.value.length === 1 && modCounts.value ? selectedReset.value[0] : null,
)

const showModReset = ref(false)
const modResetBusy = ref(false)
async function doModReset() {
  modResetBusy.value = true
  try {
    await store.resetUserData([...selectedMods.value])
    showModReset.value = false
    selectedMods.value = []
    await loadModCounts()
    _msg.success('所选记录已清空')
  } catch { _msg.error('清空失败，稍后再试一次') }
  modResetBusy.value = false
}

// ---- 清空进度(二次确认) ----
const showReset = ref(false)
const resetBusy = ref(false)
async function doReset() {
  resetBusy.value = true
  try {
    await store.resetUserData()
    showReset.value = false
    selectedMods.value = []
    await loadModCounts()
    _msg.success('所有学习数据已清空')
  } catch { _msg.error('清空失败') }
  resetBusy.value = false
}

// (学习轨迹·星轨已迁入观星台 DashboardView——激励型内容住在首页,设置页只管偏好与数据)
</script>

<template>
  <div class="view-scroll">
    <div class="view-inner fade-in">
      <div class="section-title">设置 · 偏好与数据</div>
      <div class="section-sub">主题、语速、数据管理。所有设置自动保存到本地(localStorage),不依赖账号。</div>

      <div class="settings-grid stagger">
      <!-- 主题 -->
      <div class="card settings-card">
        <div class="card-head"><div class="h-section">主题</div></div>
        <p class="card-sub">四套主题 · 点击立即生效</p>
        <div class="theme-grid">
          <button
            v-for="t in THEMES" :key="t.key"
            class="theme-card" :class="{ active: theme === t.key }"
            :style="{ '--pv-accent': t.color, '--pv-line': t.line }"
            @click="theme = t.key"
          >
            <div class="theme-preview" :style="{ background: t.bg }">
              <span class="theme-mock-bar" />
              <div class="theme-mock-row">
                <span class="theme-mock-dot" />
                <span class="theme-mock-line" />
                <span class="theme-mock-line" style="width: 60%" />
              </div>
              <div class="theme-mock-row">
                <span class="theme-mock-line" style="width: 100%" />
                <span class="theme-mock-line" style="width: 80%" />
                <span class="theme-mock-line" style="width: 70%" />
              </div>
            </div>
            <div class="theme-label">{{ t.label }}</div>
            <div class="theme-desc">{{ t.desc }}</div>
          </button>
        </div>
      </div>

      <!-- 语速 -->
      <div class="card settings-card">
        <div class="card-head"><div class="h-section">默认朗读语速</div></div>
        <p class="card-sub">全局基准语速:单词/例句朗读按它播放,慢速按钮在它基础上再放慢(回声谷里有自己的滑杆)</p>
        <div class="rate-row">
          <input v-model.number="rate" type="range" min="0.6" max="1.2" step="0.05" class="rate-input" @change="commitRate" />
          <span class="rate-val">{{ rate.toFixed(2) }}x</span>
          <button class="btn small" @click="speak('Hello world, this is a voice test.')">试听</button>
        </div>
      </div>

      <!-- 目标记忆保持率 -->
      <div class="card settings-card">
        <div class="card-head"><div class="h-section">目标记忆保持率</div></div>
        <p class="card-sub">复习排程的目标线:一个词的记忆概率掉到这条线,就会被排进复习队列。保持率越高、复习越勤。</p>
        <div class="retention-seg">
          <button
            v-for="o in RETENTION_OPTIONS" :key="o.value"
            class="retention-opt" :class="{ active: Math.abs(retention - o.value) < 0.001 }"
            @click="setRetention(o.value)"
          >
            <span class="retention-num">{{ o.label }}</span>
            <span class="retention-desc">{{ o.desc }}</span>
          </button>
        </div>
      </div>

      <!-- 复习提醒:due 词数多时 App 启动给一次性 toast(默认开,可关) -->
      <div class="card settings-card">
        <div class="card-head"><div class="h-section">复习提醒</div></div>
        <p class="card-sub">进站时若待复习词数超过 15,会浮一行小提示引导你开始复习。关了就不打扰,可以在观星台手动看数字。</p>
        <div class="rate-row">
          <label class="toggle">
            <input type="checkbox" :checked="reviewNudge" @change="toggleNudge($event.target.checked)" />
            <span class="toggle-track" aria-hidden="true"><i /></span>
            <span class="toggle-text">{{ reviewNudge ? '已开启' : '已关闭' }}</span>
          </label>
        </div>
      </div>

      <!-- 数据管理 — 危险区隔离带:把重置/清空单独锁在带红边的卡里,避免误触 -->
      <div class="card settings-card settings-card-wide settings-danger">
        <div class="card-head">
          <div class="h-section">数据管理</div>
          <span class="settings-danger-tag">危险操作</span>
        </div>
        <p class="card-sub">学习数据存储在后端:可导出 JSON 备份,也可导入之前导出的文件跨设备恢复。</p>
        <div class="rv-actions" style="justify-content: flex-start; flex-wrap: wrap; gap: 10px">
          <button class="btn primary" :disabled="!store.user" @click="exportData">导出学习数据(JSON)</button>
          <button class="btn" :disabled="!store.user || importBusy" @click="fileInput?.click()">
            {{ importBusy ? '导入中…' : '导入备份' }}
          </button>
          <input
            ref="fileInput" type="file" accept="application/json,.json"
            style="display: none" @change="onImportFile"
          />
        </div>
        <p class="card-hint dm-warn-line">
          导入会<b class="text-warn">先清空当前数据</b>再恢复文件内容,操作前建议先导出一份备份。
        </p>
        <div class="settings-danger-zone">
          <div class="settings-danger-line" />
          <div class="settings-danger-actions">
            <span class="settings-danger-hint">以下操作不可撤销,请先导出备份</span>
            <button class="btn danger" @click="showReset = true">清空所有学习进度</button>
          </div>
        </div>
      </div>

      <!-- 资源打包下载:单词表 / 语法点 / 短文 离线带走 -->
      <div class="card settings-card settings-card-wide">
        <div class="card-head"><div class="h-section">资源打包下载</div></div>
        <p class="card-sub">把知识库里的词条/语法/语料打成 CSV,方便拿去别的软件背或离线保存。数据源自后端,无账号也可下载(只是当下内容)。</p>
        <div class="resource-grid">
          <div class="resource-item">
            <div class="ri-title">单词表 · {{ store.words.length }} 词</div>
            <div class="ri-desc">CSV:word,ipa,pos,meaning,root,family,level</div>
            <button class="btn small primary" @click="downloadWords">下载 CSV</button>
          </div>
          <div class="resource-item">
            <div class="ri-title">语法点 · {{ store.grammar.length }} 点 × {{ grammarQuizCount }} 题</div>
            <div class="ri-desc">CSV 简表:title,category,formula;或 JSON 完整带题库</div>
            <div class="ri-actions">
              <button class="btn small" @click="downloadGrammar('csv')">CSV</button>
              <button class="btn small" @click="downloadGrammar('json')">JSON</button>
            </div>
          </div>
          <div class="resource-item">
            <div class="ri-title">短文语料 · {{ store.passages.length }} 篇</div>
            <div class="ri-desc">CSV:type,title,level,句子数,题数(听力/口语/阅读)</div>
            <button class="btn small primary" @click="downloadPassages">下载 CSV</button>
          </div>
          <div class="resource-item">
            <div class="ri-title">音标 · {{ store.phonemes.length }} 个</div>
            <div class="ri-desc">CSV:symbol,type,name,voiced,level,tip</div>
            <button class="btn small primary" @click="downloadPhonemes">下载 CSV</button>
          </div>
        </div>
      </div>

      <!-- 按模块清空记录 — 同样进入危险区 -->
      <div class="card settings-card settings-danger">
        <div class="card-head">
          <div class="h-section">按模块清空记录</div>
          <span class="settings-danger-tag">危险操作</span>
        </div>
        <p class="card-sub">
          只想重新开始某一模块?勾选后清空,其余模块进度原样保留。各模块当前记录数:
        </p>
        <div class="mod-reset-grid stagger">
          <label
            v-for="m in RESET_MODULES" :key="m.key"
            class="mod-reset-item" :class="{ checked: selectedMods.includes(m.key) }"
          >
            <input v-model="selectedMods" type="checkbox" :value="m.key" class="mod-check" />
            <span class="mod-name">{{ m.name }}</span>
            <span v-if="modCounts" class="mod-count">{{ modCounts[m.key] }} 条记录</span>
            <span v-else class="skeleton mod-count" :style="{ display: 'inline-block', width: '56px', height: '12px' }" aria-label="记录数加载中" />
          </label>
        </div>
        <div class="settings-danger-zone">
          <div class="settings-danger-line" />
          <div class="settings-danger-actions">
            <span class="settings-danger-hint">只清勾选模块的答题与活动流水,不影响其他模块</span>
            <button class="btn danger" :disabled="!selectedMods.length" @click="showModReset = true">
              清空所选记录{{ selectedMods.length ? `(${selectedMods.length} 个)` : '' }}
            </button>
          </div>
        </div>
      </div>

      <!-- 关于 -->
      <div class="card settings-card settings-card-wide">
        <div class="card-head"><div class="h-section">关于</div></div>
        <p class="about-text">
          <b class="text-accent">词峰 WORDPEAK</b> v2.0 · 3D 沉浸式英语学习宇宙<br />
          {{ store.words.length }} 单词 / {{ new Set(store.words.map((w) => w.root).filter(Boolean)).size }} 词根 / {{ store.phonemes.length }} 音标 / {{ store.grammar.length }} 语法点 / {{ store.passages.length }} 语料 / {{ store.books.length }} 本书 / {{ store.tips.length }} 技巧<br />
          内容方法论参考《英语学习书单》,书是教材,词峰是训练场。
        </p>
      </div>
      </div>
    </div>

    <!-- 弹窗:n-modal 会 teleport 到 body,放在 .view-inner 内部便于单根模板 -->
    <n-modal :show="showModReset" preset="card" :bordered="false" class="reset-modal"
      @close="showModReset = false"
    >
      <template #header>
        <b class="text-danger">确定要清空所选模块的记录吗?</b>
      </template>
      <p v-if="singleReset" class="reset-text">
        确定要清掉{{ singleReset.short }}的 {{ modCounts[singleReset.key] }} 条记录吗?这个操作撤不回来。
      </p>
      <template v-else>
        <p class="reset-text">将清空以下记录(其余模块保留):</p>
        <ul class="reset-list">
          <li v-for="m in selectedReset" :key="m.key">
            {{ m.name }}
            <span v-if="modCounts" class="text-warn">({{ modCounts[m.key] }} 条)</span>
          </li>
        </ul>
      </template>
      <p class="reset-warn">这个操作撤不回来,建议先导出一份备份</p>
      <template #action>
        <n-space>
          <n-button @click="showModReset = false">取消</n-button>
          <n-button type="primary" :loading="modResetBusy" class="btn-danger-solid" @click="doModReset">确认清空</n-button>
        </n-space>
      </template>
    </n-modal>

    <n-modal :show="showReset" preset="card" :bordered="false" class="reset-modal"
      @close="showReset = false"
    >
      <template #header>
        <b class="text-danger">确定要清空所有学习数据吗?</b>
      </template>
      <p class="reset-text">
        清空后,这个账号的这些内容都会删掉,一切从头开始:
      </p>
      <ul class="reset-list">
        <li>所有单词的 SM-2 复习状态</li>
        <li>语法/听力/口语/阅读答题历史</li>
        <li>发音舱练习记录</li>
        <li>学习画像与活跃度统计</li>
      </ul>
      <p class="reset-warn">这个操作撤不回来,建议先导出一份备份</p>
      <template #action>
        <n-space>
          <n-button @click="showReset = false">取消</n-button>
          <n-button type="primary" :loading="resetBusy" class="btn-danger-solid" @click="doReset">确认清空</n-button>
        </n-space>
      </template>
    </n-modal>
  </div>
</template>

<style scoped>
/* 桌面 ≥1200px 双列,<960px 单列,"数据管理" + "关于" 跨满宽 */
.settings-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.settings-card-wide { grid-column: 1 / -1; }
@media (max-width: 1199px) {
  .settings-grid { grid-template-columns: 1fr; }
  .settings-card-wide { grid-column: 1; }
}
.theme-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px }
@media (max-width: 760px) { .theme-grid { grid-template-columns: repeat(2, 1fr); } }
.about-text { line-height: 1.85; color: var(--text-2); margin-top: 8px; }
.rate-row { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
.rate-input { flex: 1; min-width: 200px; accent-color: var(--accent); }

/* 目标记忆保持率档位 */
.retention-seg { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
.retention-opt {
  display: flex; flex-direction: column; gap: 3px; align-items: flex-start; padding: 10px 12px;
  background: var(--surface); border: 1px solid var(--line); border-radius: var(--r-md, 10px);
  cursor: pointer; text-align: left; transition: border-color .18s ease, background .18s ease;
}
.retention-opt:hover { border-color: var(--accent); }
.retention-opt.active { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 8%, var(--surface)); }
.retention-num { font-size: var(--fs-lg); font-weight: 600; color: var(--text); font-variant-numeric: tabular-nums; }
.retention-desc { font-size: var(--fs-2xs); color: var(--text-3); }
@media (max-width: 640px) { .retention-seg { grid-template-columns: 1fr; } }
.dm-warn-line { color: var(--text-2); font-size: var(--fs-xs); margin: 12px 0 0; }
/* 复习提醒开关:玻璃胶囊 toggle */
.toggle { display: inline-flex; align-items: center; gap: 12px; cursor: pointer; user-select: none; }
.toggle input { position: absolute; opacity: 0; pointer-events: none; }
.toggle-track { position: relative; width: 44px; height: 24px; border-radius: 12px; background: var(--surface-active); transition: background 0.2s var(--ease); flex-shrink: 0; }
.toggle-track i { position: absolute; left: 3px; top: 3px; width: 18px; height: 18px; border-radius: 50%; background: var(--text-2); transition: all 0.22s var(--ease); }
.toggle input:checked + .toggle-track { background: var(--accent); }
.toggle input:checked + .toggle-track i { left: 23px; background: var(--on-accent); }
.toggle-text { font-size: var(--fs-sm); color: var(--text-2); }
/* 危险操作卡:左侧 3px 红色边带 + 角标,避免和正常数据管理按钮混排误触 */
.settings-danger { border-left: 3px solid var(--danger); }
.settings-danger-tag {
  font-family: var(--mono); font-size: var(--fs-2xs); font-weight: 600;
  color: var(--danger); background: color-mix(in srgb, var(--danger) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--danger) 30%, transparent);
  padding: 2px 8px; border-radius: 999px; letter-spacing: 0.18em;
}
.settings-danger-zone { margin-top: 18px; display: flex; flex-direction: column; gap: 10px; }
.settings-danger-line { height: 1px; background: color-mix(in srgb, var(--danger) 35%, transparent); }
.settings-danger-actions { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.settings-danger-hint { font-size: var(--fs-xs); color: var(--text-3); }
.theme-card {
  cursor: pointer; text-align: left; padding: 16px;
  background: var(--surface); border: 1px solid var(--line); border-radius: 16px;
  font-family: inherit; color: var(--text); transition: all 0.25s var(--ease);
  position: relative; overflow: hidden;
}
.theme-card:hover { border-color: var(--line-accent); transform: translateY(-2px); }
.theme-card.active {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--accent-soft), 0 8px 24px color-mix(in srgb, var(--accent) 18%, transparent);
}
.theme-preview {
  background: var(--surface-sunken); border: 1px solid var(--line);
  border-radius: 10px; padding: 10px; margin-bottom: 12px; display: flex; flex-direction: column; gap: 6px; min-height: 96px;
}
.theme-mock-bar { height: 6px; background: var(--pv-line, var(--line-strong)); border-radius: 3px; width: 30% }
.theme-mock-row { display: flex; align-items: center; gap: 6px }
.theme-mock-dot {
  width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0;
  background: var(--pv-accent, var(--accent)); box-shadow: 0 0 8px var(--pv-accent, var(--accent));
}
.theme-mock-line { height: 5px; background: var(--pv-line, var(--line-strong)); border-radius: 3px; flex: 1 }
.theme-label { font-weight: 600; font-size: var(--fs-md); margin-bottom: 2px }
.theme-desc { font-size: var(--fs-xs); color: var(--text-3) }

.rate-val {
  font-family: var(--mono); font-size: var(--fs-lg); color: var(--accent); font-weight: 700;
  min-width: 60px; text-align: right;
}

/* 按模块清空记录 */
.mod-reset-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 10px; }

/* 资源打包下载:4 块资源卡 */
.resource-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 12px; }
.resource-item {
  padding: 16px; border-radius: 12px;
  background: var(--surface-sunken); border: 1px solid var(--line);
  display: flex; flex-direction: column; gap: 6px;
}
.ri-title { font-size: var(--fs-base); font-weight: 600; }
.ri-desc { font-size: var(--fs-xs); color: var(--text-3); line-height: 1.5; margin-bottom: 6px; }
.ri-actions { display: flex; gap: 6px; }
.ri-actions .btn { flex: 1; justify-content: center; }
.mod-reset-item {
  display: flex; align-items: center; gap: 10px; cursor: pointer;
  padding: 10px 12px; border-radius: 12px;
  background: color-mix(in srgb, var(--info) 5%, transparent); border: 1px solid var(--line);
  transition: all 0.22s var(--ease);
}
.mod-reset-item:hover { border-color: color-mix(in srgb, var(--accent) 45%, transparent); }
.mod-reset-item.checked { border-color: color-mix(in srgb, var(--danger) 50%, transparent); background: color-mix(in srgb, var(--danger) 7%, transparent); }
.mod-check { accent-color: var(--danger); cursor: pointer; }
.mod-name { font-size: var(--fs-sm); flex: 1; }
.mod-count { font-size: var(--fs-xs); color: var(--text-3); white-space: nowrap; }

/* 重置确认弹窗(n-modal 卡片样式) */
:global(.reset-modal) {
  width: 420px !important;
  background: var(--surface) !important;
  border: 1px solid color-mix(in srgb, var(--danger) 35%, transparent) !important;
}
.reset-text { line-height: 1.7; color: var(--text-2); }
.reset-list { margin: 8px 0; padding-left: 20px; color: var(--text-2); font-size: var(--fs-sm); line-height: 1.9; }
.reset-warn { color: var(--warn); font-size: var(--fs-sm); margin-top: 6px; }
:global(.reset-modal .btn-danger-solid) {
  background: var(--danger) !important; border-color: var(--danger) !important; color: var(--on-danger) !important;
}

</style>
