<script setup>
import { ref, onMounted, onBeforeUnmount, computed } from 'vue'
import { useUniverse } from '../stores/universe'
import { api } from '../api'

const props = defineProps({
  wordId: { type: Number, required: true },
  size: { type: String, default: 'sm' },
})

const store = useUniverse()
const open = ref(false)
const wrapRef = ref(null)
const newName = ref('')
const newColor = ref('accent')
const busy = ref(false)

const COLORS = [
  { key: 'accent', label: '蓝紫' },
  { key: 'success', label: '绿' },
  { key: 'warn',    label: '黄' },
  { key: 'danger',  label: '红' },
  { key: 'info',    label: '蓝' },
]

// 展示已加入的收藏夹 id 集合(乐观更新,失败由 refreshMembership 覆盖)
const inCollections = ref(new Set())
async function refreshMembership() {
  if (!store.user || !store.collections.length) { inCollections.value = new Set(); return }
  // 没有"词→所属夹"的聚合端点,逐夹拉词表判断归属(夹数量少,可接受)
  const hit = await Promise.all(store.collections.map(async (c) => {
    try {
      const ws = await api.collectionWords(store.user.id, c.id)
      return ws.some((w) => w.id === props.wordId) ? c.id : null
    } catch { return null }
  }))
  inCollections.value = new Set(hit.filter(Boolean))
}
onMounted(refreshMembership)

function openMenu() { open.value = !open.value; if (open.value) refreshMembership() }

// 点已加入的夹 = 移出;点未加入的夹 = 加入;面板保持打开,方便连续操作多个夹
async function pickCollection(cid) {
  busy.value = true
  if (inCollections.value.has(cid)) {
    await store.removeFromCollection(cid, props.wordId)
    inCollections.value = new Set([...inCollections.value].filter((x) => x !== cid))
  } else {
    await store.addToCollection(cid, [props.wordId])
    inCollections.value = new Set([...inCollections.value, cid])
  }
  busy.value = false
}

async function createAndAdd() {
  const name = newName.value.trim()
  if (!name) return
  busy.value = true
  const col = await store.createCollection(name, newColor.value)
  if (col) {
    await store.addToCollection(col.id, [props.wordId])
    inCollections.value.add(col.id)
    newName.value = ''
    open.value = false
  }
  busy.value = false
}

function onPointerDown(e) {
  if (!open.value) return
  if (wrapRef.value && !wrapRef.value.contains(e.target)) open.value = false
}
onMounted(() => document.addEventListener('pointerdown', onPointerDown))
onBeforeUnmount(() => document.removeEventListener('pointerdown', onPointerDown))
</script>

<template>
  <div ref="wrapRef" class="collect-pop">
    <button class="cp-trigger" :class="size" :title="open ? '关闭' : '加入收藏夹'" @click.stop="openMenu">
      <svg class="ic" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M6 3h12v18l-6-4-6 4z" :fill="open ? 'currentColor' : 'none'" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" />
      </svg>
      <span v-if="size === 'md'" class="lbl">收藏</span>
    </button>
    <Transition name="lm-fade">
      <div v-if="open" class="cp-panel" role="menu">
        <div v-if="store.collections.length" class="cp-list">
          <button
            v-for="c in store.collections" :key="c.id"
            class="cp-item"
            :class="{ active: inCollections.has(c.id) }"
            :disabled="busy"
            role="menuitem"
            @click.stop="pickCollection(c.id)"
          >
            <span class="cp-color" :class="`is-${c.color || 'accent'}`" />
            <span class="cp-name">{{ c.name }}</span>
            <span class="cp-count">{{ c.word_count }}</span>
          </button>
        </div>
        <p v-else class="cp-empty">还没有收藏夹,在下面新建一个</p>
        <div class="cp-sep">＋ 新建</div>
        <div class="cp-new">
          <input v-model="newName" class="cp-input" placeholder="收藏夹名称" maxlength="40" @keydown.enter.stop="createAndAdd" />
          <div class="cp-colors">
            <button
              v-for="c in COLORS" :key="c.key"
              type="button" class="cp-color-pick"
              :class="[c.key, { active: newColor === c.key }]"
              :title="c.label"
              @click.stop="newColor = c.key"
            />
          </div>
          <button class="cp-create" :disabled="!newName.trim() || busy" @click.stop="createAndAdd">新建并加入</button>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.collect-pop { position: relative; display: inline-flex; }
