# -*- coding: utf-8 -*-
"""
词库扩容管线:五个开源词源 -> 词峰 40 词根家族体系
来源: KyleBing/english-vocabulary, mahavivo/english-wordlists, skywind3000/ECDICT,
      kajweb/dict(有道词书 JSONL: 音标/释义/真实例句), fanhongtao/IELTS
原则: 新词必须真正含家族词根变体(前后缀分词验证), 内容只用真实来源,
      例句仅取词书真实例句, 无来源留空不编造; 学习数据(user_words)零接触。
v2(全量轮): 基线改读 data/words.json(种子即真相源,不再绑 SQLite 驱动);
      取消家族配额(上一轮 15/33 截断把 ~800 候选只入了 427), 全量过质量门即收;
      词书扩到 71 本(考研书上一轮 zip 损坏从未加载, 本轮修复), 词表接入剩余全部文件。
用法: python enrich_words.py [--apply]
  默认 dry-run 输出统计与样本; --apply 时备份 words.json 后合并写入(按 word 幂等)。
"""
import json, re, os, sys, zipfile, io, csv, shutil, time

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.abspath(os.path.join(HERE, '..', '..', 'data-sources'))

# ============ 40 家族: 词根表面变体 + 错根黑名单 + 分词失败但词源真实的 EXTRA ============
FAMILIES = {
  'dict':  {'v': ['dict', 'dic'],
            'bl': ['dice', 'dicey', 'diced', 'dicing'],
            'ex': ['index']},
  'vis':   {'v': ['vis', 'vid', 'vise', 'view'],
            'bl': ['divide', 'divided', 'divides', 'subdivide', 'subdivider', 'divider',
                   'dividers', 'division', 'divisions', 'divisive',
                   'divisiveness', 'divisible', 'indivisible', 'individual',
                   'individually', 'individualism', 'individuality', 'subdivision',
                   'dividend', 'dividends', 'widow', 'widower', 'widowed', 'avid',
                   'avidly', 'avidity', 'devise', 'deviser', 'device', 'devices']},
  'cept':  {'v': ['cept', 'ceiv', 'ceit', 'cip'],
            'ex': ['receipt', 'occupation', 'occupational', 'municipal', 'municipality',
                   'emancipate', 'emancipation', 'principal', 'principle', 'principally',
                   'participant', 'participation']},
  'fer':   {'v': ['fer', 'fert'],
            'bl': ['fervent', 'fervor', 'fervid', 'ferry', 'inferior', 'inferiority', 'feral',
                   'surfer', 'surfers', 'surfing', 'surf',
                   'interfere', 'interfering', 'interference', 'interferon',
                   'ferment', 'fermentation', 'fermented', 'fermenting'],
            'ex': ['aquifer']},
  'mit':   {'v': ['mit', 'miss', 'mise'],
            'bl': ['comity', 'amity', 'enmity', 'amiss', 'concomitant', 'eremite',
                   'mite', 'mites', 'miss', 'misses', 'semitic', 'antisemitic', 'missing']},
  'duct':  {'v': ['duct', 'duc'], 'bl': ['duchess', 'duck', 'ducky']},
  'form':  {'v': ['form'], 'bl': ['formidable', 'formidably'],
            'ex': ['platform']},
  'port':  {'v': ['port'],
            'bl': ['sport', 'sporting', 'sports', 'sporty', 'apportion', 'portion',
                   'portions', 'proportion', 'proportions', 'proportional',
                   'disproportionate', 'portent', 'portentous', 'portal', 'proportionate',
                   'proportionately', 'proportionally', 'disproportionately'],
            'ex': ['passport', 'seaport']},
  'scrib': {'v': ['scrib', 'script']},
  'spect': {'v': ['spect', 'spec', 'spic', 'spis'], 'bl': ['despite', 'spite', 'respectant', 'inspissate', 'inspissation',
                   'spice', 'spices', 'spiced', 'spicing', 'spicy']},
  'struct': {'v': ['struct']},
  'tain':  {'v': ['tain', 'ten', 'tent', 'tin'],
            'bl': ['attention', 'attentive', 'attend', 'extend', 'extension', 'extensive',
                   'extensively', 'extent', 'intend', 'intent', 'intention', 'intentional', 'intentionally', 'intense',
                   'intensive', 'intensity', 'intensify', 'intensified',
                   'intensification', 'tension', 'tentative', 'tend', 'tendency',
                   'tender', 'pretend', 'contend', 'contention', 'portend',
                   'ostensible', 'ostentatious', 'superintendent', 'tendon', 'distend', 'distension', 'distention',
                   'tennis', 'curtain', 'certain', 'certainly', 'certainty',
                   'ascertain', 'ten', 'often', 'tent', 'tiny', 'extenuate',
                   'extenuating', 'tennessee', 'tin', 'tins', 'tinned', 'tinning',
                   'tinny', 'tenuous', 'tenuously', 'intensively', 'intently', 'tine', 'tines',
                   'pretension', 'pretensions', 'pretentious', 'pretentiously',
                   'pretentiousness', 'retina', 'distain', 'tined'],
            'ex': ['abstain', 'abstention', 'abstinence']},
  'vert':  {'v': ['vert', 'vers'],
            'bl': ['covert', 'covertly', 'covertness']},
  'ject':  {'v': ['ject', 'jac'], 'bl': ['jacal']},
  'phon':  {'v': ['phon'], 'bl': ['phony']},
  'bio':   {'v': ['bio'],
            'bl': ['aerobatics'],
            'ex': ['amphibian', 'amphibious']},
  'cur':   {'v': ['cur', 'curr', 'curs', 'cour', 'cours'],
            'bl': ['cure', 'curable', 'incurable', 'curative', 'curious', 'curiosity',
                   'curiously', 'curiousness', 'accurate', 'accuracy', 'secure',
                   'security', 'insecure', 'curator', 'manicure', 'pedicure',
                   'sinecure', 'curly', 'epicure', 'epicurean', 'cur', 'securely', 'curse', 'curses', 'cursed',
                   'cursing', 'curst',
                   'securities', 'insecurity'],
            'ex': ['course', 'discourse', 'corridor']},
  'graph': {'v': ['graph'],
            'ex': ['calligraphy']},
  'log':   {'v': ['log', 'logue', 'logy'],
            'bl': ['log', 'logs', 'logged', 'logging', 'logbook', 'logistic', 'logistical', 'logistics'],
            'ex': ['psychology', 'psychological', 'psychologist', 'sociology',
                   'technology', 'technological', 'ecology', 'ecological', 'ideology',
                   'ideological', 'terminology', 'methodology', 'anthropology',
                   'archaeology', 'mythology', 'mythological', 'neurology']},
  'pend':  {'v': ['pend', 'pens'],
            'ex': ['spend', 'spent', 'ponder', 'ponderous']},
  'vok':   {'v': ['voc', 'vok', 'voke']},
  'ast':   {'v': ['astr', 'aster', 'astro'],
            'bl': ['easter', 'eastern', 'easterner', 'alabaster', 'astray', 'coaster']},
  'aud':   {'v': ['aud'], 'bl': ['audacious', 'audacity']},
  'cap':   {'v': ['cap', 'capt', 'capit'],
            'bl': ['escape', 'escapade', 'caper', 'capers', 'capsize', 'seascape'],
            'ex': ['precipitate', 'precipice', 'precipitation', 'precipitous']},
  'cord':  {'v': ['cord', 'card', 'cour'],
            'bl': ['card', 'cards', 'discard', 'cord', 'cords', 'cordless', 'cordon', 'postcard',
                   'discarded', 'discards', 'discarding', 'accordion']},
  'flect': {'v': ['flect', 'flex'], 'bl': ['reflexion']},
  'dur':   {'v': ['dur'], 'bl': ['corduroy', 'verdure']},
  'chron': {'v': ['chron']},
  'son':   {'v': ['son'],
            'bl': ['person', 'personal', 'personality', 'personnel', 'personally',
                   'season', 'seasonal', 'song', 'songs', 'arson', 'reason', 'reasons',
                   'reasoned', 'reasoning', 'reasonable', 'unreasonable', 'bison',
                   'interpersonal', 'personage', 'impersonation', 'impersonal',
                   'impersonate', 'seasoning', 'seasons', 'seasoned', 'arsonist', 'son',
                   'personable', 'personify', 'personification', 'persona', 'personas', 'personalize', 'personalized', 'personalizes',
                   'personalization', 'personalizing', 'personhood']},
  'terr':  {'v': ['terr'],
            'bl': ['terrible', 'terribly', 'terror', 'terrorism', 'terrorist', 'terrify',
                   'undeterred',
                   'terrified', 'terrifying', 'terrifyingly', 'terrific', 'terrorize',
                   'deter', 'deterrence', 'deterrent', 'terry'],
            'ex': ['mediterranean', 'subterranean', 'extraterrestrial', 'terrestrial']},
  'ann':   {'v': ['ann', 'enn'],
            'bl': ['announce', 'announcement', 'announcer', 'denounce', 'pronounce',
                   'pronunciation', 'renounce', 'annoy', 'annoyed', 'annoying',
                   'annoyance', 'annoys', 'comedienne', 'openness', 'openly', 'opener', 'opened',
                   'opens', 'reopen', 'reopening', 'anneal', 'annealed', 'annealing'],
            'ex': ['millennium', 'millennial']},
  'dem':   {'v': ['dem'],
            'bl': ['demented', 'dementia', 'demure', 'demean', 'demeaning',
                   'demeanor', 'demise', 'misdemeanor', 'misdemeanors',
                   'demoralize', 'demoralizes', 'demoralizing']},
  'hydro': {'v': ['hydr', 'hydro'],
            'ex': ['carbohydrate']},
  'path':  {'v': ['path'],
            'bl': ['path', 'paths', 'pathway', 'pathways', 'footpath', 'bikepath']},
  'corp':  {'v': ['corp'], 'bl': ['corp'],
            'ex': ['corporeal', 'corpulent', 'corpulence']},
  'geo':   {'v': ['geo']},
  'mort':  {'v': ['mort'], 'bl': ['mortise', 'mort', 'mortar', 'mortarboard']},
  'therm': {'v': ['therm', 'thermo'],
            'ex': ['thermos', 'hypothermia'],
            'bl': ['hypertherm']},
  'morph': {'v': ['morph', 'morpho'],
            'ex': ['anthropomorphic']},
  'stell': {'v': ['stell']},
}
# 分词允许的词尾静默残留(连接成分/词尾脱落后残留)
FINAL_SILENT = {'e', 'ue', 'u', 'i', 'us'}

