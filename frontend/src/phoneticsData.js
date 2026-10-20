// 48 音标的发音器官参数（前端静态知识：标准 DJ 音标体系）
// 元音: f 舌位前后(0后→1前) h 舌位高低(0低开→1高闭) r 圆唇
// 辅音: place 发音部位 manner 发音方式 voiced 声带振动 nasal 鼻腔通道

export const VOWELS = {
  'iː': { f: 1.0, h: 1.0, r: 0 },
  'ɪ': { f: 0.85, h: 0.8, r: 0 },
  'e': { f: 0.8, h: 0.55, r: 0 },
  'æ': { f: 0.75, h: 0.3, r: 0 },
  'ɑː': { f: 0.15, h: 0.05, r: 0 },
  'ɒ': { f: 0.15, h: 0.2, r: 1 },
  'ɔː': { f: 0.1, h: 0.35, r: 1 },
  'ʊ': { f: 0.2, h: 0.75, r: 1 },
  'uː': { f: 0.15, h: 0.95, r: 1 },
  'ʌ': { f: 0.45, h: 0.3, r: 0 },
  'ɜː': { f: 0.5, h: 0.45, r: 0 },
  'ə': { f: 0.5, h: 0.45, r: 0 },
}

// 双元音：舌位从 start 滑向 end
export const DIPHTHONGS = {
  'eɪ': ['e', 'iː'], 'aɪ': ['ɑː', 'ɪ'], 'ɔɪ': ['ɔː', 'ɪ'],
  'əʊ': ['ə', 'ʊ'], 'aʊ': ['ɑː', 'ʊ'],
  'ɪə': ['ɪ', 'ɜː'], 'eə': ['e', 'ɜː'], 'ʊə': ['ʊ', 'ɜː'],
}

export const PLACES = {
  bi: { f: 0.35, h: 0.35, label: '双唇' },
  labio: { f: 0.35, h: 0.35, label: '唇齿' },
  dent: { f: 0.95, h: 0.45, label: '齿' },
  alv: { f: 0.85, h: 0.65, label: '齿龈' },
  palal: { f: 0.7, h: 0.55, label: '齿龈后' },
  pal: { f: 0.65, h: 0.65, label: '硬腭' },
  vel: { f: 0.12, h: 0.55, label: '软腭' },
  glot: { f: 0.45, h: 0.4, label: '声门' },
}

// manner: stop 塞音(爆破) fric 擦音 affr 塞擦 nasal 鼻音 lat 边音 approx 近音
export const CONSONANTS = {
  'p': { place: 'bi', manner: 'stop', voiced: false },
  'b': { place: 'bi', manner: 'stop', voiced: true },
  't': { place: 'alv', manner: 'stop', voiced: false },
  'd': { place: 'alv', manner: 'stop', voiced: true },
  'k': { place: 'vel', manner: 'stop', voiced: false },
  'g': { place: 'vel', manner: 'stop', voiced: true },
  'f': { place: 'labio', manner: 'fric', voiced: false },
  'v': { place: 'labio', manner: 'fric', voiced: true },
  'θ': { place: 'dent', manner: 'fric', voiced: false },
  'ð': { place: 'dent', manner: 'fric', voiced: true },
  's': { place: 'alv', manner: 'fric', voiced: false },
  'z': { place: 'alv', manner: 'fric', voiced: true },
  'ʃ': { place: 'palal', manner: 'fric', voiced: false },
  'ʒ': { place: 'palal', manner: 'fric', voiced: true },
  'tʃ': { place: 'palal', manner: 'affr', voiced: false },
  'dʒ': { place: 'palal', manner: 'affr', voiced: true },
  'tr': { place: 'alv', manner: 'affr', voiced: false },
  'dr': { place: 'alv', manner: 'affr', voiced: true },
  'ts': { place: 'alv', manner: 'affr', voiced: false },
  'dz': { place: 'alv', manner: 'affr', voiced: true },
  'm': { place: 'bi', manner: 'nasal', voiced: true },
  'n': { place: 'alv', manner: 'nasal', voiced: true },
  'ŋ': { place: 'vel', manner: 'nasal', voiced: true },
  'h': { place: 'glot', manner: 'fric', voiced: false },
  'l': { place: 'alv', manner: 'lat', voiced: true },
  'r': { place: 'alv', manner: 'approx', voiced: true },
  'j': { place: 'pal', manner: 'approx', voiced: true },
  'w': { place: 'bi', manner: 'approx', voiced: true, rounded: true },
}

export const MANNER_LABEL = {
  stop: '塞音 · 气流先完全阻塞后爆破释放',
  fric: '擦音 · 缩窄通道，气流摩擦挤出',
  affr: '塞擦音 · 先阻塞后摩擦释放',
  nasal: '鼻音 · 软腭下降，气流从鼻腔出',
  lat: '边音 · 舌尖抵住，气流从舌两侧出',
  approx: '近音 · 通道略窄但无明显摩擦',
}

// 把音标符号解析为渲染参数
export function resolvePhoneme(symbol) {
  const bare = symbol.replace(/\//g, '').trim()
  if (VOWELS[bare]) return { kind: 'vowel', ...VOWELS[bare] }
  if (DIPHTHONGS[bare]) {
    const [a, b] = DIPHTHONGS[bare]
    return { kind: 'diph', from: VOWELS[a], to: VOWELS[b] }
  }
  if (CONSONANTS[bare]) {
    const c = CONSONANTS[bare]
    return { kind: 'cons', ...PLACES[c.place], manner: c.manner, voiced: c.voiced, nasal: c.manner === 'nasal', rounded: !!c.rounded }
  }
  return null
}
