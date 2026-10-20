# WordVerse API 契约 (v1)

Base URL: `http://localhost:8000/api` · JSON only · 所有响应 `{ "ok": true, "data": ... }` 或 `{ "ok": false, "error": "..." }`

## 用户

### POST /users  `{ "username": "玩家名" }`
创建或返回已存在用户（按用户名幂等）。
→ `{ "id": 1, "username": "玩家名" }`

### GET /users/{id}/stats
学习画像总览。
→ `{ "total_words": 120, "learned": 36, "mastered": 8, "due_today": 12,
     "streak_days": 3, "avg_accuracy": 0.72,
     "accuracy_by_module": { "vocab": 0.75, "grammar": 0.6, "listening": 0.7, "speaking": 0.8 },
     "weakest_roots": [ { "root": "spect", "meaning": "看", "accuracy": 0.4, "word_count": 9 } ],
     "daily_activity": [ { "date": "2026-10-08", "reviews": 20, "new_words": 5 } ] }`
（daily_activity 最近 14 天；streak_days 学习连击）

## 词汇星系

### GET /words
全部单词（含知识库字段）。
→ `[ { "id": 1, "word": "inspect", "ipa": "/ɪnˈspekt/", "pos": "v.",
      "meaning": "检查，视察", "root": "spect", "root_meaning": "看",
      "etymology": "in-(进入) + spect(看) → 仔细看进去 → 检查",
      "collocations": [ { "en": "inspect the goods", "zh": "检查货物" } ],
      "examples": [ { "en": "The customs officer inspected my luggage.", "zh": "海关官员检查了我的行李。" } ],
      "family": "spect", "level": 1 } ]`

### GET /roots
词根家族（星系）列表。
→ `[ { "root": "spect", "meaning": "看", "story": "拉丁词根 specere/spectare...", "word_count": 9 } ]`

### GET /words/state/{user_id}
当前用户所有单词的记忆状态（驱动星球光照）。
→ `[ { "word_id": 1, "strength": 0.83, "due": false, "due_at": "2026-10-10T08:00:00",
      "repetitions": 4, "lapses": 1, "is_new": false } ]`
- `strength`: 0~1 记忆强度（SM-2 计算：interval/ease 越大越接近 1；新词未学为 null）
- `is_new`: 从未学过

### GET /review/queue/{user_id}?count=10
生成复习队列：优先到期词（含临界求救词），不足补新词。
→ `[ { "word_id": 5, "is_new": true } ]`

### POST /review/result  `{ "user_id": 1, "word_id": 5, "correct": true, "response_ms": 2400 }`
提交一次答题。SM-2 更新。
→ `{ "word_id": 5, "strength": 0.6, "interval_days": 1, "ease": 2.5, "next_review_at": "...", "state": "learning" }`

## 发音舱

### GET /phonemes
48 音标（口腔参数供前端 SVG 动画）。
→ `[ { "id": 1, "symbol": "/iː/", "type": "vowel", "name": "长元音 /iː/",
      "tip": "舌尖抵下齿，嘴角向两边拉伸，像微笑说"衣"——", "level": 1,
      "tip": "舌前部抬高，嘴角咧开如微笑",
      "similar": ["/ɪ/", "/e/"],
      "example_words": [ { "en": "sheep", "zh": "羊", "ipa": "/ʃiːp/" } ] } ]`

## 语法机械城

### GET /grammar
→ `[ { "id": 1, "title": "一般现在时", "category": "时态", "formula": "主语 + 动词原形(三单加-s)",
      "explanation": "表示经常性、习惯性的动作或客观事实。",
      "examples": [ { "en": "The earth goes around the sun.", "zh": "地球绕着太阳转。" } ],
      "machine": { "parts": [ { "label": "主语", "value": "The earth" }, { "label": "谓语", "value": "goes" } ] },
      "quiz": [ { "question": "He ___ to school every day.",
                  "options": ["go", "goes", "going", "went"], "answer": 1,
                  "explain": "主语第三人称单数，一般现在时动词加 -s/-es。" } ] } ]`

### POST /grammar/result  `{ "user_id": 1, "point_id": 1, "quiz_index": 0, "correct": true }`
→ `{ "ok": true, "point_mastery": 0.5 }`（该语法点掌握度 0~1，连续答对提升）

### GET /grammar/state/{user_id}
→ `[ { "point_id": 1, "mastery": 0.5, "attempts": 4, "wrong_count": 2 } ]`

## 听力峡谷 / 阅读号列车 / 口语竞技场

### GET /passages
→ `[ { "id": 1, "title": "A Day at the Space Station", "level": 2, "type": "listening",
      "sentences": [ { "en": "...", "zh": "..." } ],
      "questions": [ { "q": "...", "options": ["A","B","C","D"], "answer": 2, "explain": "..." } ] } ]`

### POST /listening/result  `{ "user_id": 1, "passage_id": 1, "correct_count": 3, "total": 4 }`
→ `{ "ok": true, "accuracy": 0.75 }`

### POST /speaking/result  `{ "user_id": 1, "passage_id": 1, "sentence_index": 0, "score": 0.86, "transcript": "..." }`
→ `{ "ok": true }`

## 英语日记

中文起笔 → AI 逐句译英 → 逐句带读。翻译走 LLM(需 `backend-node/.env` 配置 `ANTHROPIC_API_KEY` 或 `GEMINI_API_KEY`,参考 `.env.example`;无 key 时返回 503 与配置指引)。

### POST /diary/translate  `{ "sentences": ["今天天气很好。", "我去公园读了一本书。"] }`
逐句对齐翻译(≤40 句,单句 ≤500 字符)。英文译文按句返回,与输入编号一一对应。
→ `{ "pairs": [ { "zh": "今天天气很好。", "en": "The weather was nice today." }, ... ], "source": "llm" }`

### GET /users/{id}/diary
历史日记列表(created_at 倒序,≤100 条)。`en_text` 以 `\n` 分句存储。
→ `[ { "id": 1, "zh_text": "今天天气很好。", "en_text": "The weather was nice today.", "created_at": "2026-10-14T03:02:53" } ]`

### POST /users/{id}/diary  `{ "zh_text": "今天……", "en_text": "Today...\n..." }`
保存一篇(zh ≤2000 字,en ≤4000 字符)。→ 新建条目。

### PATCH /users/{id}/diary/{id2}  `{ "en_text": "修正后的整篇英文(\n 分句)" }`
手动修正 AI 译文。→ 更新后的条目。

### DELETE /users/{id}/diary/{id2}
删除一篇。→ `{ "ok": true }`

## 约定

- SQLite 文件 `backend/wordpeak.db`，首次启动自动建表并从 `app/data/*.json` 播种。
- 时区统一 UTC ISO8601；`strength` 等小数保留 3 位。
- SM-2：correct+快 → grade 5；correct+慢 → 4；犹豫正确 → 3；错误 → 1（重置 interval、ease 略降）。
- 词库至少 120 词、12 个词根家族；48 音标必须与英语国际音标 DJ 体系一致；语法点至少 15 个；语料至少 6 篇（听力/阅读/口语各 2+）。