PREFIXES = {
  'circum': '环绕', 'contra': '相反', 'counter': '相反', 'extra': '超出', 'inter': '之间',
  'intra': '在内', 'intro': '向内', 'infra': '在下', 'ortho': '正确', 'peri': '周围',
  'photo': '光', 'micro': '微小', 'macro': '宏大', 'mega': '巨大', 'poly': '多',
  'post': '之后', 'proto': '原始', 'pseudo': '假', 'retro': '向后', 'semi': '半',
  'super': '在上', 'anti': '反对', 'auto': '自动', 'fore': '预先', 'homo': '相同',
  'hyper': '过度', 'hypo': '低下', 'mis': '错误', 'mono': '单一', 'multi': '多重',
  'over': '过度', 'omni': '全部', 'pan': '全', 'para': '旁侧', 'pent': '五',
  'bene': '好', 'amphi': '两侧', 'cata': '向下', 'tele': '远', 'trans': '横过',
  'ultra': '超出', 'un': '不', 'dis': '分开', 'sub': '在下', 'out': '出',
  'pre': '预先', 'pro': '向前', 'syn': '共同', 'sym': '共同', 'com': '共同',
  'con': '共同', 'col': '共同', 'cor': '共同', 'co': '共同', 'de': '向下',
  'dia': '穿过', 'non': '不', 'ob': '朝向', 'oc': '朝向', 'of': '朝向',
  'op': '朝向', 'per': '贯穿', 'pos': '在后', 're': '再', 'se': '分开',
  'suc': '在下', 'suf': '在下', 'sug': '在下', 'sup': '在下', 'sur': '在上',
  'sus': '在下', 'ex': '向外', 'ef': '向外', 'em': '使…', 'en': '使…',
  'in': '进入', 'im': '进入', 'il': '进入', 'ir': '进入', 'bi': '二', 'di': '二',
  'tri': '三', 'uni': '单一', 'neo': '新', 'eu': '好', 'ab': '离开',
  'ad': '朝向', 'al': '朝向', 'ap': '朝向', 'ar': '朝向', 'as': '朝向',
  'at': '朝向', 'a': '朝向', 'e': '向外', 'ana': '并列', 'epi': '在上',
  'ep': '在上', 'meta': '变化', 'ver': '真', 'tra': '横过', 'equi': '同等',
  'exo': '向外', 'endo': '向内', 'cent': '百', 'socio': '社会', 'iso': '相等',
  'aut': '自身', 'dys': '不良', 'ideo': '观念', 'techno': '技术', 'psycho': '心理',
  'archaeo': '古老', 'soci': '社会', 'anthropo': '人类', 'neuro': '神经',
  'mytho': '神话', 'zoo': '动物', 'cosmo': '宇宙', 'cardio': '心脏',
  'derm': '皮肤', 'gastro': '胃', 'medi': '中间',
}
SUFFIXES = {
  'ation': ('n', '行为/结果'), 'ition': ('n', '行为/结果'), 'ution': ('n', '行为/结果'),
  'sion': ('n', '行为/结果'), 'tion': ('n', '行为/结果'), 'ture': ('n', '行为/结果'),
  'ment': ('n', '行为/结果'), 'ness': ('n', '状态'), 'ance': ('n', '状态/行为'),
  'ence': ('n', '状态/行为'), 'ancy': ('n', '状态'), 'ency': ('n', '状态'),
  'ity': ('n', '性质'), 'ship': ('n', '身份/关系'), 'hood': ('n', '状态'),
  'dom': ('n', '状态/领域'), 'ism': ('n', '主义/学说'), 'ist': ('n', '人'),
  'ician': ('n', '专业人员'), 'ology': ('n', '学问'), 'graphy': ('n', '记录'),
  'ability': ('n', '能力'), 'acity': ('n', '性质'), 'acity?x': ('n', ''),
  'able': ('a', '可…的'), 'ible': ('a', '可…的'), 'ably': ('ad', '…地'),
  'ibly': ('ad', '…地'), 'ical': ('a', '…的'), 'ial': ('a', '…的'),
  'ious': ('a', '…的'), 'eous': ('a', '…的'), 'uous': ('a', '…的'),
  'aceous': ('a', '…的'), 'acious': ('a', '…的'), 'ative': ('a', '…的'),
  'etic': ('a', '…的'), 'ure': ('n', '行为/结果'), 'age': ('n', '行为/结果'),
  'ette': ('n', '小'), 'let': ('n', '小'), 'ary': ('a', '…的'), 'ory': ('a', '…的'),
  'itive': ('a', '…的'), 'ive': ('a', '有…性质的'), 'ful': ('a', '充满…的'),
  'less': ('a', '无…的'), 'ous': ('a', '…的'), 'ic': ('a', '…的'),
  'al': ('a', '…的'), 'ile': ('a', '可…的'), 'ish': ('a', '略…的'),
  'like': ('a', '像…的'), 'ly': ('ad', '…地'), 'ate': ('v', '动词后缀'),
  'fy': ('v', '动词后缀'), 'ify': ('v', '动词后缀'), 'ize': ('v', '动词后缀'),
  'ise': ('v', '动词后缀'), 'er': ('n', '者/物'), 'or': ('n', '者/物'),
  'ee': ('n', '受动者'), 'ess': ('n', '女性'), 'ion': ('n', '行为/结果'),
  'ing': ('n', '进行'), 'ed': ('n', '完成'), 'es': ('n', '复数'), 's': ('n', '复数'),
  'y': ('n', '状态'), 'an': ('a', '…的'), 'id': ('a', '…的'),
  'ant': ('a', '…的'), 'ent': ('a', '…的'), 'ate?x': ('v', ''),
  'ulate': ('v', '动词后缀'), 'ulite': ('a', '…的'), 'ulous': ('a', '…的'),
  'ate2': ('v', ''), 'ature': ('n', '行为/结果'), 'iture': ('n', '行为/结果'),
  'itical': ('a', '…的'), 'icular': ('a', '…的'), 'acular': ('a', '…的'),
  'acular?x': ('a', ''), 'ital': ('a', '…的'), 'icle': ('n', '小'),
  'osis': ('n', '状态/过程'), 'os': ('n', '状态'), 'itorial': ('a', '…的'),
  'ar': ('a', '…的'),
}
SUFFIXES = {k: v for k, v in SUFFIXES.items() if not k.endswith('?x')}
SILENT_LINKS = set('iuoa')
# 只允许作第一个前缀剥离的(拉丁同化型 ad-/ob- 变体等, 真实构词中不叠在其他前缀后)
FIRST_ONLY_PREFIX = {'a', 'e', 'as', 'at', 'ap', 'ar', 'al', 'ag', 'af', 'ac',
                     'ob', 'oc', 'of', 'op'}

