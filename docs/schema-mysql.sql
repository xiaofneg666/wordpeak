-- ============================================================================
-- 词峰 WORDPEAK · 完整建表 SQL（MySQL 8.x 版）
-- ============================================================================
-- 用法：
--   1. 建库：CREATE DATABASE wordverse DEFAULT CHARSET utf8mb4 COLLATE utf8mb4_general_ci;
--   2. 建表：mysql -u<user> -p wordverse < schema-mysql.sql
--   3. 启动后端（环境变量指明 MySQL 连接）：
--      WORDVERSE_DB=mysql \
--      MYSQL_HOST=127.0.0.1 MYSQL_PORT=3306 MYSQL_USER=root MYSQL_PASSWORD=xxx MYSQL_DATABASE=wordverse \
--      node server.js
--      initDb() 会执行同一份 DDL（已建表则跳过）并自动灌入 data/*.json 种子。
--
-- 与 backend-node/src/db.js 中 DDL_MYSQL 保持一致；任何改动请同步两处。
-- 时间约定：DATETIME 一律存 UTC（UTC_TIMESTAMP()），DAO 层已做格式归一。
-- ============================================================================

-- ----------------------------------------------------------------------------
-- users · 用户
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id          INT PRIMARY KEY AUTO_INCREMENT              COMMENT '用户 id',
  username    VARCHAR(191) UNIQUE NOT NULL                 COMMENT '用户名（按名查找或创建）',
  created_at  DATETIME NOT NULL DEFAULT (UTC_TIMESTAMP()) COMMENT '注册时间(UTC)',
  goal        VARCHAR(64) NULL                           COMMENT '学习目标 exam/study/work/interest',
  self_level  VARCHAR(64) NULL                           COMMENT '自评水平 beginner/intermediate/advanced',
  prefs       TEXT NULL                                  COMMENT '偏好 JSON(speechRate/listenLevel/theme 等)'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ----------------------------------------------------------------------------
-- words · 单词知识库（星球数据源）
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS words (
  id            INT PRIMARY KEY AUTO_INCREMENT               COMMENT '单词 id',
  word          VARCHAR(191) UNIQUE NOT NULL                COMMENT '单词（唯一，种子按它去重）',
  ipa           VARCHAR(191) NOT NULL                       COMMENT '国际音标',
  pos           VARCHAR(64)  NOT NULL                       COMMENT '词性',
  meaning       TEXT         NOT NULL                       COMMENT '中文释义',
  root          VARCHAR(64)  NOT NULL                       COMMENT '词根，如 spect',
  root_meaning  VARCHAR(191) NOT NULL                       COMMENT '词根义',
  etymology     TEXT         NOT NULL                       COMMENT '词源故事',
  collocations  TEXT         NOT NULL DEFAULT ('[]')        COMMENT '搭配 JSON [{en,zh}]',
  examples      TEXT         NOT NULL DEFAULT ('[]')        COMMENT '例句 JSON [{en,zh}]',
  family        VARCHAR(64)  NOT NULL                       COMMENT '家族名(3D 星系聚簇依据)',
  level         INT          NOT NULL DEFAULT 1             COMMENT '难度 1-3',
  KEY ix_words_root (root),
  KEY ix_words_family (family)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ----------------------------------------------------------------------------
-- phonemes · 48 国际音标
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS phonemes (
  id            INT PRIMARY KEY AUTO_INCREMENT                COMMENT 'id',
  symbol        VARCHAR(32)  UNIQUE NOT NULL                 COMMENT '音标符号(唯一)',
  type          VARCHAR(32)  NOT NULL                        COMMENT 'vowel/consonant',
  name          VARCHAR(191) NOT NULL                        COMMENT '名称',
  voiced        TINYINT(1)   NOT NULL DEFAULT 1              COMMENT '浊音1/清音0',
  tip           TEXT         NOT NULL                       COMMENT '发音要领',
  similar       TEXT         NOT NULL DEFAULT ('[]')        COMMENT '易混音标 JSON',
  example_words TEXT         NOT NULL DEFAULT ('[]')        COMMENT '词例 JSON',
  level         INT          NOT NULL DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ----------------------------------------------------------------------------
-- grammar_points · 语法点（21 点 × 9 题）
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS grammar_points (
  id          INT PRIMARY KEY AUTO_INCREMENT                  COMMENT '语法点 id',
  title       VARCHAR(255) UNIQUE NOT NULL                   COMMENT '标题(唯一;quiz 变更种子会 UPDATE)',
  category    VARCHAR(64)  NOT NULL                          COMMENT '分类',
  formula     VARCHAR(255) NOT NULL                          COMMENT '一句话公式',
  explanation TEXT NOT NULL                                  COMMENT '讲解正文',
  examples    TEXT NOT NULL DEFAULT ('[]')                   COMMENT '例句 JSON',
  machine     TEXT NOT NULL DEFAULT ('{}')                   COMMENT '机械装配零件 JSON',
  quiz        TEXT NOT NULL DEFAULT ('[]')                   COMMENT '题库 JSON'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ----------------------------------------------------------------------------
-- passages · 分级语料（听力/口语/阅读共用）
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS passages (
  id         INT PRIMARY KEY AUTO_INCREMENT                  COMMENT '语料 id',
  title      VARCHAR(255) NOT NULL                          COMMENT '篇名',
  level      INT NOT NULL DEFAULT 1                         COMMENT '难度 1-3',
  type       VARCHAR(32) NOT NULL                           COMMENT 'listening/speaking/reading',
  sentences  TEXT NOT NULL DEFAULT ('[]')                   COMMENT '句子 JSON [{en,zh}]',
  questions  TEXT NOT NULL DEFAULT ('[]')                   COMMENT '理解题 JSON'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ----------------------------------------------------------------------------
-- user_words · SM-2 间隔重复状态（核心学习数据）
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_words (
  id                INT PRIMARY KEY AUTO_INCREMENT           COMMENT 'id',
  user_id           INT NOT NULL                             COMMENT '用户',
  word_id           INT NOT NULL                             COMMENT '单词',
  repetitions       INT NOT NULL DEFAULT 0                   COMMENT 'SM-2 连续答对次数',
  ease              DOUBLE NOT NULL DEFAULT 2.5              COMMENT 'SM-2 难度系数',
  interval_days     DOUBLE NOT NULL DEFAULT 0                COMMENT '当前间隔(天)',
  lapses            INT NOT NULL DEFAULT 0                    COMMENT '遗忘次数',
  peak_strength     DOUBLE NOT NULL DEFAULT 0                COMMENT '历史峰值强度 0-1',
  first_learned_at  DATETIME NULL                             COMMENT '首次学习(空=没学过)',
  last_review_at    DATETIME NULL                             COMMENT '最近复习',
  due_at            DATETIME NULL                             COMMENT '下次到期(复习队列依据)',
  UNIQUE KEY uq_user_word (user_id, word_id),
  KEY ix_user_words_user (user_id),
  CONSTRAINT fk_uw_user FOREIGN KEY (user_id)  REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_uw_word FOREIGN KEY (word_id)  REFERENCES words(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ----------------------------------------------------------------------------
-- grammar_results · 语法答题流水
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS grammar_results (
  id          INT PRIMARY KEY AUTO_INCREMENT                  COMMENT 'id',
  user_id     INT NOT NULL                                   COMMENT '用户',
  point_id    INT NOT NULL                                   COMMENT '语法点',
  quiz_index  INT NOT NULL                                   COMMENT '第几题(0 起)',
  correct     TINYINT(1) NOT NULL                            COMMENT '对1/错0',
  created_at  DATETIME NOT NULL DEFAULT (UTC_TIMESTAMP())    COMMENT '答题时间',
  KEY ix_grammar_results_user (user_id),
  CONSTRAINT fk_gr_user  FOREIGN KEY (user_id)  REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_gr_point FOREIGN KEY (point_id) REFERENCES grammar_points(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ----------------------------------------------------------------------------
-- listening_results · 听力答题结果
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS listening_results (
  id            INT PRIMARY KEY AUTO_INCREMENT                COMMENT 'id',
  user_id       INT NOT NULL                                 COMMENT '用户',
  passage_id    INT NOT NULL                                 COMMENT '语料',
  correct_count INT NOT NULL                                 COMMENT '答对题数',
  total         INT NOT NULL                                 COMMENT '总题数',
  created_at    DATETIME NOT NULL DEFAULT (UTC_TIMESTAMP())  COMMENT '时间',
  KEY ix_listening_results_user (user_id),
  CONSTRAINT fk_lr_user   FOREIGN KEY (user_id)    REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_lr_passage FOREIGN KEY (passage_id) REFERENCES passages(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ----------------------------------------------------------------------------
-- speaking_results · 口语跟读结果（每句一条）
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS speaking_results (
  id             INT PRIMARY KEY AUTO_INCREMENT              COMMENT 'id',
  user_id        INT NOT NULL                                 COMMENT '用户',
  passage_id     INT NOT NULL                                 COMMENT '语料',
  sentence_index INT NOT NULL                                 COMMENT '第几句(0 起)',
  score          DOUBLE NOT NULL                              COMMENT '逐词命中得分 0-1',
  transcript     TEXT NOT NULL DEFAULT ('')                   COMMENT '语音识别转写',
  created_at     DATETIME NOT NULL DEFAULT (UTC_TIMESTAMP())  COMMENT '时间',
  KEY ix_speaking_results_user (user_id),
  CONSTRAINT fk_sr_user    FOREIGN KEY (user_id)    REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_sr_passage FOREIGN KEY (passage_id) REFERENCES passages(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ----------------------------------------------------------------------------
-- activity_events · 每日活动聚合（画像/热力图/周报）
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS activity_events (
  id          INT PRIMARY KEY AUTO_INCREMENT                  COMMENT 'id',
  user_id     INT NOT NULL                                   COMMENT '用户',
  date        DATE NOT NULL                                  COMMENT '日期(按天聚合)',
  module      VARCHAR(32) NOT NULL                           COMMENT 'vocab/grammar/listening/speaking/phonetics/reading',
  correct     TINYINT(1) NOT NULL                            COMMENT '当次答对数',
  total       INT NOT NULL                                   COMMENT '当次总数',
  word_id     INT NULL                                      COMMENT '关联单词(可空)',
  created_at  DATETIME NOT NULL DEFAULT (UTC_TIMESTAMP())    COMMENT '时间',
  KEY ix_activity_user (user_id), KEY ix_activity_date (date), KEY ix_activity_module (module),
  CONSTRAINT fk_ae_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_ae_word FOREIGN KEY (word_id) REFERENCES words(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ----------------------------------------------------------------------------
-- phonetic_results · 发音舱练习流水
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS phonetic_results (
  id          INT PRIMARY KEY AUTO_INCREMENT                  COMMENT 'id',
  user_id     INT NOT NULL                                   COMMENT '用户',
  kind        VARCHAR(64) NOT NULL                           COMMENT 'pair听辨/phoneme跟读/rule拼读',
  ref_id      VARCHAR(191) NOT NULL DEFAULT ('')             COMMENT '对应条目 id',
  correct     TINYINT(1) NOT NULL                            COMMENT '对1/错0',
  created_at  DATETIME NOT NULL DEFAULT (UTC_TIMESTAMP())    COMMENT '时间',
  KEY ix_phonetic_results_user (user_id),
  CONSTRAINT fk_pr_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ----------------------------------------------------------------------------
-- reading_results · 阅读理解结果
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reading_results (
  id            INT PRIMARY KEY AUTO_INCREMENT                COMMENT 'id',
  user_id       INT NOT NULL                                 COMMENT '用户',
  passage_id    INT NOT NULL                                 COMMENT '语料',
  correct_count INT NOT NULL                                 COMMENT '答对题数',
  total         INT NOT NULL                                 COMMENT '总题数',
  created_at    DATETIME NOT NULL DEFAULT (UTC_TIMESTAMP())  COMMENT '时间',
  KEY ix_reading_results_user (user_id),
  CONSTRAINT fk_rr_user    FOREIGN KEY (user_id)    REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_rr_passage FOREIGN KEY (passage_id) REFERENCES passages(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ----------------------------------------------------------------------------
-- collections · 生词本（收藏夹）
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS collections (
  id          INT PRIMARY KEY AUTO_INCREMENT                  COMMENT '收藏夹 id',
  user_id     INT NOT NULL                                   COMMENT '用户',
  name        VARCHAR(191) NOT NULL                          COMMENT '夹名',
  color       VARCHAR(64) NOT NULL DEFAULT 'accent'          COMMENT '配色 token',
  created_at  DATETIME NOT NULL DEFAULT (UTC_TIMESTAMP())    COMMENT '创建时间',
  UNIQUE KEY uq_user_name (user_id, name),
  CONSTRAINT fk_col_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ----------------------------------------------------------------------------
-- collection_words · 收藏夹-单词关联
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS collection_words (
  collection_id  INT NOT NULL                                 COMMENT '收藏夹',
  word_id        INT NOT NULL                                 COMMENT '单词',
  added_at       DATETIME NOT NULL DEFAULT (UTC_TIMESTAMP())  COMMENT '加入时间',
  PRIMARY KEY (collection_id, word_id),
  KEY ix_cw_word (word_id),
  CONSTRAINT fk_cw_col  FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE CASCADE,
  CONSTRAINT fk_cw_word FOREIGN KEY (word_id)      REFERENCES words(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ----------------------------------------------------------------------------
-- diary_entries · 英语日记（中文原文 + AI 英文译文）
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS diary_entries (
  id          INT PRIMARY KEY AUTO_INCREMENT,
  user_id     INT NOT NULL,
  zh_text     TEXT NOT NULL                     COMMENT '中文原文',
  en_text     TEXT NOT NULL                     COMMENT 'AI 译文（可手动修正）',
  created_at  DATETIME NOT NULL DEFAULT (UTC_TIMESTAMP()),
  KEY ix_diary_user (user_id, created_at),
  CONSTRAINT fk_diary_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ============================================================================
-- 兼容迁移：老库 users 缺档案列时补齐（initDb() 启动时执行，列已存在报错可忽略）
-- ============================================================================
-- ALTER TABLE users ADD COLUMN goal VARCHAR(64) NULL;
-- ALTER TABLE users ADD COLUMN self_level VARCHAR(64) NULL;
-- ALTER TABLE users ADD COLUMN prefs TEXT NULL;
