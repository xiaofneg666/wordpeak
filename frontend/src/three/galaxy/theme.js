import * as THREE from 'three'

// 解析 CSS 变量为 THREE.Color,缺省回退暗主题
function readVar(name, fallback) {
  if (typeof document === 'undefined') return new THREE.Color(fallback)
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  if (!v) return new THREE.Color(fallback)
  try { return new THREE.Color(v) } catch { return new THREE.Color(fallback) }
}

// 主题色读取:站点主题变 → 3D 星系核心/家族核心/例句高亮/学习态星球同步换色
// 读 --glow-* 组:暗画布上的发光色与 UI accent(--accent)解耦 —— 浅色主题的
// accent 为对比度收深(#3D5A85),而星球发光需要亮色版(#38BDF8)
// fallback 与暗主题现值一致;浅色/紫罗兰主题由站点 glow token 决定
export function readThemeColors() {
  return {
    accent: readVar('--glow-accent', '#22d3ee'),
    accent2: readVar('--glow-accent-2', '#a78bfa'),
    accent3: readVar('--glow-accent-3', '#f472b6'),
    success: readVar('--glow-success', '#4ade80'),
    warn: readVar('--glow-warn', '#fbbf24'),
    danger: readVar('--glow-danger', '#f87171'),
    info: readVar('--glow-info', '#60a5fa'),
  }
}

// 学习语义色 → 自发光色(对齐 styles.css .chip green/warn/red 与设计意图)
export function emissiveForState(state) {
  const c = readThemeColors()
  if (!state || state.is_new) return { emissive: c.accent2, intensity: 0.45 }
  const s = state.strength ?? 0
  if (state.due && s < 0.45) return { emissive: c.danger, intensity: 1.6 }
  if (state.due) return { emissive: c.warn, intensity: 1.2 }
  if (s > 0.75) return { emissive: c.success, intensity: 1.5 }
  if (s > 0.45) return { emissive: c.accent, intensity: 1.1 }
  return { emissive: c.accent2, intensity: 0.55 }
}
