# 词峰 WORDPEAK · 3D 沉浸式英语学习宇宙

> 边玩边学、全能力覆盖、真学习科学驱动的英语学习世界。前后端分离。

## 它是什么

一个运行在浏览器里的 3D 英语学习宇宙。英语知识的**内在结构被直接映射成 3D 空间**：
单词是星球、词根是星系、记忆遗忘是星球光线的衰减、语法是机械齿轮、音标是可拆解的口腔剖面。
不是"给背单词软件换 3D 皮肤"，而是让知识体系本身立体化。

## 六大知识模块

| 模块 | 场景形态 | 学习内容 |
|---|---|---|
| 🪐 词汇星系 | 单词星球 + 词根引力网络 | 词义、音标、词根词缀、词源故事、搭配、例句 |
| 👄 发音舱 | 动态口腔矢状面剖面图 | 48 国际音标、舌位唇形、声带振动、最小对立体 |
| ⚙️ 语法机械城 | 齿轮机械 + 传送带闯关 | 句子结构、时态语态、三大从句、非谓语等 15+ 语法点 |
| 🌊 听力峡谷 | 语料朗读 + 理解闯关 | 分级语料、语速可调、精听训练 |
| 🎭 口语竞技场 | 情景句跟读 + 语音识别打分 | 逐词比对、发音得分、弱项定位 |
| 📖 阅读号列车 | 剧情语料 + 点词即学 | 分级短文、理解题、生词自动进入星系 |
| 📔 英语日记 | 中文起笔 + AI 译英 | 逐句对照、逐句带读 + 跟读打分、历史回读 |

## 学习方法论引擎（世界背后的真引擎）

1. **SM-2 间隔重复算法** —— 每个单词星球的亮度由记忆强度实时驱动：刚学会时明亮，
   随艾宾浩斯遗忘曲线衰减而变暗，即将遗忘时发出红色求救光，复习即"充能巡航"。
2. **词根词缀联想网络** —— 单词按词根家族聚成星系（spect- 家族、port- 家族……），
   记一个词根 = 点亮一串星球，学的是网络而不是列表。
3. **i+1 可理解输入** —— 语料按难度分级，系统根据你的答题表现推送"刚好够得着"的内容。
4. **错题流动系统** —— 语法错题、听力错题、生词全部进入错题档案，跟踪到连续答对才"结案"。
5. **费曼输出法** —— 口语跟读与造句输出驱动输入，输出模块的正确率反哺词汇推送策略。
6. **学习画像** —— 词汇量增长曲线、最弱词根家族、各模块正确率、记忆强度分布全部可视化。

## 技术架构（前后端分离）

```
┌─ frontend/  Vue 3 + Vite + 原生 three.js
│   ├─ 3D 星系场景引擎（WebGL 星球/星空/光照 + CSS2D 词根标签/交互）
│   ├─ 发音舱：音标解剖 / 最小对立体听辨 / 拼读规则 / 48 音标掌握度热力图
│   ├─ 阅读号列车：分级短文 · 点词即学(生词自动进复习队列)
│   ├─ 书籍馆(20 本书+四步路线) + 技巧库(48 条来自书单)
│   ├─ Web Speech API：语音合成(听力/发音) + 语音识别(口语/跟读打分)
│   └─ Pinia 状态管理 + Naive UI 暗色主题组件，REST 与后端通信
│
└─ backend-node/  Express 5 + node:sqlite (零依赖,内置)
    ├─ 50+ API 端点：词汇星系/复习 SM-2/语法机械城/听阅说/发音/阅读/学习画像
    ├─ 知识库：1662 词根词 + 36006 全量词库/40 词根/48 音标/21 语法(每点 9 题)/129 语料/20 书单/48 技巧
    └─ 响应壳与旧 FastAPI 版完全一致，前端零修改可换
```

## 快速启动

**日常使用**:双击 `词峰一键启动.bat` —— 单进程自动构建并同源提供页面与 API,就绪后自动打开浏览器(5173 被占会顺延到 5174~5183,脚本打开实际端口)。

