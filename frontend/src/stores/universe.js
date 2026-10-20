import { defineStore } from 'pinia'
import { api } from '../api'

// 三条学习航线(§12 学习模式设计):不重造轮子——每站都是既有领地的深链,
// 学习舱三幕流/星火问答/阅读号/回声谷/写作工坊原样复用,航线只负责"编队+导航"。
export const SESSION_MODES = {
  cruise: {
    zh: '快闪巡航', latin: 'QUICK CRUISE', minutes: 5,
    desc: '碎片时间的最小闭环——5 个新词加一轮快测,等车排队也能点亮几颗星。',
    stops: ['学 5 个新词', '快测一轮'],
  },
  route: {
    zh: '标准航线', latin: 'STANDARD ROUTE', minutes: 15,
    desc: '完整走一遍输入到记忆:新词三幕、一篇阅读、五分钟听力,趁热复习收尾。',
    stops: ['新词三幕', '阅读 1 篇', '听力短训', '复习收尾'],
  },
  expedition: {
    zh: '深空远征', latin: 'DEEP EXPEDITION', minutes: 40,
    desc: '深入一个词根家族,读长文做理解,再用今天的词造句输出——闭环走到底。',
    stops: ['词根分析', '阅读理解', '输出训练'],
  },
}

// 合法视图 key 全集(与 App.vue 的 VIEWS 表一一对应;setView 的白名单兜底用)
export const VALID_VIEWS = new Set([
  'dashboard', 'learn', 'lab', 'network', 'galaxy', 'phonetics', 'grammar',
  'listening', 'speaking', 'reading', 'tips', 'bookshelf', 'reader', 'family',
  'settings', 'collections', 'writing', 'diary', 'mistakes', 'site', 'lexicon',
])

// 模块统一命名(此前三个视图三套叫法:语法城/语法机械城、画像/观星台)
export const MODULE_LABELS = {
  galaxy: '词汇圣殿', phonetics: '发音舱', grammar: '语法机械城',
  listening: '回声谷', speaking: '口语竞技场', reading: '阅读号列车',
  writing: '写作工坊', diary: '英语日记', tips: '技巧库',
  bookshelf: '轨道书库', dashboard: '观星台', lab: '记忆工坊',
  network: '词汇网络', family: '词根群星', collections: '收藏夹',
  mistakes: '暗物质区', settings: '设置', learn: '学习舱', reader: '夜读舱',
}