def strip_prefixes(head):
  """head 能否全部由已知前缀解释(可多层)。"""
  used = 0
  while head:
    for p in sorted(PREFIXES, key=len, reverse=True):
      if head.startswith(p) and not (p == 'a' and len(head) > 2):
        if p in FIRST_ONLY_PREFIX and used > 0:
          continue
        used += len(p)
        head = head[len(p):]
        break
    else:
      return False
  return True

def strip_suffixes(tail):
  """tail 能否全部由已知后缀+连接元音+词尾静默残留解释。后缀整体命中优先, 静默元音兜底。"""
  guard = 0
  while tail:
    guard += 1
    if guard > 8:
      return False
    if tail in FINAL_SILENT:
      return True
    for s in sorted(SUFFIXES, key=len, reverse=True):
      if tail.endswith(s):
        tail = tail[:-len(s)]
        break
    else:
      # 无后缀整体命中才试连接元音(后跟其余后缀)与单连接元音
      if len(tail) >= 2 and tail[0] in SILENT_LINKS and any(
          tail[1:].endswith(s) for s in SUFFIXES):
        tail = tail[1:]
        continue
      if len(tail) == 1 and tail in SILENT_LINKS:
        tail = ''
        continue
      return False
  return True

WR_FAMILY = {}   # ECDICT 词根表例词 -> 家族(组合词根兜底)

