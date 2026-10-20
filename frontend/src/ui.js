import { computed, ref } from 'vue'
import { createDiscreteApi, darkTheme } from 'naive-ui'

// 各主题的 accent 映射(与 styles.css token 保持同步;App.vue 的 Naive Provider 共用)
export const THEME_ACCENTS = {
  dark:   { primary: '#22d3ee', hover: '#67e8f9', pressed: '#06b6d4' },
  light:  { primary: '#3D5A85', hover: '#2C4568', pressed: '#23385C' }, // 宣纸:海军蓝主色,浅底上悬停加深
  violet: { primary: '#c084fc', hover: '#d8b4fe', pressed: '#a855f7' },
  catppuccin: { primary: '#cba6f7', hover: '#d9bdfd', pressed: '#b4a0e8' }, // Mocha mauve
}

// 组件树之外的轻量 message 提示（后端连接失败、识别出错等）
// 主题响应:监听 App.vue 派发的 wv:themechange,toast 跟随站点主题(默认宣纸)
const currentTheme = ref(document.documentElement.dataset.theme || 'light')
window.addEventListener('wv:themechange', (e) => {
  currentTheme.value = e.detail?.theme || document.documentElement.dataset.theme || 'light'
})

const { message } = createDiscreteApi(['message'], {
  configProviderProps: computed(() => {
    const a = THEME_ACCENTS[currentTheme.value] || THEME_ACCENTS.light
    return {
      theme: currentTheme.value === 'light' ? null : darkTheme,
      themeOverrides: { common: { primaryColor: a.primary, primaryColorHover: a.hover } },
    }
  }),
})

// store 层不用 UI 库,错误提示走 wv:toast-error 事件派发——在这里接线到 toast。
// 此前派发端(universe.js)与监听端缺失,收藏夹/日记保存失败完全静默
window.addEventListener('wv:toast-error', (e) => {
  const detail = e.detail
  message.error(typeof detail === 'string' ? detail : detail?.message || '操作失败，请稍后重试')
})

export { message }
