-- ============================================================================
-- 词峰 WORDPEAK · 完整建表 SQL（SQLite 版）
-- ============================================================================
-- 用法（二选一）：
--   1. 手动建库：sqlite3 wordverse.db < schema.sql
--   2. 什么都不做：`node server.js` 启动时 initDb() 会执行同一份 DDL 并自动
--      灌入 data/*.json 种子数据（幂等，可重复执行，不会重复插入）。
--
-- 与 backend-node/src/db.js 中 DDL_SQLITE 保持一致；任何改动请同步两处。
-- 时间约定：created_at 等时间列为本地时区 ISO 文本（无 Z 后缀），UTC 秒级。
-- ============================================================================

PRAGMA journal_mode = WAL;             -- 并发读写更稳
PRAGMA foreign_keys = ON;              -- 开启外键约束(默认关闭)

-- ----------------------------------------------------------------------------
-- users · 用户（唯一的"人"表，所有学习数据都挂在 user_id 上）
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,  -- 用户 id（前端 localStorage wv_user 存的就是它）
  username    TEXT UNIQUE NOT NULL,              -- 用户名（按名查找或创建，同名即同一人）
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%S','now')),  -- 注册时间
  goal        TEXT,   -- 学习目标：exam 考试 / study 留学 / work 工作 / interest 兴趣（可空=没选）
  self_level  TEXT,   -- 自评水平：beginner / intermediate / advanced（可空）
  prefs       TEXT    -- 偏好 JSON：{"speechRate":1.0,"listenLevel":2,"tipCategory":"vocab","theme":"dark"}
);

-- ----------------------------------------------------------------------------
-- words · 单词知识库（461 词，seed 自 data/words.json，星球的数据源）
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS words (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  word          TEXT UNIQUE NOT NULL,   -- 单词本身（唯一键，种子按它去重）
  ipa           TEXT NOT NULL,          -- 国际音标，如 /spekt/
  pos           TEXT NOT NULL,          -- 词性，如 v. / n.
  meaning       TEXT NOT NULL,          -- 中文释义
  root          TEXT NOT NULL,         -- 所属词根，如 spect（星系分组依据）
  root_meaning  TEXT NOT NULL,         -- 词根义，如"看"
  etymology     TEXT NOT NULL,          -- 词源故事（词卡展示）
  collocations  TEXT NOT NULL DEFAULT '[]',  -- 高频搭配 JSON：[{"en":"...","zh":"..."}]
  examples      TEXT NOT NULL DEFAULT '[]',  -- 例句 JSON：[{"en":"...","zh":"..."}]
  family        TEXT NOT NULL,          -- 家族名（3D 星系按 family 聚簇）
  level         INTEGER NOT NULL DEFAULT 1    -- 难度 1-3
);
CREATE INDEX IF NOT EXISTS ix_words_root    ON words(root);      -- 家族页/词根故事按词根查
CREATE INDEX IF NOT EXISTS ix_words_family  ON words(family);    -- 家族词列表查询

-- ----------------------------------------------------------------------------
-- phonemes · 48 国际音标（seed 自 data/phonemes.json，发音舱用）
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS phonemes (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol        TEXT UNIQUE NOT NULL,    -- 音标符号，如 /iː/（唯一键）
  type          TEXT NOT NULL,          -- vowel 元音 / consonant 辅音
  name          TEXT NOT NULL,          -- 名称，如"长元音"
  voiced        INTEGER NOT NULL DEFAULT 1,  -- 浊音 1 / 清音 0（口腔剖面声带动画）
  tip           TEXT NOT NULL,          -- 发音要领（AI 建议的音标提示也读这列）
  similar       TEXT NOT NULL DEFAULT '[]',  -- 易混音标 JSON：["ɪ","e"]
  example_words TEXT NOT NULL DEFAULT '[]',  -- 词例 JSON：[{"en":"see","zh":"看见","ipa":"/siː/"}]
  level         INTEGER NOT NULL DEFAULT 1
);

-- ----------------------------------------------------------------------------
-- grammar_points · 语法点（seed 自 data/grammar.json，21 点 × 9 题）
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS grammar_points (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT UNIQUE NOT NULL,   -- 语法点标题（唯一键；quiz 有变化时种子会 UPDATE）
  category    TEXT NOT NULL,          -- 分类：句型/时态/从句/非谓语/虚拟 等
  formula     TEXT NOT NULL,          -- 一句话公式，如"主 + will + 动原"
  explanation TEXT NOT NULL,          -- 讲解正文
  examples    TEXT NOT NULL DEFAULT '[]',  -- 例句 JSON
  machine     TEXT NOT NULL DEFAULT '{}',  -- 机械装配零件 JSON：{"parts":[{"label":"主语","value":"I"}]}
  quiz        TEXT NOT NULL DEFAULT '[]'   -- 题库 JSON：[{question,options[4],answer,explain}]
);

-- ----------------------------------------------------------------------------
-- passages · 分级语料（seed 自 data/passages.json，听力/口语/阅读共用）
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS passages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  title      TEXT NOT NULL,           -- 篇名
  level      INTEGER NOT NULL DEFAULT 1,   -- 难度 1-3
  type       TEXT NOT NULL,           -- listening / speaking / reading
  sentences  TEXT NOT NULL DEFAULT '[]',   -- 句子 JSON：[{"en":"...","zh":"..."}]
  questions  TEXT NOT NULL DEFAULT '[]'    -- 理解题 JSON：[{q,options,answer,explain}]
);

-- ----------------------------------------------------------------------------
-- user_words · SM-2 间隔重复状态（核心学习数据：每个单词星球的"记忆强度"）
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_words (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id          INTEGER NOT NULL REFERENCES users(id),   -- 所属用户
  word_id          INTEGER NOT NULL REFERENCES words(id),  -- 对应单词
  repetitions      INTEGER NOT NULL DEFAULT 0,    -- SM-2 连续答对次数
  ease             REAL NOT NULL DEFAULT 2.5,     -- SM-2 难度系数（1.3-2.8）
  interval_days     REAL NOT NULL DEFAULT 0,       -- 当前复习间隔（天）
  lapses           INTEGER NOT NULL DEFAULT 0,    -- 遗忘次数
  peak_strength     REAL NOT NULL DEFAULT 0,       -- 历史峰值强度（0-1）
  first_learned_at  TEXT,                          -- 首次学习时间（空 = 还没学过）
  last_review_at   TEXT,                          -- 最近复习时间
  due_at           TEXT,                          -- 下次到期时间（复习队列按它取）
  UNIQUE(user_id, word_id)                        -- 每人每词一条
);
CREATE INDEX IF NOT EXISTS ix_user_words_user ON user_words(user_id);

-- ----------------------------------------------------------------------------
-- grammar_results · 语法答题流水（每次答一题插一条）
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS grammar_results (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  point_id    INTEGER NOT NULL REFERENCES grammar_points(id),  -- 语法点
  quiz_index  INTEGER NOT NULL,   -- 第几题（0 起）
  correct     INTEGER NOT NULL,   -- 对 1 / 错 0
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%S','now'))
);
CREATE INDEX IF NOT EXISTS ix_grammar_results_user ON grammar_results(user_id);

-- ----------------------------------------------------------------------------
-- listening_results · 听力答题结果（每篇一条）
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS listening_results (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(id),
  passage_id    INTEGER NOT NULL REFERENCES passages(id),
  correct_count INTEGER NOT NULL,   -- 答对题数
  total         INTEGER NOT NULL,   -- 总题数
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%S','now'))
);
CREATE INDEX IF NOT EXISTS ix_listening_results_user ON listening_results(user_id);

-- ----------------------------------------------------------------------------
-- speaking_results · 口语跟读结果（每句一条，含识别转写）
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS speaking_results (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id        INTEGER NOT NULL REFERENCES users(id),
  passage_id     INTEGER NOT NULL REFERENCES passages(id),
  sentence_index INTEGER NOT NULL,        -- 第几句（0 起）
  score          REAL NOT NULL,           -- 逐词命中得分（0-1）
  transcript     TEXT NOT NULL DEFAULT '', -- 语音识别转写原文
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%S','now'))
);
CREATE INDEX IF NOT EXISTS ix_speaking_results_user ON speaking_results(user_id);

-- ----------------------------------------------------------------------------
-- activity_events · 每日活动聚合（学习画像的热力图/周报/连击统计源）
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS activity_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  date        TEXT NOT NULL,          -- 日期 YYYY-MM-DD（按天聚合）
  module      TEXT NOT NULL,          -- vocab/grammar/listening/speaking/phonetics/reading
  correct     INTEGER NOT NULL,       -- 当次答对数
  total       INTEGER NOT NULL,        -- 当次总数
  word_id     INTEGER REFERENCES words(id),  -- 关联单词（可空；词汇模块答题会带）
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%S','now'))
);
CREATE INDEX IF NOT EXISTS ix_activity_user   ON activity_events(user_id);
CREATE INDEX IF NOT EXISTS ix_activity_date   ON activity_events(date);
CREATE INDEX IF NOT EXISTS ix_activity_module ON activity_events(module);

-- ----------------------------------------------------------------------------
-- phonetic_results · 发音舱练习流水
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS phonetic_results (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  kind        TEXT NOT NULL,             -- pair 最小对立体听辨 / phoneme 单音跟读 / rule 拼读规则
  ref_id      TEXT NOT NULL DEFAULT '',   -- 对应条目 id（如音标符号 / 对立 id / 规则 id）
  correct     INTEGER NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%S','now'))
);
CREATE INDEX IF NOT EXISTS ix_phonetic_results_user ON phonetic_results(user_id);

-- ----------------------------------------------------------------------------
-- reading_results · 阅读理解结果（每篇一条）
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reading_results (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(id),
  passage_id    INTEGER NOT NULL REFERENCES passages(id),
  correct_count INTEGER NOT NULL,
  total         INTEGER NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%S','now'))
);
CREATE INDEX IF NOT EXISTS ix_reading_results_user ON reading_results(user_id);

-- ----------------------------------------------------------------------------
-- collections · 生词本（收藏夹）
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS collections (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,  -- 删用户连带删收藏夹
  name        TEXT NOT NULL,               -- 收藏夹名
  color       TEXT NOT NULL DEFAULT 'accent', -- 前端配色 token：accent/success/warn/danger/info
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%S','now')),
  UNIQUE(user_id, name)                    -- 每人每名一条
);

-- ----------------------------------------------------------------------------
-- collection_words · 收藏夹-单词关联表
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS collection_words (
  collection_id  INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,  -- 删夹连带删词
  word_id        INTEGER NOT NULL REFERENCES words(id) ON DELETE CASCADE,
  added_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%S','now')),
  PRIMARY KEY (collection_id, word_id)   -- 联合主键，天然防重
);
CREATE INDEX IF NOT EXISTS ix_collection_words_word ON collection_words(word_id);

-- ----------------------------------------------------------------------------
-- diary_entries · 英语日记（中文原文 + AI 英文译文，逐句带读在前端切分）
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS diary_entries (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,  -- 删用户连带删日记
  zh_text     TEXT NOT NULL,                     -- 中文原文
  en_text     TEXT NOT NULL,                     -- AI 译文（可手动修正）
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%S','now'))
);
CREATE INDEX IF NOT EXISTS ix_diary_user ON diary_entries(user_id, created_at);

-- ============================================================================
-- 兼容迁移：老库 users 表没有档案列（CREATE IF NOT EXISTS 不会补）
-- initDb() 启动时逐列补齐；手动执行时列已存在会报错，忽略即可。
-- ============================================================================
-- ALTER TABLE users ADD COLUMN goal TEXT;
-- ALTER TABLE users ADD COLUMN self_level TEXT;
-- ALTER TABLE users ADD COLUMN prefs TEXT;