def segment(word):
  """返回 (family, variant, pos, head, tail) 或 None。多家族命中取词根位置最早者。"""
  w = word.lower()
  best = None
  for fam, cfg in FAMILIES.items():
    if w in cfg.get('bl', []):
      continue
    for var in cfg['v']:
      pos = w.find(var)
      if pos < 0:
        continue
      head, tail = w[:pos], w[pos + len(var):]
      if head and not strip_prefixes(head):
        break
      if tail and not strip_suffixes(tail):
        break
      cand = (pos, -len(var), fam, var, head, tail)
      if best is None or cand < best:
        best = cand
      break
  if best:
    _, _, fam, var, head, tail = best
    return fam, var, head, tail
  # EXTRA 白名单(词源真实但表面分词失败)
  for fam, cfg in FAMILIES.items():
    if w in cfg.get('ex', []):
      return fam, None, None, None
  # ECDICT 词根表背书的例词:组合词根(anemo+graph 等)表面切不开,按词根表归属
  if w in WR_FAMILY:
    fam = WR_FAMILY[w]
    if w not in FAMILIES[fam].get('bl', []):
      return fam, None, None, None
  return None

def used_prefixes(head):
  out = []
  used = 0
  while head:
    for p in sorted(PREFIXES, key=len, reverse=True):
      if head.startswith(p) and not (p == 'a' and len(head) > 2):
        if p in FIRST_ONLY_PREFIX and used > 0:
          continue
        out.append(p)
        used += len(p)
        head = head[len(p):]
        break
    else:
      break
  return out

def used_suffixes(tail):
  out = []
  guard = 0
  while tail and guard < 8:
    guard += 1
    if tail in FINAL_SILENT:
      break
    for s in sorted(SUFFIXES, key=len, reverse=True):
      if tail.endswith(s):
        out.append(s)
        tail = tail[:-len(s)]
        break
    else:
      if len(tail) >= 2 and tail[0] in SILENT_LINKS and any(
          tail[1:].endswith(s) for s in SUFFIXES):
        tail = tail[1:]
        continue
      if len(tail) == 1 and tail in SILENT_LINKS:
        tail = ''
      break
  return out

# ============ 词源拆解渲染: 贴现有手写格式 "pre-(预先) + dict(说) → 推导 → 词义" ============
RENDER_SKIP_SFX = {'s', 'es', 'ed', 'ing'}          # 屈折词尾不进词源拆解
NEG_IN_PREFIX = {'in', 'im', 'il', 'ir'}            # able/ible 等形容词后缀前, in- 译「不」
NEG_SFX = {'able', 'ible', 'ous', 'uous', 'eous', 'ious', 'ic', 'ical', 'ive', 'ile',
           'ent'}
