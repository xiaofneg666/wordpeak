# -*- coding: utf-8 -*-
"""
内容回填:为 words.json 中缺搭配/缺例句的词补真实数据(不动已有内容,不改词义字段)。
搭配/例句来源:
  1) data-sources/kajweb/*.zip 词书内 c.phrase.phrases / c.sentence / c.realExamSentence
  2) data-sources/english-vocabulary/jsonl-sentence/*.jsonl (KyleBing 有道例句库: phrases + sentences)
原则: 只填空缺(<2 例句 / 0 搭配),不覆盖既有手写内容;无来源保持留空。
用法: python backfill_content.py [--apply]  默认 dry-run 统计
"""
import json, os, sys, zipfile, io, re

HERE = os.path.dirname(os.path.abspath(__file__))
SEED = os.path.abspath(os.path.join(HERE, '..', 'data', 'words.json'))
SRC = os.path.abspath(os.path.join(HERE, '..', '..', 'data-sources'))

def load_book_phrases():
  """kajweb 词书: word -> {phrases: [(en,zh)], sentences: [(en,zh)]}"""
  out = {}
  d = os.path.join(SRC, 'kajweb')
  for z in sorted(os.listdir(d)):
    if not z.endswith('.zip') or z == 'test_jsd.zip':
      continue
    try:
      with zipfile.ZipFile(os.path.join(d, z)) as f:
        name = next(n for n in f.namelist() if n.endswith('.json'))
        for line in f.read(name).decode('utf-8', 'replace').splitlines():
          if not line.strip():
            continue
          try:
            c = json.loads(line)['content']['word']['content']
            w = json.loads(line)['content']['word']['wordHead'].lower()
          except Exception:
            continue
          ent = out.setdefault(w, {'phrases': [], 'sentences': []})
          for p in ((c.get('phrase') or {}).get('phrases') or []):
            if p.get('pContent') and p.get('pCn'):
              ent['phrases'].append((p['pContent'].strip(), p['pCn'].strip()))
          for bucket in ('sentence', 'realExamSentence'):
            for s in ((c.get(bucket) or {}).get('sentences') or []):
              if s.get('sContent') and s.get('sCn'):
                ent['sentences'].append((s['sContent'].strip(), s['sCn'].strip()))
    except Exception as e:
      print(f'  [warn] {z}: {e.__class__.__name__}')
  return out

def load_kb_sentences():
  """KyleBing sentence jsonl: word -> {phrases: [(en,zh)], sentences: [(en,zh)]}"""
  out = {}
  d = os.path.join(SRC, 'english-vocabulary', 'jsonl-sentence')
  if not os.path.isdir(d):
    return out
  for f in sorted(os.listdir(d)):
    if not f.endswith('.jsonl'):
      continue
    for line in io.open(os.path.join(d, f), encoding='utf-8', errors='replace'):
      if not line.strip():
        continue
      try:
        d2 = json.loads(line)
        w = d2['word'].lower()
      except Exception:
        continue
      ent = out.setdefault(w, {'phrases': [], 'sentences': []})
      for p in (d2.get('phrases') or []):
        if p.get('phrase') and p.get('translation'):
          ent['phrases'].append((p['phrase'].strip(), p['translation'].strip()))
      for s in (d2.get('sentences') or []):
        sent = s.get('sentence') or s.get('sContent')
        cn = s.get('translation') or s.get('sCn')
        if sent and cn:
          ent['sentences'].append((sent.strip(), cn.strip()))
  return out

BAD_PHRASE_CN = re.compile(r'教程|词典|手册|大纲|词汇表|附录')
def pick_phrases(pool, n=4):
  seen, out = set(), []
  for en, zh in pool:
    if BAD_PHRASE_CN.search(zh) or en.lower() in seen or len(en) < 3:
      continue
    seen.add(en.lower())
    out.append({'en': en, 'zh': zh})
    if len(out) >= n:
      break
  return out

def main(apply=False):
  words = json.load(io.open(SEED, encoding='utf-8'))
  books = load_book_phrases()
  kb = load_kb_sentences()
  print(f'词书短语库 {sum(len(v["phrases"]) for v in books.values())} 条 | 句库 {sum(len(v["sentences"]) for v in books.values())} 条')
  print(f'KyleBing 句库 {len(kb)} 词 | 短语 {sum(len(v["phrases"]) for v in kb.values())} 条 | 句子 {sum(len(v["sentences"]) for v in kb.values())} 条')

  stat = {'搭配': 0, '例句': 0}
  for w in words:
    key = w['word'].lower()
    src_p = books.get(key, {}).get('phrases', []) + kb.get(key, {}).get('phrases', [])
    src_s = books.get(key, {}).get('sentences', []) + kb.get(key, {}).get('sentences', [])
    if not w.get('collocations') and src_p:
      w['collocations'] = pick_phrases(src_p)
      if w['collocations']:
        stat['搭配'] += 1
    if len(w.get('examples') or []) < 2 and src_s:
      have = {e['en'] for e in w.get('examples') or []}
      added = 0
      for en, zh in src_s:
        if len(w['examples']) >= 2:
          break
        if en not in have:
          w['examples'].append({'en': en, 'zh': zh})
          have.add(en)
          added += 1
      if added:
        stat['例句'] += 1
  print(f'回填: 搭配 {stat["搭配"]} 词 | 例句补齐 {stat["例句"]} 词')
  still_no_ex = sum(1 for w in words if not w.get('examples'))
  still_no_col = sum(1 for w in words if not w.get('collocations'))
  print(f'仍缺例句 {still_no_ex} | 仍缺搭配 {still_no_col}')
  if apply:
    backup = SEED + '.bak-backfill'
    if not os.path.exists(backup):
      import shutil
      shutil.copy2(SEED, backup)
    json.dump(words, io.open(SEED, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
    print(f'已写回 {SEED}(备份 {backup})')

if __name__ == '__main__':
  main(apply='--apply' in sys.argv)
