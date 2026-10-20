// 词根故事三段式(/api/roots:story 来源叙事 / branches 同族分化 / confuse 易混辨析)
// → 词卡「记法」段的数据形状。解析规则与 FamilyView 的分叉图腾同源,为小卡场景
// 精简:不绑词库条目、只点亮当前词(点谁谁亮);解析不出 branches 整段退回纯文本,
// 对数据永不硬编码
export function parseRootStory(info, currentWord) {
  if (!info) return null
  const cur = String(currentWord || '').toLowerCase()
  // branches:「语义描述→word 释义、word 释义;…」(root_stories.json 统一此格式)
  // 句号后的散文尾巴归 loose,无箭头的段落也归 loose——解析失败整段保真展示
  const rows = []
  const loose = []
  if (info.branches) {
    for (const frag of String(info.branches).split(/[；;]/).map((s) => s.trim()).filter(Boolean)) {
      const arrow = frag.indexOf('→')
      if (arrow < 0) { loose.push(frag); continue }
      const desc = frag.slice(0, arrow).trim()
      const rest = frag.slice(arrow + 1)
      const dot = rest.indexOf('。')
      const head = dot >= 0 ? rest.slice(0, dot) : rest
      const tail = dot >= 0 ? rest.slice(dot + 1).trim() : ''
      const words = []
      const re = /([A-Za-z][A-Za-z-]*)\s*([一-鿿][^、；;。！？A-Za-z]*)/g
      let m
      while ((m = re.exec(head))) {
        words.push({ word: m[1], zh: m[2].split(/[,，]/)[0].trim(), current: m[1].toLowerCase() === cur })
      }
      if (desc && words.length) rows.push({ desc, words })
      else loose.push(frag)
      if (tail) loose.push(tail)
    }
  }
  // confuse:正文 + 「口诀:…」铭牌(口诀是这段真正的记忆钩子,单独托出)
  let confuse = null
  if (info.confuse) {
    const raw = String(info.confuse)
    const m = raw.match(/口诀[:：]?\s*(.+)$/)
    confuse = m ? { text: raw.slice(0, m.index).trim(), mnemonic: m[1].trim() } : { text: raw, mnemonic: null }
  }
  return {
    story: info.story || null,
    branches: rows.length ? rows : null,
    loose: loose.length ? loose : null,
    confuse,
  }
}