// 知识数据缓存 + 用户态。星球状态单独管理以便复习后即时刷新。
export const useUniverse = defineStore('universe', {
  state: () => ({
    user: null,          // { id, username }
    view: 'site',        // 默认落官网首页(双场景开场);?view= 深链可直落任意领地
    words: [],           // 全部单词（知识库）
    states: {},          // word_id -> { strength, due, is_new, ... }
    rootStories: {},     // root -> { meaning, story, word_count }（/api/roots 的词源故事）
    phonemes: [],
    grammar: [],
    grammarStates: {},
    passages: [],
    stats: null,
    selectedWordId: null,
    reviewOpen: false,
    loaded: false,
    fetching: false,    // loadUniverse 进行中(进入/重置时视图用它显示 skeleton)
    tips: [],
    books: [],
    library: [],       // 轨道书库书树(/api/library;带 uid 时每章附 read 标记)
    roadmap: [],
    pairs: [],          // 最小对立体
    rules: [],          // 拼读规则
    phoneticStates: [], // 发音舱练习流水
    currentRoot: null,  // 词根家族侧边栏当前词根(null 显示词根索引)
    fromView: null,     // 跳进词根群星时的来源视图(FamilyView 返回按钮回这里;离开 family 即清)
    pendingTipId: null, // 从 Dashboard「今日一策」带进技巧库的推荐技巧 id
    pendingGrammarId: null, // 从错题本深链进机械城的语法点 id(视图挂载时消费置空)
    pendingPassage: null,   // 从错题本深链进听力/阅读/口语的语料 { mod, id }
    pendingWritingId: null, // 从错题本深链进写作工坊的低分文 id(WritingView 挂载时展开并置空)
    pendingBook: null,     // 从书库书签卡深链进夜读舱的书章节 { bookId, no }
    pendingLearnWordId: null, // 深链进学习舱的指定词 id(挂载时消费置空;null=按今日计划从头开)
    plan: null,             // 今日航线(后端 /api/plan:学 N 新词/复习 M 词/弱项加练;null=未加载或不可达)
    // 学习模式会话(§11/§12):{ mode:'cruise'|'route'|'expedition', steps, step, startedAt }
    // steps: [{ title, sub, nav:{ type:'learn'|'review'|'passage'|'family'|'view'|'end', ... } }]
    // 由 _buildSessionSteps 编排;HUD 底部仪表条负责展示与推进,切视图不会丢(store 持有)
    session: null,
    pendingLearnCount: null, // 航线「学 N 个新词」站的词数上限(学习舱 buildQueue 挂载时消费置空)
    settings: { theme: 'light', speechRate: 1.0 }, // 主题/语速等用户偏好(默认宣纸;深空/紫罗兰/暖夜在设置里可选)
    // 用户个性化档案(服务端持久化:{ goal, self_level, prefs },经 loadProfile/saveProfile 读写)
    profile: { goal: null, self_level: null, prefs: {} },
    // 今日挑战:星数统计 + 每日首次计星(localStorage 记日期,可重复挑战但当日只入账一次)
    challengeMode: false,
    challengeStars: 0,       // 累计获得的挑战星数
    challengeClaimedDate: '', // 最近一次入账星数的日期(YYYY-MM-DD)
    // 首课向导:不再是强制门槛,而是 Dashboard 推荐卡唤起的自愿浮层
    onboardingOpen: false,
    // Phase 4:收藏夹
    collections: [],          // [{ id, name, color, word_count, created_at }]
    currentCollectionId: null,
    collectionWords: [],       // 当前打开的收藏夹的词列表
    // 英语日记:[{ id, zh_text, en_text, created_at }](倒序,≤100)
    diary: [],
  }),

  getters: {
    // 时段问候:5-11 早安 / 11-13 午安 / 13-18 下午好 / 其余晚上好;有用户名则带名
    greeting() {
      const h = new Date().getHours()
      const period = h < 5 ? '夜深了' : h < 11 ? '早安' : h < 13 ? '午安' : h < 18 ? '下午好' : '晚上好'
      const name = this.user?.username
      return name ? `${period}，${name}` : period
    },
    // 学习目标转中文(未设定返回 null,view 自行决定兜底文案)
    goalLabel() {
      return ({
        exam: '你在为考试学英语',
        study: '你在为留学出国做准备',
        work: '你在为工作用英语',
        interest: '你在为兴趣学英语',
      })[this.profile.goal] || null
    },
    // 自评水平转中文描述(未设定返回 null)
    levelLabel() {
      return ({
        beginner: '刚入门，正从基础打牢',
        intermediate: '有底子了，在稳步进阶',
        advanced: '基础扎实，向高阶冲刺',
      })[this.profile.self_level] || null
    },
  },

  actions: {
    setUser(user) {
      this.user = user
      localStorage.setItem('wv_user', JSON.stringify(user))
      this.loadProfile() // 登录/注册成功后顺带拉档案(异步,失败静默保持默认)
    },

    async tryRestoreUser() {
      const raw = localStorage.getItem('wv_user')
      if (!raw) return null
      try {
        const u = JSON.parse(raw)
        // 一键启动时浏览器可能先于后端就绪:失败间隔 1s 重试,最多 3 次(覆盖后端慢启动窗口)
        let fresh
        for (let i = 0; ; i++) {
          try { fresh = await api.ensureUser(u.username); break }
          catch (e) {
            if (i >= 2) throw e
            await new Promise((r) => setTimeout(r, 1000))
          }
        }
        this.user = fresh
        return fresh
      } catch (e) {
        // 恢复失败会落到新手向导,这里留一条可见日志方便定位(CORS/代理/超时一眼可辨)
        console.warn('[WordPeak] 恢复用户失败:', e?.name, e?.message)
        return null
      }
    },

    // ---- 用户个性化档案 ----
    //
    // prefs 约定键名(后续 views 接入时请读写这些键,统一经 setPref(key, value) 落库;
    // prefs 本身是自由键值对,未列出的键也能存,但全站共用键请先在此登记):
    //   speechRate   number  0.5~1.5   TTS 语速(1.0 常速;发音舱/听力跟读用)。
    //                              读取优先 profile.prefs.speechRate,loadProfile 时会镜像进本地 settings
    //   listenLevel  number  1|2|3    听辨练习难度档(1 易 / 2 中 / 3 难,听力模块选材用)
    //   tipCategory  string  模块 key  「今日一策/技巧库」优先展示的分类(vocab/grammar/listening/speaking/phonetics/reading)
    //   theme        string  'dark'|'light'  界面主题(本地 settings.theme 对应的持久化位)
    //   desiredRetention number 0.85~0.95 FSRS 目标记忆保持率(复习排程目标线,SettingsView 可调;默认 0.9)
    //
    // 拉取档案(进应用时调用;无 user 时为安全空操作)
    async loadProfile() {
      if (!this.user) return
      try {
        const p = await api.getProfile(this.user.id)
        this.profile = { goal: p.goal ?? null, self_level: p.self_level ?? null, prefs: p.prefs ?? {} }
        // 已落库的语速优先于本地缓存的 settings.speechRate(档案为准)
        if (this.profile.prefs.speechRate != null) this.applySettings({ speechRate: this.profile.prefs.speechRate })
      } catch { /* 后端不可达时保持默认档案 */ }
    },

    // 乐观更新 + POST;成功后以服务端返回为准,失败回滚。返回是否成功。
    // patch: { goal?, self_level?, prefs? } — prefs 浅合并(只覆盖传入的键),goal/self_level 传 null 清空
    async saveProfile(patch) {
      if (!this.user) return false
      const prev = JSON.parse(JSON.stringify(this.profile))
      // 先本地乐观应用:goal/self_level 按传入覆盖,prefs 浅合并
      this.profile = {
        ...this.profile,
        ...('goal' in patch ? { goal: patch.goal ?? null } : {}),
        ...('self_level' in patch ? { self_level: patch.self_level ?? null } : {}),
        prefs: 'prefs' in patch && patch.prefs == null ? {} : { ...this.profile.prefs, ...(patch.prefs ?? {}) },
      }
      try {
        const p = await api.updateProfile(this.user.id, patch)
        this.profile = { goal: p.goal ?? null, self_level: p.self_level ?? null, prefs: p.prefs ?? {} }
        return true
      } catch {
        this.profile = prev // 请求失败 → 回滚乐观更新
        return false
      }
    },

    // 写单个界面偏好(更新 profile.prefs[key] 并持久化;语速同时镜像进本地 settings)
    setPref(key, value) {
      if (key === 'speechRate') this.applySettings({ speechRate: value })
      return this.saveProfile({ prefs: { [key]: value } })
    },

    // 合法视图 key 白名单(与 App.vue 的 VIEWS 表对齐):数据驱动入口(模块卡/今日航线/错题深链)
    // 一旦传入未知 key,这里兜回观星台,避免 VIEWS[undefined] 渲染整页空白
    setView(view) {
      this.view = VALID_VIEWS.has(view) ? view : 'dashboard'
      this.selectedWordId = null
      this.reviewOpen = false
      // fromView 只服务 FamilyView 的「真返回」:一旦去了别的领地就作废,
      // 别让下次从导航进 family 时返回指向早已无关的旧来源
      if (this.view !== 'family') this.fromView = null
    },
    // 跨视图「选词跳圣殿」统一出口:setView 会先清 selectedWordId,必须先跳后选。
    // 之前各处写成 selectWord→setView 反序,词面板/相机聚焦在落地瞬间被清掉,深链全部失效
    openWordInGalaxy(id) {
      this.setView('galaxy')
      this.selectedWordId = id
    },

    // 首课浮层(Dashboard「新手推荐」卡进入;Onboarding 内部随时可关,不强制)
    openOnboarding() { this.onboardingOpen = true },
    closeOnboarding() { this.onboardingOpen = false },

    // 拉取知识库 + 个人状态（进入宇宙时调用一次）
    async loadUniverse() {
      const { user } = this
      this.fetching = true
      try {
        const [words, phonemes, grammar, passages, tips, books, roadmap, pairs, rules, roots, library] = await Promise.all([
          api.words(), api.phonemes(), api.grammar(), api.passages(),
          api.tips(), api.books(), api.roadmap(), api.minimalPairs(), api.phonicsRules(),
          // 词源故事是非关键数据:失败时给空表降级,不让一个端点拖垮整个知识库加载
          api.roots().catch(() => []),
          // 轨道书库书树同属非关键数据(后端未装配时降级空表,书架显示空态)
          api.library(user ? user.id : 0).catch(() => []),
        ])
        let states = {}, gs = {}
        if (user) {
          const [s, g] = await Promise.all([api.wordStates(user.id), api.grammarStates(user.id)])
          states = Object.fromEntries(s.map((x) => [x.word_id, x]))
          gs = Object.fromEntries(g.map((x) => [x.point_id, x]))
        }
        this.words = words
        this.rootStories = Object.fromEntries(roots.map((r) => [r.root, r]))
        this.phonemes = phonemes
        this.grammar = grammar
        this.grammarStates = gs
        this.passages = passages
        this.states = states
        this.tips = tips
        this.books = books
        this.library = library?.books || []
        this.roadmap = roadmap
        this.pairs = pairs
        this.rules = rules
        this.loaded = true
      } finally {
        this.fetching = false
      }
    },

    // 轨道书库刷新(读完一章回书架时重拉 read 标记;失败保持旧树)
    async refreshLibrary() {
      if (!this.user) return
      try { this.library = (await api.library(this.user.id)).books || [] } catch { /* 静默降级 */ }
    },

    async refreshPhonetics() {
      if (!this.user) return
      this.phoneticStates = await api.phoneticsState(this.user.id)
    },

    async api_learnWord(wordId) {
      if (!this.user) return
      await api.learnWord(this.user.id, wordId)
      await this.refreshStates()
    },

    // 星火问答/学习舱自评(词卡内快问快答):走复习通道,答对答错都真实记入记忆调度;
    // selfGrade 三档自评优先(元认知),返回后端结果(记忆概率/下次间隔,反馈文案用)
    async api_submitReview(wordId, correct, responseMs, selfGrade) {
      if (!this.user) return null
      const r = await api.submitReview(this.user.id, wordId, correct, responseMs, selfGrade)
      await Promise.all([this.refreshStates(), this.refreshStats()])
      return r
    },

    async api_submitReading(passageId, correctCount, total) {
      if (!this.user) return
      await api.submitReading(this.user.id, passageId, correctCount, total)
    },

    async api_submitListening(passageId, correctCount, total) {
      if (!this.user) return
      await api.submitListening(this.user.id, passageId, correctCount, total)
    },

    async api_submitSpeaking(passageId, sentenceIndex, score, transcript) {
      if (!this.user) return
      await api.submitSpeaking(this.user.id, passageId, sentenceIndex, score, transcript)
    },

    // 写作工坊:payload = { stage, word_id?, score, text, feedback }
    async api_submitWriting(payload) {
      if (!this.user) return
      await api.submitWriting(this.user.id, payload)
      await this.refreshStats()
    },

    // modules 传模块 key 数组则只清对应模块(vocab/grammar/listening/speaking/phonetics/reading)
    async resetUserData(modules) {
      if (!this.user) return
      await api.resetUserData(this.user.id, modules)
      await this.loadUniverse()
      await Promise.all([this.refreshStats(), this.refreshPhonetics()])
    },

    async refreshStates() {
      if (!this.user) return
      const s = await api.wordStates(this.user.id)
      this.states = Object.fromEntries(s.map((x) => [x.word_id, x]))
    },

    async refreshStats() {
      if (!this.user) return
      this.stats = await api.stats(this.user.id)
    },

    // 语法答题提交后同步本地掌握度
    async submitGrammarApi(pointId, quizIndex, correct) {
      await api.submitGrammar(this.user.id, pointId, quizIndex, correct)
      const g = await api.grammarStates(this.user.id)
      this.grammarStates = Object.fromEntries(g.map((x) => [x.point_id, x]))
    },

    selectWord(id) { this.selectedWordId = id },
    openReview() { this.challengeMode = false; this.reviewOpen = true },
    openChallenge() { this.challengeMode = true; this.selectedWordId = null; this.reviewOpen = true },
    closeReview() {
      this.reviewOpen = false
      this.challengeMode = false
      this.refreshStates()
      this.refreshStats()
    },

    // 进入收藏夹视图时拉一次列表
    enterCollections() {
      this.loadCollections()
      this.setView('collections')
    },

    // ---- 今日挑战:星数入账(当日仅首次),localStorage 记日期 ----
    loadChallengeStars() {
      try {
        const raw = JSON.parse(localStorage.getItem('wv_challenge_stars') || '{}')
        this.challengeStars = raw.stars || 0
        this.challengeClaimedDate = raw.date || ''
      } catch { /* 忽略 */ }
    },
    claimChallengeStars(n) {
      const today = new Date().toLocaleDateString('sv') // YYYY-MM-DD(本地时区)
      if (n <= 0 || this.challengeClaimedDate === today) return false
      this.challengeStars += n
      this.challengeClaimedDate = today
      try { localStorage.setItem('wv_challenge_stars', JSON.stringify({ stars: this.challengeStars, date: today })) } catch { /* 隐私模式 */ }
      return true
    },

    // 进词根家族:记下来源视图(返回按钮回这里),并统一走 setView
    // (此前直接 this.view = 赋值,绕过 selectedWordId/复习层清理,导航语义分裂)
    openFamily(root) {
      if (this.view !== 'family') this.fromView = this.view // 家族内换词根不覆盖原来源
      this.currentRoot = root
      this.setView('family')
      this.currentRoot = root
    },
    backToFamilyIndex() {
      if (this.view !== 'family') this.fromView = this.view
      this.currentRoot = null
      this.setView('family')
    },

    // ---- 今日航线(/api/plan:档案 + due 队列 + 弱项 → 当日学习计划) ----
    // Dashboard 今日航线卡 / 学习舱新词来源 / DailyQuests 个性化目标共用;失败置 null 各自降级
    async loadPlan() {
      if (!this.user) return null
      try {
        this.plan = await api.plan(this.user.id)
      } catch {
        this.plan = null // 后端不可达:调用方降级到固定目标,不出空卡
      }
      return this.plan
    },

    // 学习舱深链:openLearn() 进舱从头开;openLearn(wordId) 落到指定词(词卡/家族页跳进来);
    // openLearn(null, count) 由航线发起——学 count 个就走(三幕流队列上限)
    openLearn(wordId = null, count = null) {
      this.pendingLearnWordId = wordId
      this.pendingLearnCount = wordId ? null : count
      this.setView('learn')
    },
    clearPendingLearnWord() { this.pendingLearnWordId = null },
    clearPendingLearnCount() { this.pendingLearnCount = null },

    // ---- 学习模式:航线会话编排(§11 降低选择门槛 / §12 三档时长) ----
    // 每站走既有深链管道,不新建视图;站与站之间由用户自定步调(HUD「下一站」)。
    _dayIndex() {
      const d = new Date()
      return d.getFullYear() * 1000 + (d.getMonth() + 1) * 40 + d.getDate()
    },
    // 按档位选语料:同级池子按"日序号取模"轮换——同一天稳定,每天换一篇
    _pickPassage(type, levels) {
      const all = this.passages || []
      const withQ = all.filter((p) => p.type === type && (p.questions?.length || 0) > 0)
      const pool = withQ.filter((p) => levels.includes(p.level))
      const src = pool.length ? pool : withQ
      return src.length ? src[this._dayIndex() % src.length] : null
    },
    // 远征首站词根:未学词最多的家族(优先有词源故事的)——从根上补词汇量
    _pickExpeditionRoot() {
      const cnt = {}
      for (const w of this.words) {
        if (!w.root) continue
        const unlearned = this.states[w.id] && !this.states[w.id].is_new ? 0 : 1
        cnt[w.root] = (cnt[w.root] || 0) + unlearned
      }
      const ranked = Object.entries(cnt).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1])
      const withStory = ranked.find(([r]) => this.rootStories[r])
      return (withStory || ranked[0] || [null])[0]
    },
    _buildSessionSteps(mode) {
      const planN = this.plan?.new_words?.count || 8
      let steps = []
      if (mode === 'cruise') {
        steps = [
          { title: '学 5 个新词', sub: '三幕流 · 编码 → 回忆 → 巩固', nav: { type: 'learn', count: 5 } },
          { title: '快测一轮', sub: '星火问答 · 到期词优先', nav: { type: 'review' } },
        ]
      } else if (mode === 'route') {
        const reading = this._pickPassage('reading', [1, 2])
        const listening = this._pickPassage('listening', [1, 2])
        steps = [{ title: `学 ${planN} 个新词`, sub: '三幕流 · 来自你的今日航线', nav: { type: 'learn', count: planN } }]
        if (reading) steps.push({ title: '阅读 1 篇', sub: reading.title, nav: { type: 'passage', mod: 'reading', id: reading.id } })
        if (listening) steps.push({ title: '听力短训', sub: listening.title, nav: { type: 'passage', mod: 'listening', id: listening.id } })
        steps.push({ title: '复习收尾', sub: '趁热巩固 · FSRS 到期词', nav: { type: 'review' } })
      } else {
        const root = this._pickExpeditionRoot()
        const reading = this._pickPassage('reading', [3, 4])
        const story = this.rootStories[root]
        steps = []
        if (root) steps.push({ title: `词根分析 · ${root}`, sub: story?.meaning || '从词根家族吃透一串词', nav: { type: 'family', root } })
        if (reading) steps.push({ title: '阅读理解', sub: reading.title, nav: { type: 'passage', mod: 'reading', id: reading.id } })
        steps.push({ title: '输出训练', sub: '写作工坊 · 用今天的词造句', nav: { type: 'view', view: 'writing' } })
      }
      // 尾站统一返航观星台;数据不可达导致空编队时至少给返航站
      steps.push({ title: '返航', sub: '回观星台收工', nav: { type: 'end' } })
      return steps.map((s, i) => ({ ...s, no: String(i + 1).padStart(2, '0') }))
    },
    startSession(mode) {
      if (!SESSION_MODES[mode]) return
      const steps = this._buildSessionSteps(mode)
      this.session = { mode, steps, step: 0, startedAt: Date.now() }
      this._sessionNavigate(steps[0])
    },
    _sessionNavigate(step) {
      const n = step?.nav || {}
      if (n.type === 'learn') this.openLearn(null, n.count)
      else if (n.type === 'review') this.openReview()
      else if (n.type === 'passage') { this.pendingPassage = { mod: n.mod, id: n.id }; this.setView(n.mod) }
      else if (n.type === 'family') this.openFamily(n.root)
      else if (n.type === 'view') this.setView(n.view)
      else this.setView('dashboard') // end / 兜底
    },
    // 跳到第 i 站(只能前进或原地重进;返航站之后由 sessionNext 收尾)
    sessionGo(i) {
      if (!this.session || !Number.isInteger(i) || i < 0 || i >= this.session.steps.length) return
      this.session.step = i
      this._sessionNavigate(this.session.steps[i])
    },
    sessionNext() {
      if (!this.session) return null
      const next = this.session.step + 1
      if (next >= this.session.steps.length) return this.sessionFinish()
      this.sessionGo(next)
      return null
    },
    // 走完全程:写航行日志(wv_sessions,观星台航线回顾用),返回用时分钟数
    sessionFinish() {
      if (!this.session) return null
      const s = this.session
      this.session = null
      const minutes = Math.max(1, Math.round((Date.now() - s.startedAt) / 60000))
      try {
        const raw = JSON.parse(localStorage.getItem('wv_sessions') || '[]')
        raw.push({ date: new Date().toLocaleDateString('sv'), mode: s.mode, minutes })
        localStorage.setItem('wv_sessions', JSON.stringify(raw.slice(-200)))
      } catch { /* 隐私模式 */ }
      return minutes
    },
    // 提前返航(HUD 二次确认后)
    sessionEnd() { this.session = null },

    // ---- 词汇网络:全库词共现图谱,缓存 + 用户态注入 ----
    network: { nodes: [], edges: [], meta: {}, loading: false, loadedAt: 0 },
    async loadNetwork(force = false) {
      if (!this.user) return null
      // 60s 内复用内存缓存(节点含 retrievability,会随复习过期——按时刷)
      const fresh = this.network.loadedAt && (Date.now() - this.network.loadedAt < 60_000) && this.network.nodes.length
      if (fresh && !force) return this.network
      this.network.loading = true
      try {
        const r = await api.wordNetwork(this.user.id)
        this.network = { nodes: r.nodes, edges: r.edges, meta: r.meta, loading: false, loadedAt: Date.now() }
      } catch {
        this.network.loading = false
      }
      return this.network
    },
    openNetwork() { this.setView('network') },

    // ---- Phase 4:收藏夹 ----
    async loadCollections() {
      if (!this.user) return
      try {
        this.collections = await api.collections(this.user.id)
      } catch { /* 离线时保留空 */ }
    },
    async createCollection(name, color = 'accent') {
      if (!this.user) return null
      try {
        const c = await api.createCollection(this.user.id, name, color)
        await this.loadCollections()
        return c
      } catch (e) {
        window.dispatchEvent(new CustomEvent('wv:toast-error', { detail: e.message || '创建失败' }))
        return null
      }
    },
    async deleteCollection(cid) {
      if (!this.user) return
      try { await api.deleteCollection(this.user.id, cid) } catch {}
      if (this.currentCollectionId === cid) this.currentCollectionId = null
      await this.loadCollections()
    },
    async openCollection(cid) {
      this.currentCollectionId = cid
      this.collectionWords = []
      if (!cid || !this.user) return
      try {
        this.collectionWords = await api.collectionWords(this.user.id, cid)
      } catch {}
      this.setView('collections')
    },
    async addToCollection(cid, wordIds) {
      if (!this.user || !Array.isArray(wordIds) || !wordIds.length) return
      try {
        const r = await api.addToCollection(this.user.id, cid, wordIds)
        await this.loadCollections() // 刷新 word_count
        return r
      } catch (e) {
        window.dispatchEvent(new CustomEvent('wv:toast-error', { detail: e.message || '加入失败' }))
      }
    },
    async removeFromCollection(cid, wid) {
      if (!this.user) return
      try { await api.removeFromCollection(this.user.id, cid, wid) } catch {}
      if (this.currentCollectionId === cid) {
        this.collectionWords = this.collectionWords.filter((w) => w.id !== wid)
      }
      await this.loadCollections()
    },
    // ---- 英语日记:中文起笔 → AI 译英 → 逐句带读 ----
    async loadDiary() {
      if (!this.user) return
      try {
        this.diary = await api.diaryList(this.user.id)
      } catch { /* 离线时保留旧列表 */ }
    },
    async createDiary(zhText, enText) {
      if (!this.user) return null
      try {
        const entry = await api.diaryAdd(this.user.id, zhText, enText)
        await this.loadDiary()
        return entry
      } catch (e) {
        window.dispatchEvent(new CustomEvent('wv:toast-error', { detail: e.message || '保存失败' }))
        return null
      }
    },
    async updateDiary(id, enText) {
      if (!this.user) return false
      try {
        const entry = await api.diaryUpdate(this.user.id, id, enText)
        const i = this.diary.findIndex((d) => d.id === id)
        if (i >= 0) this.diary[i] = entry
        return true
      } catch (e) {
        window.dispatchEvent(new CustomEvent('wv:toast-error', { detail: e.message || '更新失败' }))
        return false
      }
    },
    // 删除失败(后端不可达)保留本地条目并返回 false——此前吞错仍删本地,
    // 视图报"已删除",刷新后日记复活;现在由视图按返回值给真实反馈
    async removeDiary(id) {
      if (!this.user) return false
      try {
        await api.diaryDelete(this.user.id, id)
        this.diary = this.diary.filter((d) => d.id !== id)
        return true
      } catch (e) {
        window.dispatchEvent(new CustomEvent('wv:toast-error', { detail: e.message || '删除失败' }))
        return false
      }
    },

    // 导出收藏夹(纯前端,从已加载的 store.words 富化):JSON 完整 / CSV 通用表格 / Anki TSV 桌面 Anki 直接导入
    // 返回三种格式的 payload(words 已是富化后的完整对象,带 word/ipa/meaning/root/root_meaning/etymology/collocations/examples)
    async exportCollection(cid) {
      const col = this.collections.find((c) => c.id === cid)
      if (!col || !this.user) return null
      // 当前已打开的夹直接用缓存词表;没打开的现拉一次,不再退到"按词根名猜"或全库导出
      let words = (this.currentCollectionId === cid && this.collectionWords.length)
        ? this.collectionWords
        : await api.collectionWords(this.user.id, cid).catch(() => [])
      if (!words.length) return null
      return {
        collection: { name: col.name, color: col.color, exported_at: new Date().toISOString() },
        words,
      }
    },

    // 「今日一策」深化:带上技巧 id 跳到技巧库,由 TipsView 生成推荐理由
    openTipRecommend(tip) {
      this.pendingTipId = tip?.id ?? null
      this.setView('tips')
    },
    clearPendingTip() { this.pendingTipId = null },

    applySettings(patch) {
      this.settings = { ...this.settings, ...patch }
      try { localStorage.setItem('wv_settings', JSON.stringify(this.settings)) } catch { /* 忽略 */ }
    },
    loadSettings() {
      try {
        const raw = localStorage.getItem('wv_settings')
        if (raw) this.settings = { ...this.settings, ...JSON.parse(raw) }
      } catch { /* 忽略 */ }
    },
  },
})