ANTI_ANTE = {'anticipate', 'anticipation', 'anticipatory', 'anticipated', 'unanticipated'}

def render_etymology(word, fam, root_meaning, trans):
  seg = segment(word)
  if not seg:
    return None
  fam2, var, head, tail = seg
  parts, gloss = [], []
  if var:
    prefixes = used_prefixes(head)
    sfxs = [s for s in reversed(used_suffixes(tail)) if s not in RENDER_SKIP_SFX]
    for p in prefixes:
      g = PREFIXES[p]
      if p == 'anti' and word in ANTI_ANTE:
        g = '预先'  # anticipate 族实为 ante-(前)
      if p in NEG_IN_PREFIX and sfxs and sfxs[-1] in NEG_SFX:
        g = '不'   # inconceivable/inaudible 的 in- 是否定义
      parts.append(f'{p}-({g})')
      gloss.append(g)
    parts.append(f'{var}({root_meaning})')
    gloss.append(root_meaning)
    cat = None
    for s in sfxs:
      c, g = SUFFIXES[s]
      parts.append(f'-{s}({g})')
      cat = cat or c
    bridge = ''.join(g for g in gloss if g)
    if any(s in ('ology', 'graphy') for s in sfxs):
      bridge = f'研究{root_meaning}的学问' if 'ology' in sfxs else f'记录{root_meaning}之学'
    elif cat == 'n':
      pass
    elif cat == 'a':
      bridge += '的'
    elif cat == 'ad':
      bridge += '地'
  else:  # EXTRA 白名单词: 只标注词根归属
    parts.append(f'{fam}({root_meaning}) 词根族词')
    bridge = root_meaning
  meaning = (trans or '').split('；')[0].strip() or word
  return f"{' + '.join(parts)} → {bridge} → {meaning}"

# ============ db ============
def load_db():
  """基线读 data/words.json(种子即真相源): {word: row} + {family: {meaning, n}}"""
  p = os.path.join(HERE, '..', 'data', 'words.json')
  words, fams = {}, {}
  for it in json.load(io.open(p, encoding='utf-8')):
    words[it['word'].lower()] = it
    f = fams.setdefault(it['family'], {'meaning': it['root_meaning'], 'n': 0})
    f['n'] += 1
  return words, fams

# ============ 来源加载 ============
BOOK_TAGS = [('CET4', 2), ('CHUZHONG', 1), ('GAOZHONG', 1), ('Level4', 2),
             ('CET6', 3), ('KaoYan', 3), ('TOEFL', 3), ('IELTS', 3), ('NPEE', 3),
             ('SAT', 3), ('GRE', 3), ('Level8', 3), ('GMAT', 3), ('BEC', 3),
             ('XiaoXue', 1), ('TEM8', 3)]
def load_books():
  """kajweb 词书 zip -> {word: {phone, trans[], examples[], tags set, rank_min}}"""
  books = {}
  d = os.path.join(SRC, 'kajweb')
  if not os.path.isdir(d):
    return books
  loaded = []
  for z in sorted(os.listdir(d)):
    if not z.endswith('.zip') or z == 'test_jsd.zip':
      continue
    tag = None
    for t, _ in BOOK_TAGS:
      if t.lower() in z.lower():
        tag = t
        break
    if not tag:
      continue
    n = 0
    try:
      with zipfile.ZipFile(os.path.join(d, z)) as f:
        name = next(n for n in f.namelist() if n.endswith('.json'))
        for line in f.read(name).decode('utf-8', 'replace').splitlines():
          if not line.strip():
            continue
          try:
            it = json.loads(line)
            c = it['content']['word']['content']
            w = it['content']['word']['wordHead'].lower()
          except Exception:
            continue
          n += 1
          ent = books.setdefault(w, {'phone': None, 'trans': [], 'examples': [],
                                      'tags': set(), 'rank': 9999})
          ent['rank'] = min(ent['rank'], it.get('wordRank', 9999))
          if c.get('phone') and not ent['phone']:
            ent['phone'] = c['phone']
          for t2 in (c.get('trans') or []):
            if t2.get('tranCn'):
              ent['trans'].append({'pos': t2.get('pos', ''), 'cn': t2['tranCn'].strip()})
          seen_en = {e['en'] for e in ent['examples']}
          for s in (c.get('sentence', {}).get('sentences') or []):
            if s.get('sContent') and s.get('sCn') and s['sContent'] not in seen_en \
               and len(ent['examples']) < 2:
              ent['examples'].append({'en': s['sContent'], 'zh': s['sCn']})
              seen_en.add(s['sContent'])
          if len(ent['examples']) < 2:
            for s in (c.get('realExamSentence', {}).get('sentences') or []):
              if s.get('sContent') and s.get('sCn') and s['sContent'] not in seen_en \
                 and len(ent['examples']) < 2:
                ent['examples'].append({'en': s['sContent'], 'zh': s['sCn']})
                seen_en.add(s['sContent'])
          ent['tags'].add(tag)
      loaded.append(f'{z.replace(".zip","")}[{tag}]={n}')
    except Exception as e:
      print(f'  [warn] 词书加载失败 {z}: {e.__class__.__name__}')
  if loaded:
    print(f'  词书加载 {len(loaded)} 本: ' + ' '.join(loaded[:8]) + ('…' if len(loaded) > 8 else ''))
  return books