.cp-trigger {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 5px 10px; border-radius: 8px;
  background: var(--surface); border: 1px solid var(--line);
  color: var(--text-2); font-size: var(--fs-xs); font-family: inherit;
  cursor: pointer; transition: all 0.18s var(--ease);
}
.cp-trigger.md { padding: 7px 13px; font-size: var(--fs-sm); }
.cp-trigger:hover { color: var(--text); border-color: var(--line-accent); background: var(--surface-hover); }
.cp-trigger .ic { width: 13px; height: 13px; }
.cp-trigger.md .ic { width: 15px; height: 15px; }

.cp-panel {
  position: absolute; top: calc(100% + 6px); left: 0; z-index: 30;
  width: 240px; padding: 8px;
  background: var(--surface); border: 1px solid var(--line-strong);
  border-radius: 10px; box-shadow: 0 12px 32px color-mix(in srgb, var(--bg) 50%, transparent);
}
.cp-list { display: flex; flex-direction: column; gap: 2px; max-height: 220px; overflow-y: auto; }
.cp-item {
  display: flex; align-items: center; gap: 8px;
  padding: 7px 9px; border-radius: 7px;
  background: transparent; border: 0; color: var(--text);
  font-size: var(--fs-sm); font-family: inherit; text-align: left;
  cursor: pointer; transition: background 0.15s var(--ease);
}
.cp-item:hover:not(:disabled) { background: var(--surface-hover); }
.cp-item.active { color: var(--success); }
.cp-color { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.cp-color.is-accent { background: var(--accent); }
.cp-color.is-accent-2 { background: var(--accent-2); }
.cp-color.is-success { background: var(--success); }
.cp-color.is-warn { background: var(--warn); }
.cp-color.is-danger { background: var(--danger); }
.cp-color.is-info { background: var(--info); }
.cp-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cp-count { font-family: var(--mono); color: var(--text-3); font-size: var(--fs-2xs); }
.cp-empty { margin: 8px 0; color: var(--text-3); font-size: var(--fs-xs); text-align: center; }
.cp-sep { font-size: var(--fs-2xs); color: var(--text-3); letter-spacing: 0.06em; margin: 8px 0 6px; }
.cp-new { display: flex; flex-direction: column; gap: 6px; }
.cp-input {
  background: var(--surface-sunken); border: 1px solid var(--line);
  color: var(--text); border-radius: 7px; padding: 7px 9px; font-size: var(--fs-sm); font-family: inherit;
}
.cp-input:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
.cp-colors { display: flex; gap: 6px; }
.cp-color-pick {
  width: 16px; height: 16px; border-radius: 50%; border: 2px solid transparent;
  cursor: pointer; transition: transform 0.15s var(--ease);
}
.cp-color-pick.accent { background: var(--accent); }
.cp-color-pick.accent-2 { background: var(--accent-2); }
.cp-color-pick.success { background: var(--success); }
.cp-color-pick.warn { background: var(--warn); }
.cp-color-pick.danger { background: var(--danger); }
.cp-color-pick.info { background: var(--info); }
.cp-color-pick.active { border-color: var(--text); transform: scale(1.15); }
.cp-create {
  background: var(--accent); color: white; border: 0; border-radius: 7px;
  padding: 7px 10px; font-size: var(--fs-sm); font-weight: 600; font-family: inherit;
  cursor: pointer;
}
.cp-create:disabled { opacity: 0.4; cursor: not-allowed; }
.cp-create:not(:disabled):hover { filter: brightness(1.1); }

.lm-fade-enter-active, .lm-fade-leave-active { transition: opacity 0.15s var(--ease), transform 0.15s var(--ease); }
.lm-fade-enter-from, .lm-fade-leave-to { opacity: 0; transform: translateY(-4px); }
</style>