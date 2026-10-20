# -*- coding: utf-8 -*-
"""
全量词表扩展:五源词表 -> data/lexicon.json(40 词根之外的普通词条)
来源: KyleBing(7 txt + 23 jsonl)、mahavivo(16 词表)、IELTS、kajweb(71 词书)、ECDICT(补音标/释义/等级)
原则: 只收五源词表里出现的单词头词; 释义/音标/例句尽量取真实来源; 无中文释义的不收;
      普通词条 family='general', 不进入 40 词根星系, 只进词典检索。
用法: python build_lexicon.py [--apply]
"""
import csv, glob, io, json, os, re, shutil, sys, time, zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.abspath(os.path.join(HERE, '..', '..', 'data-sources'))
DATA = os.path.abspath(os.path.join(HERE, '..', 'data'))

WORD_RE = re.compile(r"^[a-z][a-z'\-]*$")
CJK_RE = re.compile(r'[\u4e00-\u9fff]')


def read_text(p):
    b = open(p, 'rb').read()
    for enc in ('utf-8-sig', 'gb18030', 'utf-16'):
        try:
            return b.decode(enc)
        except UnicodeDecodeError:
            pass
    return b.decode('utf-8', 'ignore')


def norm_word(w):
    w = (w or '').strip().strip('*').strip().lower()
    w = w.replace('’', "'").replace('‘', "'")
    if not WORD_RE.fullmatch(w) or len(w) < 2:
        return None
    return w


def clean_meaning(s, limit=220):
    if not s:
        return ''
    s = s.replace('\ufffd', '').replace('■', '')
    s = re.sub(r'\s+', ' ', s).strip(' ;；,，')
    # 去掉词表解析残渣:前导 *(星标)、空方括号、重复音标 /.../ 或 [...]
    s = re.sub(r'^\s*\*+\s*', '', s)
    s = re.sub(r'^(?:\[\s*\]\s*)+', '', s)
    s = re.sub(r'^/[^/]{1,40}/\s*', '', s)
    s = re.sub(r'^\[[^\]]{1,40}\]\s*', '', s)
    s = re.sub(r'\s*\*\s*/[^/]{1,40}/', '', s)
    # 词性英文全称 -> 缩写
    POS_MAP = {
        'noun': 'n.', 'verb': 'v.', 'adjective': 'a.', 'adverb': 'ad.',
        'preposition': 'prep.', 'pronoun': 'pron.', 'conjunction': 'conj.',
        'interjection': 'interj.', 'exclamation': 'interj.', 'auxiliary verb': 'aux.',
    }
    for full, abbr in POS_MAP.items():
        s = re.sub(rf'^{full}\b\.?\s*', abbr + ' ', s, flags=re.I)
        s = re.sub(rf'\b{full}\b\.?\s*', abbr + ' ', s, flags=re.I)
    # 释义里重复的起始词性交给 pos 字段展示
    s = re.sub(r'^(?:n|v|a|ad|adj|adv|prep|pron|conj|interj|num|art)\.\s*', '', s, flags=re.I)
    s = s.strip(' ;；,，<>*')
    if not CJK_RE.search(s):
        return ''
    if len(s) > limit:
        cut = max(s.rfind('；', 0, limit), s.rfind(';', 0, limit), s.rfind('，', 0, limit))
        s = s[:cut] if cut > 60 else s[:limit]
    return s


def norm_ipa(s):
    if not s:
        return ''
    s = s.strip().strip('/[]').strip()
    s = s.replace("'", 'ˈ').replace('’', 'ˈ').replace(',', 'ˌ')
    s = s.replace('ә', 'ə').replace('ɑ:', 'ɑː').replace('ɔ:', 'ɔː')
    s = re.sub(r'(?<=[aeiouəɜɑɔʊɪɛæʌɒ])[:]', 'ː', s)
    s = s.replace(':', 'ː')
    s = re.sub(r'\s+', '', s)
    return f'/{s}/' if s else ''


def level_from_ecdict(row):
    tag = (row.get('tag') or '').strip().split()
    ts = set(tag)
    if ts & {'zk', 'gk'}:
        return 1
    if 'cet4' in ts or 'ky' in ts:
        return 2
    if ts & {'cet6', 'ielts', 'toefl'}:
        return 3
    if 'gre' in ts:
        return 4
    for k in ('frq', 'bnc', 'coca'):
        v = (row.get(k) or '').strip()
        if v.isdigit() and int(v) > 0:
            n = int(v)
            return 1 if n <= 5000 else 2 if n <= 10000 else 3 if n <= 20000 else 4
    return 2


