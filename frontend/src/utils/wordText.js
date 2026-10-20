// 单词 → 分享文本 / 剪贴板 / 永久链接

// 排版:`word /ipa/ pos. meaning\n— sibling1, sibling2 (词根 root-: root_meaning)`
export function formatWordText(w) {
  if (!w) return ''
  const head = `${w.word} ${w.ipa || ''} ${w.pos ? w.pos + '.' : ''} ${w.meaning || ''}`.trim()
  // 家族兄弟词(从 collocations 里拿不到,用 etymology 末尾的同族词,或在 WordPanel 单独传入)
  const rootLine = w.root && w.root_meaning ? `— (词根 ${w.root}-:${w.root_meaning})` : ''
  return [head, rootLine].filter(Boolean).join('\n')
}

// 复制文本到剪贴板;非 https 环境 fallback 到隐藏 textarea + execCommand
export async function copyText(text) {
  if (!text) return false
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch { /* 权限拒绝时降级 */ }
  // fallback:临时 textarea + execCommand
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    ta.style.left = '-9999px'
    document.body.appendChild(ta)
    ta.focus()
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}

// 分享永久链接(应用无路由,基于 hash;以后接真实路由可只改这里)
export function wordPermalink(id) {
  if (id == null) return ''
  const { origin, pathname } = window.location
  return `${origin}${pathname}#/word/${id}`
}