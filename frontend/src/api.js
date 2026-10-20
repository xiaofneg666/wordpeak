// 一律同源 /api:dev 由 vite proxy 转发到 127.0.0.1:8000(见 vite.config.js),生产由
// nginx / server.mjs 反代 —— 不再跨源 fetch,CORS 白名单端口漂移(5174/5175…)也就无关紧要
const BASE = '/api'

// 默认 15s 超时:后端不可达/挂起时请求别永远 pending(否则各视图 skeleton 永挂)
async function request(path, options = {}) {
  const res = await fetch(BASE + path, {
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(15000),
    ...options,
  })
  if (!res.ok) throw new Error(`HTTP ${res.status} @ ${path}`)
  const body = await res.json()
  if (!body.ok) throw new Error(body.error || 'API error')
  return body.data
}

export const api = {
  ensureUser: (username) => request('/users', { method: 'POST', body: JSON.stringify({ username }) }),
  // 用户个性化档案:GET 读 / POST 部分更新(patch 里出现的字段才更新,如 { goal, self_level, prefs })
  getProfile: (uid) => request(`/users/${uid}/profile`),
  updateProfile: (uid, patch) =>
    request(`/users/${uid}/profile`, { method: 'POST', body: JSON.stringify(patch) }),
  // days: 活跃度窗口 7|14|30(后端默认 14,不传即完整画像)
  stats: (uid, days) => request(`/users/${uid}/stats${days ? `?days=${days}` : ''}`),
  // Phase 3:全年活跃度热力图数据(默认 365 天)
  activity: (uid, days = 365) => request(`/users/${uid}/activity?days=${days}`),
  // Phase 4:收藏夹
  collections: (uid) => request(`/users/${uid}/collections`),
  createCollection: (uid, name, color) =>
    request(`/users/${uid}/collections`, { method: 'POST', body: JSON.stringify({ name, color }) }),
  deleteCollection: (uid, cid) => request(`/users/${uid}/collections/${cid}`, { method: 'DELETE' }),
  collectionWords: (uid, cid) => request(`/users/${uid}/collections/${cid}/words`),
  addToCollection: (uid, cid, wordIds) =>
    request(`/users/${uid}/collections/${cid}/words`, { method: 'POST', body: JSON.stringify({ word_ids: wordIds }) }),
  removeFromCollection: (uid, cid, wid) =>
    request(`/users/${uid}/collections/${cid}/words/${wid}`, { method: 'DELETE' }),
  // 智能推荐「今日一策」:按最弱模块画像从 tips.json 挑 1 条,附中文理由
  recommend: (uid) => request(`/recommend/${uid}`),
  // 今日航线:档案(goal/self_level)+ due 队列 + 弱项 → 当日学习计划(学几个/复习几个/补哪里)
  plan: (uid) => request(`/plan/${uid}`),
  words: () => request('/words'),
  // 全量词库(五源扩展词,family='general'):q 匹配英文/中文,分页返回
  lexicon: (q = '', page = 1, pageSize = 30) =>
    request(`/lexicon?q=${encodeURIComponent(q)}&page=${page}&pageSize=${pageSize}`),
  roots: () => request('/roots'),
  wordStates: (uid) => request(`/words/state/${uid}`),
  // 词汇网络:共现图谱(全库词节点 + 跨族边);user_id 可选(注入记忆概率)
  wordNetwork: (uid) => request(`/words/network${uid ? `?user_id=${uid}` : ''}`),
  reviewQueue: (uid, count = 10) => request(`/review/queue/${uid}?count=${count}`),
  // selfGrade(学习舱三档自评:'known'|'fuzzy'|'unknown')可选;不传走 correct/response_ms 旧契约
  submitReview: (uid, wordId, correct, responseMs, selfGrade) =>
    request('/review/result', { method: 'POST', body: JSON.stringify({
      user_id: uid, word_id: wordId, correct, response_ms: responseMs,
      ...(selfGrade ? { self_grade: selfGrade } : {}),
    }) }),
  // 记忆概率曲线(记忆工坊用):该词未来 days 天的 R 衰减轨迹 + 阈值
  reviewForecast: (uid, wordId, days = 60) =>
    request(`/review/forecast/${uid}/${wordId}?days=${days}`),
  phonemes: () => request('/phonemes'),
  grammar: () => request('/grammar'),
  grammarStates: (uid) => request(`/grammar/state/${uid}`),
  submitGrammar: (uid, pointId, quizIndex, correct) =>
    request('/grammar/result', { method: 'POST', body: JSON.stringify({ user_id: uid, point_id: pointId, quiz_index: quizIndex, correct }) }),
  passages: () => request('/passages'),
  // 轨道书库:书树 + 章节 passage 反查;带 uid 时每章附 read 标记
  library: (uid) => request(`/library${uid ? `?user_id=${uid}` : ''}`),
  resetUserData: (uid, modules) => request(`/users/${uid}/reset`, {
    method: 'POST',
    // 传 modules 数组则只清对应模块;不传则全量清空(与后端约定一致)
    body: JSON.stringify(modules && modules.length ? { modules } : {}),
  }),
  exportData: (uid) => request(`/users/${uid}/export`),
  importData: (uid, payload) =>
    request(`/users/${uid}/import`, { method: 'POST', body: JSON.stringify(payload) }),
  learnWord: (uid, wordId) =>
    request('/words/learn', { method: 'POST', body: JSON.stringify({ user_id: uid, word_id: wordId }) }),
  tips: () => request('/tips'),
  books: () => request('/books'),
  roadmap: () => request('/roadmap'),
  minimalPairs: () => request('/phonetics/pairs'),
  phonicsRules: () => request('/phonetics/rules'),
  submitPhonetics: (uid, kind, refId, correct) =>
    request('/phonetics/result', { method: 'POST', body: JSON.stringify({ user_id: uid, kind, ref_id: refId, correct }) }),
  phoneticsState: (uid) => request(`/phonetics/state/${uid}`),
  submitReading: (uid, passageId, correctCount, total) =>
    request('/reading/result', { method: 'POST', body: JSON.stringify({ user_id: uid, passage_id: passageId, correct_count: correctCount, total }) }),
  submitListening: (uid, passageId, correctCount, total) =>
    request('/listening/result', { method: 'POST', body: JSON.stringify({ user_id: uid, passage_id: passageId, correct_count: correctCount, total }) }),
  // 听/读历史:结算卡「上次这篇 X%」对比的来源(DESC,前端按 passage_id 取最近一条)
  historyPassages: (type, uid, limit = 20) =>
    request(`/passages/history?type=${type}&user_id=${uid}&limit=${limit}`),
  submitSpeaking: (uid, passageId, sentenceIndex, score, transcript) =>
    request('/speaking/result', { method: 'POST', body: JSON.stringify({ user_id: uid, passage_id: passageId, sentence_index: sentenceIndex, score, transcript }) }),
  // 写作工坊:stage 造句 sentence / 成文 essay;word_id 造句阶段必传,成文可空
  submitWriting: (uid, payload) =>
    request('/writing/result', { method: 'POST', body: JSON.stringify({ user_id: uid, ...payload }) }),
  // 写作 AI 批改:逐句 issue/tip + 总分 + 改进建议(LLM 三级降级,无 key 走本地规则;不写库)
  gradeWriting: (payload) =>
    request('/writing/grade', { method: 'POST', body: JSON.stringify(payload), signal: AbortSignal.timeout(20000) }),
  // 写作航行日志:最近 N 篇(分数/原文/规则明细)——第几篇、均分、趋势都从这里来
  historyWriting: (uid, limit = 30) => request(`/writing/history?user_id=${uid}&limit=${limit}`),
  // 翻译:有 ANTHROPIC/GEMINI key 走模型,无则降级(用词库已知词拼接近似)
  translate: (text, hint) =>
    request('/translate', { method: 'POST', body: JSON.stringify({ text, hint }) }),
  // AI 发音建议:传识别转写 + 原句(+可选目标音标),后端无 LLM key 时自动降级本地规则分析
  ask: (transcript, original, phoneme) =>
    request('/ask', { method: 'POST', body: JSON.stringify({ transcript, original, phoneme }) }),
  // AI 句法讲解:阅读舱的「句法透镜」用 — sentence 模式返回整句讲解;word 模式返回单词讲解
  explain: (payload) =>
    request('/explain', { method: 'POST', body: JSON.stringify(payload), signal: AbortSignal.timeout(20000) }),
  // 英语日记:中文起笔 → AI 逐句译英(后端 ANTHROPIC/GEMINI key);LLM 翻译较慢,放宽到 45s
  diaryTranslate: (sentences) =>
    request('/diary/translate', { method: 'POST', body: JSON.stringify({ sentences }), signal: AbortSignal.timeout(45000) }),
  diaryList: (uid) => request(`/users/${uid}/diary`),
  diaryAdd: (uid, zhText, enText) =>
    request(`/users/${uid}/diary`, { method: 'POST', body: JSON.stringify({ zh_text: zhText, en_text: enText }) }),
  diaryUpdate: (uid, id, enText) =>
    request(`/users/${uid}/diary/${id}`, { method: 'PATCH', body: JSON.stringify({ en_text: enText }) }),
  diaryDelete: (uid, id) =>
    request(`/users/${uid}/diary/${id}`, { method: 'DELETE' }),
}