**停止服务**:双击 `词峰一键停止.bat` —— 按 `.server.pid` 精确停止,并兜底清理 5173~5183 与 8000 的残留监听。

**开发模式**:双击 `词峰开发模式.bat` —— 后端 8000 + Vite 热更新 5173;Vite 严格占用 5173,被占会直接报错而不是静默漂移。

手动启动(等价于开发模式,两个终端分别运行):

```bash
# 终端 1:后端(端口 8000)
cd backend-node
npm install
node server.js

# 终端 2:前端(端口 5173)
cd frontend
npm install
npm run dev
```

打开 http://localhost:5173 即可进入词峰宇宙。

**AI 功能(可选)**:英语日记的中文→英文翻译、发音 AI 建议需要 LLM key —— 复制 `backend-node/.env.example` 为 `backend-node/.env`,填入 `ANTHROPIC_API_KEY` 或 `GEMINI_API_KEY`(走中转时再配 `ANTHROPIC_BASE_URL`),重启后端生效;不配也能用其余全部功能。

## 内容数据

所有内容数据(JSON 种子)均在 `backend-node/data/`:

**数据库表结构**:完整建表 SQL(带逐列中文注释)在 [docs/schema.sql](docs/schema.sql)(SQLite)/ [docs/schema-mysql.sql](docs/schema-mysql.sql)(MySQL);正常启动无需手动建表,`initDb()` 会自动执行同一份 DDL 并灌入种子。**切到 MySQL**:在 `backend-node/.env` 配 `WORDPEAK_DB=mysql` 与 `WORDPEAK_MYSQL_*`(模板见 `.env.example`,先建 utf8mb4 库),启动即自动建表灌种子;老 SQLite 数据用 `node scripts/migrate_sqlite_to_mysql.mjs` 一键迁移(外键按词串重映射,幂等)。

| 文件 | 条目 | 说明 |
|---|---|---|
| `words.json` | 1662 词 | 40 个词根家族(词峰的 3D 星系) |
| `lexicon.json` | 36006 词 | 五源开源词表并集(`family='general'`,全量词库视图可检索) |
| `root_stories.json` | 40 | 每个词根的故事 + 记忆钩子 |
| `phonemes.json` | 48 | 全部国际音标(发音方式/示例词/易混音) |
| `grammar.json` | 21 点 × 9 题 | 189 道闯关题(每点左页讲解+右页验收) |
| `passages.json` | 26 篇 | 听力 / 阅读 / 口语分级语料,句中含词库词可点词即学 |
| `tips.json` | 48 条 | 来自 20 本书的实战技巧,按 6 类分组 |
| `books.json` | 20 本 | 完整书单 + 每本在词峰对应练法 |
| `roadmap.json` | 4 步 | 音标关→框架关→输入关→输出关 |
| `minimal_pairs.json` | 18 对 | Ship or Sheep 式听辨训练(分 3 级难度) |
| `phonics_rules.json` | 14 条 | 拼读规则 + 配套 quiz(看到生词能读) |

书单内容参考自 `C:\Users\MECHREVO\Desktop\英语学习书单.html`,并按学习场景转化为功能。

`lexicon.json` 由 `backend-node/scripts/build_lexicon.py` 从五个开源词表生成,释义/音标/搭配/例句以 ECDICT 为主、其余词表补全:
[KyleBing/english-vocabulary](https://github.com/KyleBing/english-vocabulary)、
[mahavivo/english-wordlists](https://github.com/mahavivo/english-wordlists)、
[skywind3000/ECDICT](https://github.com/skywind3000/ECDICT)、
[kajweb/dict](https://github.com/kajweb/dict)、
[fanhongtao/IELTS](https://github.com/fanhongtao/IELTS)。

## API 契约

详见 [docs/API.md](docs/API.md)。

## 路线图

- [x] v1：词汇星系 + SM-2 引擎 + 发音舱 + 语法城 + 听/口语 + 学习画像
- [ ] v1.1：写作工坊（造句→成文，自动批改）、生词本导出
- [ ] v1.2：多人对战排位、每日任务、成就系统
- [ ] v1.3：AI 情景对话（接入 LLM）、语音精确评分（音素级）