def load_lists():
  """纯词表 -> {word: tags}"""
  out = {}
  def add(w, tag):
    # 取空白/斜杠/逗号前的首 token; 星标(*)与标点剥离; 只要纯字母词
    w = re.split(r'[\s/,]', w.strip())[0]
    w = w.lstrip('*·').strip('.,;:()[]').strip().lower()
    if w and w.isalpha() and len(w) > 1:
      out.setdefault(w, set()).add(tag)
  kb = os.path.join(SRC, 'english-vocabulary')
  if os.path.isdir(kb):
    pref = {'1': 'CHUZHONG', '2': 'GAOZHONG', '3': 'CET4', '4': 'CET6',
            '5': 'KaoYan', '6': 'TOEFL', '7': 'SAT'}
    for f in os.listdir(kb):
      t = pref.get(f[:1])
      if t and f.endswith('.txt'):
        for line in io.open(os.path.join(kb, f), encoding='utf-8', errors='replace'):
          if line.strip():
            add(line.split('\t')[0], t)
  mv = os.path.join(SRC, 'english-wordlists')
  if os.path.isdir(mv):
    for f, t in [('CET4_edited.txt', 'CET4'), ('CET6_edited.txt', 'CET6'),
                 ('GRE_8000_Words.txt', 'GRE'), ('NPEE_Wordlist.txt', 'KaoYan'),
                 ('GRE_delete_CET4+6+TOEFL.txt', 'GRE'), ('Highschool_edited.txt', 'GAOZHONG'),
                 ('CET_4+6_edited.txt', 'CET6'), ('SUM_of_cet4+6+toefl+gre.txt', 'GRE'),
                 ('TOEFL.txt', 'TOEFL'), ('中考英语词汇表.txt', 'CHUZHONG'),
                 ('小学英语大纲词汇.txt', 'XiaoXue'), ('台灣高中英文參考詞彙表.txt', 'GAOZHONG'),
                 ('英语专业星标八级词汇.txt', 'TEM8'), ('英语六级词汇（星标，1726）.txt', 'CET6'),
                 ('红宝书 GRE词汇精选.csv', 'GRE')]:
      p = os.path.join(mv, f + ('' if os.path.exists(os.path.join(mv, f)) else '.txt'))
      if os.path.isfile(p):
        for line in io.open(p, encoding='utf-8', errors='replace'):
          if line.strip():
            add(line.split('\t')[0], t)
    coca = os.path.join(mv, 'COCA_20000.txt')
    if os.path.isfile(coca):
      for line in io.open(coca, encoding='utf-8', errors='replace'):
        if line.strip():
          add(line.split('\t')[0], 'COCA')
  fi = os.path.join(SRC, 'IELTS', 'IELTS Word List.txt')
  if os.path.isfile(fi):
    for line in io.open(fi, encoding='utf-8', errors='replace'):
      if line.strip():
        add(line.split('\t')[0], 'IELTS')
  return out

def load_ecdict():
  out = {}
  p = os.path.join(SRC, 'ecdict.csv')
  if not os.path.isfile(p):
    return out
  with io.open(p, encoding='utf-8', errors='replace', newline='') as fh:
    rd = csv.DictReader(fh)
    for r in rd:
      w = (r.get('word') or '').strip().lower()
      if not w or not w[0].isalpha() or len(w) < 3:
        continue
      tag = (r.get('tag') or '')
      out[w] = {'phonetic': (r.get('phonetic') or '').strip(),
                'translation': (r.get('translation') or '').strip().replace('\\n', '；'),
                'pos': (r.get('pos') or '').strip(), 'tag': tag,
                'frq': int(r['frq']) if (r.get('frq') or '').strip().isdigit() else 0,
                'bnc': int(r['bnc']) if (r.get('bnc') or '').strip().isdigit() else 0}
  return out

def load_wordroot_examples():
  """wordroot.txt: 各词根条目的例词(词源级背书)"""
  p = os.path.join(SRC, 'wordroot.txt')
  out = set()
  if not os.path.isfile(p):
    return out
  data = json.load(io.open(p, encoding='utf-8'))
  for key, ent in data.items():
    fam_hit = None
    for v in key.split(','):
      v = v.strip().lstrip('-')
      if not v or len(v) < 3:
        continue
      for fam, cfg in FAMILIES.items():
        if v in cfg['v']:
          fam_hit = fam
          for w in ent.get('example', []):
            ww = w.lower().strip()
            out.add(ww)
            if re.fullmatch(r'[a-z]+', ww):
              WR_FAMILY.setdefault(ww, fam)
    # 该词根条目已归属某家族:例词全部按此家族兜底(组合词根切不开时用)
    if fam_hit:
      for w in ent.get('example', []):
        ww = w.lower().strip()
        if re.fullmatch(r'[a-z]+', ww):
          WR_FAMILY.setdefault(ww, fam_hit)
  return out

# ============ 组装 ============
TAG_LEVEL = {t: lv for t, lv in BOOK_TAGS}
# 词级口径对齐库内: receive/export/sympathy=1(初高中), participate=2(CET4), perceive=3(CET6/考研+)
EC_DICT_TAG_LEVEL = {'zk': 1, 'gk': 1, 'middle': 1, 'high': 1,
                     'cet4': 2, 'level4': 2, 'cet6': 3, 'ky': 3, 'postgk': 3,
                     'toefl': 3, 'ielts': 3, 'gre': 3, 'sat': 3, 'level8': 3}