def add(entries, src, word, meaning='', ipa='', pos='', examples=None, collocations=None):
    w = norm_word(word)
    if not w:
        return
    e = entries.setdefault(w, {'sources': set(), 'meaning': '', 'ipa': '', 'pos': '',
                               'examples': [], 'collocations': []})
    e['sources'].add(src)
    m = clean_meaning(meaning)
    if m and (not e['meaning'] or len(m) > len(e['meaning'])):
        e['meaning'] = m
    if not e['ipa'] and ipa:
        e['ipa'] = norm_ipa(ipa)
    if not e['pos'] and pos:
        e['pos'] = pos.strip().rstrip('.') + '.'
    if examples:
        have = {x['en'] for x in e['examples']}
        for en, zh in examples:
            if len(e['examples']) >= 2:
                break
            en = re.sub(r'\s+', ' ', (en or '')).strip()
            zh = re.sub(r'\s+', ' ', (zh or '')).strip()
            if 8 <= len(en) <= 180 and CJK_RE.search(zh) and en not in have:
                e['examples'].append({'en': en, 'zh': zh})
                have.add(en)
    if collocations:
        have = {x['en'] for x in e['collocations']}
        for en, zh in collocations:
            if len(e['collocations']) >= 4:
                break
            en = re.sub(r'\s+', ' ', (en or '')).strip()
            zh = re.sub(r'\s+', ' ', (zh or '')).strip()
            if 2 <= len(en) <= 80 and en not in have:
                e['collocations'].append({'en': en, 'zh': zh})
                have.add(en)


def load_kylebing_txt(entries):
    n = 0
    for p in sorted(glob.glob(os.path.join(SRC, 'english-vocabulary', '*.txt'))):
        for line in read_text(p).splitlines():
            line = line.strip()
            if not line:
                continue
            parts = re.split(r'\t+', line)
            if len(parts) < 2:
                continue
            add(entries, 'kylebing-txt', parts[0], meaning=parts[1])
            n += 1
    return n


def load_kylebing_jsonl(entries):
    n = 0
    for p in sorted(glob.glob(os.path.join(SRC, 'english-vocabulary', 'jsonl-sentence', '*.jsonl'))):
        for line in io.open(p, encoding='utf-8', errors='ignore'):
            try:
                d = json.loads(line)
            except Exception:
                continue
            trans = d.get('translations') or []
            meaning = '；'.join(
                (t.get('type', '') + '. ' if t.get('type') else '') + (t.get('translation') or '')
                for t in trans if t.get('translation'))
            ex = [(s.get('sentence'), s.get('translation')) for s in (d.get('sentences') or [])]
            ph = []
            for x in (d.get('phrases') or []):
                if isinstance(x, dict):
                    ph.append((x.get('phrase') or x.get('pContent'), x.get('translation') or x.get('pCn')))
            add(entries, 'kylebing-jsonl', d.get('word'), meaning=meaning,
                ipa=d.get('us') or d.get('uk'),
                pos=(trans[0].get('type') if trans else ''),
                examples=ex, collocations=ph)
            n += 1
    return n


def load_ielts(entries):
    n = 0
    p = os.path.join(SRC, 'IELTS', 'IELTS Word List.txt')
    if not os.path.exists(p):
        return 0
    for line in read_text(p).splitlines():
        line = line.strip().lstrip('*')
        if not line:
            continue
        m = re.match(r"^([A-Za-z][A-Za-z'\-]*)\s*(?:[\[/]([^\]/]+)[\]/])?\s*(.*)$", line)
        if not m:
            continue
        w, ipa, rest = m.group(1), m.group(2), m.group(3)
        if not CJK_RE.search(rest):
            continue
        pm = re.match(r'^([a-z]+\.)', rest)
        add(entries, 'ielts', w, meaning=rest, ipa=ipa, pos=pm.group(1) if pm else '')
        n += 1
    return n


def load_mahavivo(entries):
    n = 0
    for p in sorted(glob.glob(os.path.join(SRC, 'english-wordlists', '*.txt'))):
        for line in read_text(p).splitlines():
            line = line.strip().lstrip('*').strip()
            if not line or line[0] in '(（#' or re.match(r'^\d', line) or re.match(r'^[A-Z]$', line):
                continue
            if CJK_RE.search(line[:1]):
                continue
            # 头词只取第一个英文词; 后面可能是 [, /, tab, 多空格或词性
            m = re.match(r"^([A-Za-z][A-Za-z'\-]*)", line)
            if not m:
                continue
            w = m.group(1)
            rest = line[m.end():]
            ipa = ''
            im = re.search(r'[\[/]([^\]]+?)[\]/]', rest)
            if im:
                ipa = im.group(1)
            # 释义: 音标之后的剩余部分(去掉词性标记也可原样保留)
            meaning = rest[im.end():] if im else rest
            add(entries, 'mahavivo', w, meaning=meaning, ipa=ipa)
            n += 1
    return n