POS_MAP = {'n': 'n.', 'v': 'v.', 'vt': 'v.', 'vi': 'v.', 'adj': 'adj.', 'a': 'adj.',
           'adv': 'adv.', 'ad': 'adv.', 'prep': 'prep.', 'pron': 'pron.',
           'conj': 'conj.', 'num': 'num.', 'int': 'int.', 'aux': 'v.',
           'abbr': 'n.', 'inf': 'v.'}

def cascade_level(lvs):
  """多级并存取最早学到的(receive 同时在 zk 与 gre 表 -> 1)。"""
  return min(lvs) if lvs else 0

def clean_meaning(segs):
  """词书释义段拆分去重(原始 tranCn 混有中释/同近重复),统一为 ≤4 个义项。"""
  out, seen = [], set()
  for seg in segs:
    for part in re.split(r'[；;，,、]', seg):
      part = part.strip()
      part = re.sub(r'\[[^\]]{1,10}\]', '', part).strip()     # 去元标签 [医][计][略作..]
      part = re.sub(r'^(?:n|v|vt|vi|a|ad|adj|adv|num|art|pron|prep|conj|int|abbr)\.\s*', '',
                    part).strip()  # 去词性前缀(库内释义不带)
      part = re.sub(r'[（(](?:等于|=)[^）)]*[）)]', '', part).strip()  # 去"等于xxx"变体注
      if '■' in part or '\ufffd' in part:
        continue  # ECDICT 个别坏码释义,不收
      if not part or part in seen or part.isdigit():
        continue
      if len(part) > 2 and re.fullmatch(r"[A-Za-z0-9 .'’\-()]+", part):
        continue  # 跳过纯英文碎片(英释/标签混入)
      seen.add(part)
      out.append(part)
      if len(out) >= 4:
        return out
  return out

def fmt_ipa(ph):
  if not ph:
    return None
  ph = ph.split(', ')[0].strip().replace('/', '')
  ph = ph.replace("'", 'ˈ').replace(',', 'ˌ').strip(' .')
  return '/' + ph + '/' if ph else None

def assemble(word, fam, fam_meaning, book, ec, lists_tags, wr):
  """返回可插入行或 None(内容不足即跳过)"""
  phone, meaning_parts, pos_str = None, [], None
  examples = []
  if book:
    phone = book['phone']
    if book['trans']:
      poss, seen = [], set()
      for t in book['trans'][:3]:
        p = POS_MAP.get(t['pos'].strip().lower())
        if p and p not in seen:
          poss.append(p)
          seen.add(p)
      pos_str = '/'.join(poss) or 'n.'
      meaning_parts = [t['cn'] for t in book['trans']]
    examples = book['examples'][:2]
  if ec:
    if not phone and ec['phonetic']:
      phone = ec['phonetic']
    if not meaning_parts and ec['translation']:
      meaning_parts = [ec['translation'].replace('\\n', '；')]
      if not pos_str and ec['pos']:
        p = POS_MAP.get(ec['pos'].strip().lower())
        pos_str = p or 'n.'
  segs = clean_meaning(meaning_parts)
  if not segs:
    return None  # 无真实释义,不编造
  ipa = fmt_ipa(phone)
  if not ipa:
    return None  # 无音标来源
  trans_str = '；'.join(segs)
  # 词级: ECDICT tag 阶梯优先(口径最细), 缺则书/表标签阶梯, 再缺 COCA -> 2
  tags = set(book['tags'] if book else []) | set(lists_tags or set())
  lv = 0
  if ec and ec['tag']:
    lv = cascade_level([EC_DICT_TAG_LEVEL[t.strip()] for t in ec['tag'].split()
                        if t.strip() in EC_DICT_TAG_LEVEL])
  if not lv:
    lv = cascade_level([TAG_LEVEL[t] for t in tags if t in TAG_LEVEL])
  if not lv and 'COCA' in tags:
    lv = 2
  if not lv and word in wr:
    lv = 3  # wordroot.txt 例词: ECDICT 官方词根表背书的经典族词
  if not lv:
    return None  # 不在任何考纲/频率表 -> 不收
  ety = render_etymology(word, fam, fam_meaning, trans_str)
  if not ety:
    return None
  return {
    'word': word, 'ipa': ipa, 'pos': pos_str or 'n.', 'meaning': trans_str,
    'root': fam, 'root_meaning': fam_meaning, 'etymology': ety,
    'collocations': '[]', 'examples': json.dumps(examples, ensure_ascii=False),
    'family': fam, 'level': lv, 'mnemonic': None,
    '_rank': (0 if book else 1, (book or {}).get('rank', 9999),
              -(ec['frq'] if ec else 0)),
  }

# ============ 主流程 ============
def main(apply=False):
  words, fams = load_db()
  print(f'库内 {len(words)} 词 / {len(fams)} 家族')
  books = load_books()
  lists = load_lists()
  ec = load_ecdict()
  wr = load_wordroot_examples()
  print(f'词书 {len(books)} 词条 | 词表 {len(lists)} | ECDICT {len(ec)} | 词根例词 {len(wr)}')

  pool = set(books) | set(lists) | wr
  # ECDICT 自带考纲 tag 的词也播种(有 tag 即考纲词, 值得学习)
  ec_exam = {w for w, r in ec.items()
             if any(t in r['tag'] for t in EC_DICT_TAG_LEVEL)}
  pool |= ec_exam
  pool -= set(words)
  print(f'候选池(去重去库内) {len(pool)} (含 ECDICT 考纲词 {len(ec_exam)})')

  by_fam = {}
  rejected = {}
  for w in sorted(pool):
    seg = segment(w)
    if not seg:
      continue
    fam = seg[0]
    row = assemble(w, fam, fams[fam]['meaning'], books.get(w), ec.get(w),
                   lists.get(w, set()), wr)
    if row:
      by_fam.setdefault(fam, []).append(row)
    else:
      rejected.setdefault(fam, []).append(w)
  # 屈折形让位原形: 单数/过去式/进行体已在库或候选中时弃屈折形(known 含 DB 基线)
  all_words = {r['word'] for rs in by_fam.values() for r in rs}
  known = all_words | set(words)
  IRREGULAR = {'spent': 'spend'}
  def bases(w):
    out = []
    if w in IRREGULAR:
      out.append(IRREGULAR[w])
    if w.endswith('ices'):
      out.append(w[:-4] + 'ex')          # indices -> index
    if w.endswith('es') and len(w) > 3:
      out.append(w[:-2])                 # buses -> bus
    if w.endswith('s') and len(w) > 2:
      out.append(w[:-1])                 # visas -> visa
    if w.endswith('ed') and len(w) > 4:
      out.append(w[:-2]); out.append(w[:-1])   # converted->convert, united->unite
    if w.endswith('ing') and len(w) > 5:
      out.append(w[:-3]); out.append(w[:-3] + 'e')  # viewing->view, continuing->continue
    return [b for b in out if len(b) > 2]
  # 英式拼写让位美式形(sympathise -> sympathize 已在时弃英式)
  # ant->ent 不泛化(pendant/pendent 是两个真词), 仅显式映射 dependant -> dependent
  uk_map = [(-3, 'ise', 'ize'), (-7, 'isation', 'ization'), (-3, 'yse', 'yze'),
            (-3, 'our', 'or'), (-2, 're', 'er')]
  UK_TWIN = {'dependant': 'dependent'}
  def us_twin(w):
    if w in UK_TWIN:
      return UK_TWIN[w]
    for cut, uk, us in uk_map:
      if w.endswith(uk):
        return w[:cut] + us
    return None
  for fam, rs in list(by_fam.items()):
    by_fam[fam] = [r for r in rs
                   if not any(b in known for b in bases(r['word']))
                   and not (us_twin(r['word']) and us_twin(r['word']) in known)]

  # 全量收:上一轮 15/33 配额把大量合格候选留在池外,本轮全部过质量门的候选即收
  picked = []
  print('\n== 家族全量 ==')
  for fam in sorted(by_fam, key=lambda f: -len(by_fam[f])):
    cur = fams.get(fam, {'n': 0})['n']
    cands = sorted(by_fam[fam], key=lambda r: r['_rank'])
    chosen = cands
    picked += chosen
    print(f'{fam}({cur}→+{len(chosen)}/{len(cands)} 候选{", 弃" + str(len(rejected.get(fam, []))) if rejected.get(fam) else ""}): '
          + ' '.join(r['word'] for r in chosen[:20]) + ('…' if len(chosen) > 20 else ''))
  print(f'\n合计入库 {len(picked)} 词')

  # 无内容被拒样本(检查是否有漏)
  rej_sample = [w for ws in rejected.values() for w in ws]
  print(f'内容不足被拒 {len(rej_sample)}: {" ".join(rej_sample[:40])} …')

  out = os.path.join(HERE, 'enrich-candidates.json')
  with io.open(out, 'w', encoding='utf-8') as f:
    json.dump([{k: v for k, v in r.items() if not k.startswith('_')} for r in picked],
              f, ensure_ascii=False, indent=1)
  print(f'候选已写出: {out}')

  if apply:
    seed_path = os.path.join(HERE, '..', 'data', 'words.json')
    existing = json.load(io.open(seed_path, encoding='utf-8'))
    known = {w['word'].lower() for w in existing}
    fresh = [r for r in picked if r['word'] not in known]
    dup = len(picked) - len(fresh)
    if not fresh:
      print(f'\n候选全部已在 words.json({dup} 重复), 无需写入')
    else:
      backup = seed_path + f'.bak-{time.strftime("%Y%m%d-%H%M%S")}'
      shutil.copy2(seed_path, backup)
      def to_seed(r):
        return {'word': r['word'], 'ipa': r['ipa'], 'pos': r['pos'],
                'meaning': r['meaning'], 'root': r['root'],
                'root_meaning': r['root_meaning'], 'etymology': r['etymology'],
                'collocations': [], 'examples': json.loads(r['examples']),
                'family': r['family'], 'level': r['level'], 'mnemonic': None}
      existing += [to_seed(r) for r in fresh]
      with io.open(seed_path, 'w', encoding='utf-8') as f:
        json.dump(existing, f, ensure_ascii=False, indent=2)
      print(f'\nwords.json 合并写入 {len(fresh)} 新词(重复跳过 {dup}); 总数 {len(existing)}; 备份: {backup}')
      print('下一步: 重启服务或跑 seed 使 MySQL/SQLite 与种子同步(user_words 学习数据不受影响)')

if __name__ == '__main__':
  main(apply='--apply' in sys.argv)