def load_kajweb(entries):
    n = 0
    for zp in sorted(glob.glob(os.path.join(SRC, 'kajweb', '*.zip'))):
        try:
            with zipfile.ZipFile(zp) as z:
                for name in z.namelist():
                    if not name.lower().endswith('.json'):
                        continue
                    with z.open(name) as fh:
                        for line in io.TextIOWrapper(fh, encoding='utf-8', errors='ignore'):
                            try:
                                d = json.loads(line)
                            except Exception:
                                continue
                            w = d.get('headWord')
                            c = (d.get('content') or {}).get('word', {}).get('content', {})
                            trans = c.get('trans') or []
                            if isinstance(trans, dict):
                                trans = [trans]
                            meaning = '；'.join(
                                (t.get('pos', '') + '. ' if t.get('pos') else '') + (t.get('tranCn') or '')
                                for t in trans if isinstance(t, dict) and t.get('tranCn'))
                            pos = trans[0].get('pos', '') if trans and isinstance(trans[0], dict) else ''
                            ex = [(s.get('sContent'), s.get('sCn'))
                                  for s in ((c.get('sentence') or {}).get('sentences') or [])]
                            ph = [(x.get('pContent'), x.get('pCn'))
                                  for x in ((c.get('phrase') or {}).get('phrases') or [])]
                            add(entries, 'kajweb', w, meaning=meaning,
                                ipa=c.get('usphone') or c.get('ukphone'), pos=pos,
                                examples=ex, collocations=ph)
                            n += 1
        except Exception as e:
            print(f'  ! {os.path.basename(zp)}: {e}')
    return n


def fill_ecdict(entries):
    """只保留候选词的 ECDICT 行, 避免把 769k 全塞内存。"""
    need = set(entries)
    found = 0
    with io.open(os.path.join(SRC, 'ecdict.csv'), encoding='utf-8', errors='ignore', newline='') as f:
        for row in csv.DictReader(f):
            w = (row.get('word') or '').strip().lower()
            if w not in need:
                continue
            e = entries[w]
            found += 1
            if not e['meaning']:
                e['meaning'] = clean_meaning((row.get('translation') or '').replace('\\n', '；'))
            if not e['ipa']:
                e['ipa'] = norm_ipa(row.get('phonetic'))
            if not e['pos']:
                pm = re.match(r'^([a-z]+)\.', (row.get('translation') or '').strip())
                e['pos'] = (pm.group(1) + '.') if pm else 'n.'
            e['level'] = level_from_ecdict(row)
            e['tag'] = (row.get('tag') or '').strip()
    return found


def main(apply=False):
    words = {w['word'].lower() for w in json.load(io.open(os.path.join(DATA, 'words.json'), encoding='utf-8'))}
    entries = {}
    counts = {
        'kylebing-txt': load_kylebing_txt(entries),
        'kylebing-jsonl': load_kylebing_jsonl(entries),
        'ielts': load_ielts(entries),
        'mahavivo': load_mahavivo(entries),
        'kajweb': load_kajweb(entries),
    }
    all_raw = len(entries)
    # 去掉已在 40 词根库里的词
    for w in list(entries):
        if w in words:
            del entries[w]
    in_db = all_raw - len(entries)
    after_db = len(entries)
    found = fill_ecdict(entries)
    # 只留有中文释义的; 补齐等级/词性
    out, no_meaning, no_ipa = [], 0, 0
    for w in sorted(entries):
        e = entries[w]
        if not e['meaning']:
            no_meaning += 1
            continue
        if not e['ipa']:
            no_ipa += 1
        out.append({
            'word': w,
            'ipa': e['ipa'],
            'pos': e['pos'] or 'n.',
            'meaning': e['meaning'],
            'root': '',
            'root_meaning': '',
            'etymology': '',
            'collocations': e['collocations'],
            'examples': e['examples'],
            'family': 'general',
            'level': e.get('level', 2),
            'mnemonic': None,
        })
    print(f"五源原始头词(去重) {all_raw} | 已入词根库 {in_db} | 待扩展 {after_db}")
    print(f"ECDICT 命中 {found} | 无中文释义跳过 {no_meaning} | 无音标 {no_ipa}")
    print(f"最终扩展词条 {len(out)}: 含例句 {sum(1 for x in out if x['examples'])}"
          f" | 含搭配 {sum(1 for x in out if x['collocations'])}")
    print('来源命中: ' + ', '.join(f'{k}={v}' for k, v in counts.items()))
    if apply:
        p = os.path.join(DATA, 'lexicon.json')
        if os.path.exists(p):
            bak = p + f'.bak-{time.strftime("%Y%m%d-%H%M%S")}'
            shutil.copy2(p, bak)
            print('备份:', bak)
        with io.open(p, 'w', encoding='utf-8') as f:
            json.dump(out, f, ensure_ascii=False, indent=2)
        print('已写出:', p)


if __name__ == '__main__':
    main(apply='--apply' in sys.argv)
