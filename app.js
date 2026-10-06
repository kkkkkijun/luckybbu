/* 출산가방 체크리스트 - vanilla JS, localStorage only */
(function () {
  'use strict';

  var STORAGE_KEY = 'birth-bag-checklist';
  var UI_KEY = 'birth-bag-checklist:ui';
  var DATA_VERSION = 1;
  var UNDO_MS = 8000;
  var ICON_PRESETS = ['🧳', '🛏️', '👶🏻', '🤱🏻', '🍼', '🧸', '🏥', '🎒', '🧴', '👕', '📄', '✨'];
  var ICON_MAX = 16; // UTF-16 code units; enough for one multi-codepoint emoji
  var NOTE_MAX = 5000;
  var HIGHLIGHT_MAX = 2000;
  var PICK_MAX = 8000;
  var PICK_KEYS = ['gpt', 'claude'];
  var DATE_LABEL_MAX = 30, DATE_MEMO_MAX = 500, DATE_TIME_MAX = 30;
  var NAME_MAX = 30, NAME_MEMO_MAX = 500, HANJA_CHARS_MAX = 20, HANJA_MEANING_MAX = 120;
  var MEMO_MAX = 5000;
  var SUPPORT_STATUS = ['todo', 'applied', 'received', 'na'];
  var SUPPORT_STATUS_LABEL = { todo: '확인 전', applied: '신청함', received: '받음', na: '해당 없음' };
  // 화면: portal(luckybbu 첫 화면) · ledger(가계부) · 나머지는 마미백 공간
  var VIEWS = ['portal', 'ledger', 'home', 'checklist', 'notes', 'picks', 'names', 'settings', 'supports', 'memos'];
  // 마미백 분류는 '출산'·'육아' 묶음으로 나뉜다. 예전 데이터는 이름으로 한 번 정한다.
  var GROUPS = ['birth', 'baby'];
  function defaultGroupFor(name) { var n = String(name || ''); if (/맞이|의류|출산|병원|조리원/.test(n)) return 'birth'; return /육아|이유식|예방접종|성장/i.test(n) ? 'baby' : 'birth'; }
  // 가계부
  var LEDGER_OUT_CATS = ['식비', '생활', '육아·출산', '교통', '의료', '쇼핑', '기타'];
  var LEDGER_IN_CATS = ['급여', '부수입', '기타'];
  var LEDGER_PAYS = { card: '카드', cash: '현금', bank: '계좌' };
  var LEDGER_TEXT_MAX = 60, LEDGER_MAX = 5000;
  function normalizeLedger(raw) {
    var out = [], seen = {};
    listOf(raw).forEach(function (e) {
      if (!e || typeof e !== 'object') return;
      var id = typeof e.id === 'string' ? e.id.trim().replace(/[.#$\[\]\/]/g, '_') : ''; // Firebase 키에 못 쓰는 글자
      var amount = typeof e.amount === 'number' && isFinite(e.amount) ? Math.round(e.amount) : NaN;
      var date = typeof e.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(e.date) ? e.date : '';
      if (!id || seen[id] || !date || !(amount > 0) || amount > PRICE_MAX) return; // broken entries are dropped
      seen[id] = true;
      var type = e.type === 'in' ? 'in' : 'out';
      var cats = type === 'in' ? LEDGER_IN_CATS : LEDGER_OUT_CATS;
      out.push({ id: id, date: date, type: type, amount: amount, cat: cats.indexOf(e.cat) !== -1 ? e.cat : '기타',
        text: typeof e.text === 'string' ? e.text.trim().slice(0, LEDGER_TEXT_MAX) : '',
        who: typeof e.who === 'string' ? e.who.trim().slice(0, 12) : '',
        pay: LEDGER_PAYS[e.pay] ? e.pay : '', t: typeof e.t === 'number' ? e.t : 0 });
    });
    // 기기·서버가 같은 순서를 갖도록 적은 시각 → id 순으로 둔다
    out.sort(function (a, b) { return (a.t - b.t) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0); });
    return out.slice(0, LEDGER_MAX);
  }
  function asArray(v) {
    if (Array.isArray(v)) return v;
    if (v && typeof v === 'object') return Object.keys(v).map(function (k) { return v[k]; });
    return [];
  }
  function pickLabel(key) { return key === 'gpt' ? 'GPT' : 'Claude'; }
  function cleanPickText(text) {
    return String(text == null ? '' : text).replace(/\r\n?/g, '\n').replace(/\n{4,}/g, '\n\n\n').trim().slice(0, PICK_MAX);
  }
  function emptyPicks() { return { gpt: '', claude: '' }; }
  function normalizePicks(raw) {
    var picks = emptyPicks();
    if (raw && typeof raw === 'object') {
      PICK_KEYS.forEach(function (k) { if (typeof raw[k] === 'string') picks[k] = cleanPickText(raw[k]); });
    }
    return picks;
  }

  // One line per point; leading bullet characters are stripped so pasted lists render cleanly.
  function cleanHighlights(text) {
    return String(text == null ? '' : text).replace(/\r\n?/g, '\n').split('\n')
      .map(function (l) { return l.trim().replace(/^[-*\u2022\u00b7]\s*/, ''); })
      .filter(function (l) { return l; })
      .join('\n').slice(0, HIGHLIGHT_MAX);
  }

  function defaultIconFor(name) {
    for (var i = 0; i < DEFAULT_TEMPLATE.length; i++) {
      if (DEFAULT_TEMPLATE[i].name === name) return DEFAULT_TEMPLATE[i].icon;
    }
    return '';
  }

  // Emoji saved before skin tones were applied -> same emoji with the light skin tone
  var ICON_TONE_UPGRADES = { '👶': '👶🏻', '🤱': '🤱🏻' };

  function cleanIcon(value) {
    return String(value == null ? '' : value).replace(/\s+/g, '').slice(0, ICON_MAX);
  }

  var DEFAULT_TEMPLATE = [
    { name: '출산가방', icon: '🧳', items: ['산모 수첩', '신분증', '손목 보호대', '가디건', '수유 브라 또는 나시', '수유 패드', '산모 패드', '산모 팬티', '입는 생리대', '생리대 오버나이트 또는 대형', '슬리퍼', '굽은 빨대', '텀블러 또는 종이컵', '비데 물티슈', '충전기', '수건', '물티슈', '세면도구', '양치도구', '머리끈 또는 머리띠', '보호자 의류'] },
    { name: '조리원가방', icon: '🛏️', items: ['발목 보호대', '돌돌이 양말', '임산부 레깅스', '압박 스타킹', '유축기', '유축기 깔때기', '초유 저장팩', '유두 보호 크림', '튼살 크림', '철분제 및 기타 영양제', '노트북', '태블릿', '무형광 세탁망', '각티슈', '기초 화장품', '네임펜', '메모지', '가위', '여분 지퍼백', '손톱깎이', '멀티탭', '보호자 침구'] },
    { name: '아기 용품', icon: '👶🏻', items: ['젖병', '젖꼭지', '젖병 세정 도구', '아기 손수건', '아기 배냇저고리', '속싸개', '겉싸개', '손싸개', '발싸개', '아기 모자', '아기 양말', '기저귀 발진 크림', '체온계', '바구니 카시트', '아기 세탁세제', '아기 물티슈', '아기 면봉', '아기 보습 제품', '아기 기저귀'] }
  ];

  /* ---------- utilities ---------- */
  function uid() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
    return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function $(sel, root) { return (root || document).querySelector(sel); }

  function parseQty(value) {
    // returns { ok, value } - value is null (empty) or integer >= 1
    var s = String(value == null ? '' : value).trim();
    if (s === '') return { ok: true, value: null };
    if (!/^\d+$/.test(s)) return { ok: false, value: null };
    var n = parseInt(s, 10);
    if (!isFinite(n) || n < 1) return { ok: false, value: null };
    return { ok: true, value: n };
  }

  // 금액: 숫자만 남겨 정수(원)로. 빈 값은 null. '5,000', '5000원', '5천원', '1.5만원' 허용
  var PRICE_MAX = 999999999;
  function parsePrice(value) {
    var t = String(value == null ? '' : value).trim().replace(/원$/, '').trim();
    if (t === '') return { ok: true, value: null };
    var k = t.match(/^(\d+(?:\.\d+)?)\s*(만|천)$/);
    var n;
    if (k) n = Math.round(parseFloat(k[1]) * (k[2] === '만' ? 10000 : 1000));
    else {
      var digits = t.replace(/[,\s]/g, '');
      if (!/^\d+$/.test(digits)) return { ok: false, value: null };
      n = parseInt(digits, 10);
    }
    if (!isFinite(n) || n < 0 || n > PRICE_MAX) return { ok: false, value: null };
    return { ok: true, value: n };
  }
  function formatNumber(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function formatWon(n) { return n === null || n === undefined ? '' : formatNumber(n) + '원'; }
  // 입력 중 쉼표 자동 삽입. 값이 바뀔 때만 다시 쓰고, 커서는 같은 숫자 개수 뒤에 둔다
  // (매번 값을 덮어쓰고 커서를 끝으로 보내면 모바일 키보드가 입력 위치를 잃어 숫자가 사라지거나 0만 남는다)
  function formatPriceInput(el) {
    var before = el.value;
    var caret = typeof el.selectionStart === 'number' ? el.selectionStart : before.length;
    var digitsLeft = before.slice(0, caret).replace(/[^\d]/g, '').length;
    var all = before.replace(/[^\d]/g, '');
    var trimmed = all.replace(/^0+(?=\d)/, '');
    digitsLeft = Math.max(0, digitsLeft - (all.length - trimmed.length));
    var digits = trimmed.slice(0, 9);
    var next = digits ? formatNumber(digits) : '';
    if (next === before) return;
    el.value = next;
    if (document.activeElement !== el || !el.setSelectionRange) return;
    var pos = 0, seen = 0;
    while (pos < next.length && seen < digitsLeft) { if (/\d/.test(next.charAt(pos))) seen++; pos++; }
    try { el.setSelectionRange(pos, pos); } catch (e) { /* ignore */ }
  }

  /* ---------- 메모의 표 ---------- */
  var TABLES_PER_MEMO = 5, TABLE_ROWS_MAX = 30, TABLE_COLS_MAX = 8, CELL_MAX = 300;
  var COL_W_MIN = 60, COL_W_MAX = 600, COL_W_DEFAULT = 130, ROW_H_MIN = 36, ROW_H_MAX = 300;
  function clampNum(v, lo, hi, dflt) { var n = typeof v === 'number' && isFinite(v) ? Math.round(v) : dflt; return Math.max(lo, Math.min(hi, n)); }
  function normalizeTables(raw) {
    var out = [], seen = {};
    listOf(raw).forEach(function (t) {
      if (!t || typeof t !== 'object' || out.length >= TABLES_PER_MEMO) return;
      var id = typeof t.id === 'string' ? t.id.trim().slice(0, 60) : '';
      if (!id || seen[id]) return;
      var rows = listOf(t.rows).slice(0, TABLE_ROWS_MAX).map(function (r) {
        return listOf(r).slice(0, TABLE_COLS_MAX).map(function (c) { return typeof c === 'string' ? c.replace(/\r\n?/g, '\n').slice(0, CELL_MAX) : ''; });
      });
      if (!rows.length) return;
      var nCols = Math.max.apply(null, rows.map(function (r) { return r.length; }).concat([1]));
      nCols = Math.min(TABLE_COLS_MAX, nCols);
      rows.forEach(function (r) { while (r.length < nCols) r.push(''); });
      var colsRaw = listOf(t.cols), rowHRaw = listOf(t.rowH);
      var cols = [], rowH = [];
      for (var i = 0; i < nCols; i++) cols.push(clampNum(colsRaw[i], COL_W_MIN, COL_W_MAX, COL_W_DEFAULT));
      for (var j = 0; j < rows.length; j++) rowH.push(clampNum(rowHRaw[j], ROW_H_MIN, ROW_H_MAX, ROW_H_MIN));
      seen[id] = true;
      out.push({ id: id, cols: cols, rowH: rowH, rows: rows });
    });
    return out;
  }

  /* ---------- 메모의 좋아요·댓글 정리 ---------- */
  var COMMENT_MAX = 300, COMMENTS_PER_MEMO = 50;
  function listOf(raw) { return Array.isArray(raw) ? raw : (raw && typeof raw === 'object' ? Object.keys(raw).map(function (k) { return raw[k]; }) : []); }
  function normalizeLikes(raw) {
    var out = [];
    listOf(raw).forEach(function (n) { if (typeof n !== 'string') return; var v = n.trim().slice(0, 12); if (v && out.indexOf(v) === -1 && out.length < 20) out.push(v); });
    return out;
  }
  function normalizeComments(raw) {
    var out = [], seen = {};
    listOf(raw).forEach(function (c) {
      if (!c || typeof c !== 'object') return;
      var id = typeof c.id === 'string' ? c.id.trim().slice(0, 60) : '';
      var text = typeof c.text === 'string' ? c.text.replace(/\r\n?/g, '\n').trim().slice(0, COMMENT_MAX) : '';
      if (!id || !text || seen[id]) return;
      seen[id] = true;
      out.push({ id: id, who: typeof c.who === 'string' ? c.who.trim().slice(0, 12) : '', text: text, t: typeof c.t === 'number' ? c.t : 0 });
    });
    out.sort(function (a, b) { return a.t - b.t; });
    return out.slice(-COMMENTS_PER_MEMO);
  }

  /* ---------- 상세 분류 (분류 안의 하위 탭) ---------- */
  var SUB_MAX = 12, SUB_NAME_MAX = 20;
  function normalizeSubs(raw) {
    var list = Array.isArray(raw) ? raw : (raw && typeof raw === 'object' ? Object.keys(raw).map(function (k) { return raw[k]; }) : []);
    var out = [], seen = {};
    list.forEach(function (x) {
      if (!x || typeof x !== 'object') return;
      var id = typeof x.id === 'string' ? x.id.trim().slice(0, 60) : '';
      var name = typeof x.name === 'string' ? x.name.trim().slice(0, SUB_NAME_MAX) : '';
      if (!id || !name || seen[id] || out.length >= SUB_MAX) return;
      seen[id] = true;
      out.push({ id: id, name: name, icon: typeof x.icon === 'string' ? cleanIcon(x.icon) : '' });
    });
    return out;
  }
  function subsOf(cat) { return (cat && cat.subs) || []; }
  function findSub(cat, id) { var l = subsOf(cat); for (var i = 0; i < l.length; i++) if (l[i].id === id) return l[i]; return null; }
  function subTabOf(cat) {
    var v = ui.subTab[cat.id];
    if (v === '__none') return v;
    return v && findSub(cat, v) ? v : '';
  }
  function hasSub(cat, it) { return !!(it.sub && findSub(cat, it.sub)); }
  function inSubScope(cat, it) {
    if (ui.editMode || !subsOf(cat).length) return true;
    var st = subTabOf(cat);
    if (!st) return true;
    if (st === '__none') return !hasSub(cat, it);
    return it.sub === st;
  }
  function subLabel(sub) { return (sub.icon ? sub.icon + ' ' : '') + sub.name; }

  /* ---------- 이름 태그 (기준·윤서·축복) ---------- */
  var TAG_NAMES = ['기준', '윤서', '축복'];
  var TAG_MAX = 6, TAGS_PER_ITEM = 5;
  function normalizeTags(raw) {
    if (!Array.isArray(raw)) return [];
    var out = [];
    raw.forEach(function (t) {
      if (typeof t !== 'string') return;
      var v = t.trim().slice(0, TAG_MAX);
      if (v && out.indexOf(v) === -1 && out.length < TAGS_PER_ITEM) out.push(v);
    });
    return out;
  }
  // "윤서, 기준 세면도구" → { tags: ['윤서','기준'], rest: '세면도구' } / "축복이 모자" → 축복
  var TAG_PREFIX_RE = new RegExp('^((?:' + TAG_NAMES.map(function (n) { return n + '이?'; }).join('|') + ')(?:\\s*[,·/+]\\s*(?:' + TAG_NAMES.map(function (n) { return n + '이?'; }).join('|') + '))*)\\s+(.+)$');
  function parseTagPrefix(text) {
    var m = String(text || '').match(TAG_PREFIX_RE);
    if (!m) return { tags: [], rest: String(text || '') };
    var tags = normalizeTags(m[1].split(/\s*[,·/+]\s*/).map(function (t) { return t.replace(/이$/, ''); }));
    return { tags: tags, rest: m[2].trim() };
  }
  function tagClass(tag) { var i = TAG_NAMES.indexOf(tag); return 'tag tag--' + (i === -1 ? 'x' : (i + 1)); }
  function tagsHtml(it) {
    if (!it.tags || !it.tags.length) return '';
    return it.tags.map(function (t) { return '<span class="' + tagClass(t) + '">' + escapeHtml(t) + '</span>'; }).join('');
  }
  function tagLabel(it) { return it.tags && it.tags.length ? it.tags.join('+') : '공용'; }

  function todayStamp() {
    var d = new Date();
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  function timeStamp() {
    var d = new Date();
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return p(d.getHours()) + ':' + p(d.getMinutes());
  }

  /* ---------- data model ---------- */
  // 기본 상태는 분류 3개만 만들고 준비물은 비워 둔다(직접 하나씩 추가). DEFAULT_TEMPLATE의 이름 목록은
  // 예전 버전이 채워 둔 '손대지 않은 예시 준비물'을 알아보고 한 번 비우는 데만 쓴다.
  var TEMPLATE_NAMES = {};
  DEFAULT_TEMPLATE.forEach(function (cat) { cat.items.forEach(function (n) { TEMPLATE_NAMES[n] = true; }); });
  function createDefaultState() {
    var categories = [];
    var items = [];
    DEFAULT_TEMPLATE.forEach(function (cat) {
      categories.push({ id: uid(), name: cat.name, icon: cat.icon, doneTabs: false, subs: [], group: defaultGroupFor(cat.name) });
    });
    return { version: DATA_VERSION, categories: categories, items: items, notes: [], highlights: '', picks: emptyPicks(), dates: [], names: [], dueDate: '', anniversary: '', memo: '', memos: [], supports: [], ledger: [], budget: 0 };
  }

  // Validates and normalises an unknown object into app state. Returns { ok, data, error }.
  function normalizeState(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: '파일 형식이 올바르지 않습니다.' };
    if (typeof raw.version !== 'number' || raw.version < 1) return { ok: false, error: '버전 정보가 없거나 올바르지 않습니다.' };
    if (raw.version > DATA_VERSION) return { ok: false, error: '이 앱보다 새로운 버전(' + raw.version + ')의 파일입니다.' };
    if (!Array.isArray(raw.categories) || !Array.isArray(raw.items)) return { ok: false, error: '분류 또는 준비물 목록이 없습니다.' };

    var seen = {};
    var categories = [];
    var migrated = false;
    for (var i = 0; i < raw.categories.length; i++) {
      var c = raw.categories[i];
      if (!c || typeof c !== 'object') return { ok: false, error: (i + 1) + '번째 분류가 올바르지 않습니다.' };
      var cid = typeof c.id === 'string' ? c.id.trim() : '';
      var cname = typeof c.name === 'string' ? c.name.trim() : '';
      if (!cid) return { ok: false, error: (i + 1) + '번째 분류에 ID가 없습니다.' };
      if (!cname) return { ok: false, error: (i + 1) + '번째 분류 이름이 비어 있습니다.' };
      if (seen[cid]) return { ok: false, error: '분류 ID가 중복되었습니다: ' + cid };
      seen[cid] = true;
      // icon is optional; data saved before icons existed gets the template icon for default names
      var icon = '';
      if (c.icon === undefined) { icon = defaultIconFor(cname); if (icon) migrated = true; }
      else if (typeof c.icon === 'string') {
        icon = cleanIcon(c.icon);
        if (ICON_TONE_UPGRADES[icon]) { icon = ICON_TONE_UPGRADES[icon]; migrated = true; }
      }
      var group = GROUPS.indexOf(c.group) !== -1 ? c.group : defaultGroupFor(cname);
      if (c.group === undefined) migrated = true;
      categories.push({ id: cid, name: cname.slice(0, 40), icon: icon, doneTabs: c.doneTabs === true, subs: normalizeSubs(c.subs), group: group });
    }

    var items = [];
    var seenItem = {};
    for (var j = 0; j < raw.items.length; j++) {
      var it = raw.items[j];
      if (!it || typeof it !== 'object') return { ok: false, error: (j + 1) + '번째 준비물이 올바르지 않습니다.' };
      var iid = typeof it.id === 'string' ? it.id.trim() : '';
      var iname = typeof it.name === 'string' ? it.name.trim() : '';
      if (!iid) return { ok: false, error: (j + 1) + '번째 준비물에 ID가 없습니다.' };
      if (!iname) return { ok: false, error: (j + 1) + '번째 준비물 이름이 비어 있습니다.' };
      if (seenItem[iid]) return { ok: false, error: '준비물 ID가 중복되었습니다: ' + iid };
      if (typeof it.categoryId !== 'string' || !seen[it.categoryId]) return { ok: false, error: '"' + iname + '" 항목이 존재하지 않는 분류를 가리킵니다.' };
      seenItem[iid] = true;
      var price = null;
      if (it.price !== null && it.price !== undefined && it.price !== '') {
        var pp = parsePrice(it.price);
        if (!pp.ok) return { ok: false, error: '"' + iname + '" 항목의 금액이 올바르지 않습니다.' };
        price = pp.value;
      }
      // (구버전 백업의 qty/unit는 무시한다: 수량 칸이 금액 칸으로 바뀜)
      items.push({
        id: iid,
        categoryId: it.categoryId,
        name: iname.slice(0, 60),
        price: price,
        tags: normalizeTags(it.tags),
        sub: typeof it.sub === 'string' ? it.sub.trim().slice(0, 60) : '',
        memo: typeof it.memo === 'string' ? it.memo.trim().slice(0, 200) : '',
        done: it.done === true,
        excluded: it.excluded === true
      });
    }
    // 준비물의 상세 분류는 자기 분류에 실제로 있는 것만 유지
    var subIndex = {};
    categories.forEach(function (c) { subIndex[c.id] = {}; c.subs.forEach(function (sb) { subIndex[c.id][sb.id] = true; }); });
    items.forEach(function (it) { if (it.sub && !(subIndex[it.categoryId] || {})[it.sub]) it.sub = ''; });
    // notes are optional (added after v1 launch); missing or malformed list => empty
    var notes = [];
    if (raw.notes !== undefined) {
      if (!Array.isArray(raw.notes)) return { ok: false, error: '진료 메모 목록이 올바르지 않습니다.' };
      var seenNote = {};
      for (var k = 0; k < raw.notes.length; k++) {
        var nt = raw.notes[k];
        if (!nt || typeof nt !== 'object') return { ok: false, error: (k + 1) + '번째 진료 메모가 올바르지 않습니다.' };
        var nid = typeof nt.id === 'string' ? nt.id.trim() : '';
        if (!nid) return { ok: false, error: (k + 1) + '번째 진료 메모에 ID가 없습니다.' };
        if (seenNote[nid]) return { ok: false, error: '진료 메모 ID가 중복되었습니다: ' + nid };
        seenNote[nid] = true;
        var ndate = typeof nt.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(nt.date) ? nt.date : '';
        var ntitle = typeof nt.title === 'string' ? nt.title.trim().slice(0, 60) : '';
        var nbody = typeof nt.body === 'string' ? nt.body.replace(/\r\n?/g, '\n').trim().slice(0, NOTE_MAX) : '';
        if (!ntitle && !nbody) return { ok: false, error: (k + 1) + '번째 진료 메모가 비어 있습니다.' };
        notes.push({ id: nid, date: ndate, title: ntitle, body: nbody, fav: nt.fav === true, likes: normalizeLikes(nt.likes), comments: normalizeComments(nt.comments) });
      }
    }
    var highlights = typeof raw.highlights === 'string' ? cleanHighlights(raw.highlights) : '';
    var picks = normalizePicks(raw.picks);

    // 택일 후보 (structured)
    var dates = [];
    var seenDate = {};
    if (raw.dates !== undefined) {
      if (!Array.isArray(raw.dates)) return { ok: false, error: '택일 후보 목록이 올바르지 않습니다.' };
      for (var di = 0; di < raw.dates.length; di++) {
        var dc = raw.dates[di];
        if (!dc || typeof dc !== 'object') return { ok: false, error: (di + 1) + '번째 택일 후보가 올바르지 않습니다.' };
        var did = typeof dc.id === 'string' ? dc.id.trim() : '';
        if (!did) return { ok: false, error: (di + 1) + '번째 택일 후보에 ID가 없습니다.' };
        if (seenDate[did]) return { ok: false, error: '택일 후보 ID가 중복되었습니다: ' + did };
        var ddate = typeof dc.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dc.date) ? dc.date : '';
        var dtime = typeof dc.time === 'string' ? dc.time.trim().slice(0, DATE_TIME_MAX) : '';
        var dlabel = typeof dc.label === 'string' ? dc.label.trim().slice(0, DATE_LABEL_MAX) : '';
        var dmemo = typeof dc.memo === 'string' ? dc.memo.replace(/\r\n?/g, '\n').trim().slice(0, DATE_MEMO_MAX) : '';
        if (!ddate && !dlabel && !dmemo && !dtime) return { ok: false, error: (di + 1) + '번째 택일 후보가 비어 있습니다.' };
        seenDate[did] = true;
        dates.push({ id: did, date: ddate, time: dtime, label: dlabel, memo: dmemo, fav: dc.fav === true, likes: normalizeLikes(dc.likes), comments: normalizeComments(dc.comments) });
      }
    }

    // 이름 후보 (한자 풀이 + 택일 연결)
    var names = [];
    var seenName = {};
    if (raw.names !== undefined) {
      if (!Array.isArray(raw.names)) return { ok: false, error: '이름 후보 목록이 올바르지 않습니다.' };
      for (var ni = 0; ni < raw.names.length; ni++) {
        var nc = raw.names[ni];
        if (!nc || typeof nc !== 'object') return { ok: false, error: (ni + 1) + '번째 이름 후보가 올바르지 않습니다.' };
        var nid2 = typeof nc.id === 'string' ? nc.id.trim() : '';
        var nname = typeof nc.name === 'string' ? nc.name.trim().slice(0, NAME_MAX) : '';
        if (!nid2) return { ok: false, error: (ni + 1) + '번째 이름 후보에 ID가 없습니다.' };
        if (!nname) return { ok: false, error: (ni + 1) + '번째 이름 후보의 이름이 비어 있습니다.' };
        if (seenName[nid2]) return { ok: false, error: '이름 후보 ID가 중복되었습니다: ' + nid2 };
        seenName[nid2] = true;
        var hanja = [];
        asArray(nc.hanja).forEach(function (h) {
          if (!h || typeof h !== 'object') return;
          var chars = typeof h.chars === 'string' ? h.chars.trim().slice(0, HANJA_CHARS_MAX) : '';
          var meaning = typeof h.meaning === 'string' ? h.meaning.trim().slice(0, HANJA_MEANING_MAX) : '';
          if (!chars && !meaning) return;
          hanja.push({ id: (typeof h.id === 'string' && h.id) ? h.id : uid(), chars: chars, meaning: meaning });
        });
        var dateIds = asArray(nc.dateIds).filter(function (x) { return typeof x === 'string' && seenDate[x]; });
        names.push({
          id: nid2, name: nname, favorite: nc.favorite === true,
          memo: typeof nc.memo === 'string' ? nc.memo.replace(/\r\n?/g, '\n').trim().slice(0, NAME_MEMO_MAX) : '',
          hanja: hanja, dateIds: dateIds, likes: normalizeLikes(nc.likes), comments: normalizeComments(nc.comments)
        });
      }
    }

    var dueDate = typeof raw.dueDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.dueDate) ? raw.dueDate : '';
    var anniversary = typeof raw.anniversary === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.anniversary) ? raw.anniversary : '';
    var ledger = normalizeLedger(raw.ledger);
    var budget = typeof raw.budget === 'number' && isFinite(raw.budget) && raw.budget > 0 ? Math.min(Math.round(raw.budget), PRICE_MAX) : 0;
    var memo = typeof raw.memo === 'string' ? raw.memo.replace(/\r\n?/g, '\n').slice(0, MEMO_MAX) : '';
    var memos = [];
    var seenMemo = {};
    if (raw.memos !== undefined) {
      if (!Array.isArray(raw.memos)) return { ok: false, error: '메모 목록이 올바르지 않습니다.' };
      for (var mi = 0; mi < raw.memos.length; mi++) {
        var mm = raw.memos[mi];
        if (!mm || typeof mm !== 'object') return { ok: false, error: (mi + 1) + '번째 메모가 올바르지 않습니다.' };
        var mid = typeof mm.id === 'string' ? mm.id.trim() : '';
        var mtext = typeof mm.text === 'string' ? mm.text.replace(/\r\n?/g, '\n').slice(0, MEMO_MAX) : '';
        var mtables = normalizeTables(mm.tables);
        if (!mid || (!mtext.trim() && !mtables.length) || seenMemo[mid]) continue; // empty or duplicate memos are dropped
        seenMemo[mid] = true;
        memos.push({ id: mid, text: mtext, updated: typeof mm.updated === 'number' ? mm.updated : 0, who: typeof mm.who === 'string' ? mm.who.trim().slice(0, 12) : '', fav: mm.fav === true, likes: normalizeLikes(mm.likes), comments: normalizeComments(mm.comments), tables: mtables });
      }
    }
    if (memo.trim() && !seenMemo['legacy-memo']) { memos.push({ id: 'legacy-memo', text: memo, updated: 0, who: '', fav: false, likes: [], comments: [], tables: [] }); }
    memo = '';

    // 정부 지원 체크리스트
    var supports = [];
    var seenSup = {};
    if (raw.supports !== undefined) {
      if (!Array.isArray(raw.supports)) return { ok: false, error: '정부 지원 목록이 올바르지 않습니다.' };
      for (var si = 0; si < raw.supports.length; si++) {
        var sp = raw.supports[si];
        if (!sp || typeof sp !== 'object') return { ok: false, error: (si + 1) + '번째 지원 항목이 올바르지 않습니다.' };
        var spid = typeof sp.id === 'string' ? sp.id.trim() : '';
        var sptitle = typeof sp.title === 'string' ? sp.title.trim().slice(0, 60) : '';
        if (!spid) return { ok: false, error: (si + 1) + '번째 지원 항목에 ID가 없습니다.' };
        if (!sptitle) return { ok: false, error: (si + 1) + '번째 지원 항목의 제목이 비어 있습니다.' };
        if (seenSup[spid]) return { ok: false, error: '지원 항목 ID가 중복되었습니다: ' + spid };
        seenSup[spid] = true;
        var str = function (v, n) { return typeof v === 'string' ? v.replace(/\r\n?/g, '\n').trim().slice(0, n) : ''; };
        var spstatus = SUPPORT_STATUS.indexOf(sp.status) !== -1 ? sp.status : 'todo';
        supports.push({ id: spid, title: sptitle, target: str(sp.target, 300), benefit: str(sp.benefit, 500), howto: str(sp.howto, 500),
          deadline: (typeof sp.deadline === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(sp.deadline)) ? sp.deadline : '',
          link: str(sp.link, 300), status: spstatus, memo: str(sp.memo, 500) });
      }
    }
    return { ok: true, migrated: migrated, data: { version: DATA_VERSION, categories: categories, items: items, notes: notes, highlights: highlights, picks: picks, dates: dates, names: names, dueDate: dueDate, anniversary: anniversary, memo: memo, memos: memos, supports: supports, ledger: ledger, budget: budget } };
  }

  /* ---------- storage ---------- */
  var storageOk = true;
  var warningKind = null; // 'save' | 'load'

  function loadState() {
    var raw = null;
    try {
      raw = window.localStorage.getItem(STORAGE_KEY);
    } catch (e) {
      storageOk = false;
      showStorageWarning('브라우저 저장소에 접근할 수 없습니다. 변경 사항이 저장되지 않으니 JSON 내보내기로 백업하세요.', 'save');
      return { state: createDefaultState(), fresh: true };
    }
    if (raw === null) return { state: createDefaultState(), fresh: true };
    var parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      backupCorrupt(raw);
      showStorageWarning('저장된 기록을 읽을 수 없어 기본 목록으로 시작합니다. 손상된 기록은 브라우저 저장소에 별도 보관했습니다.', 'load');
      return { state: createDefaultState(), fresh: true };
    }
    var result = normalizeState(parsed);
    if (!result.ok) {
      backupCorrupt(raw);
      showStorageWarning('저장된 기록이 손상되어 기본 목록으로 시작합니다. (' + result.error + ')', 'load');
      return { state: createDefaultState(), fresh: true };
    }
    if (result.migrated) {
      // persist filled-in defaults quietly; a failure here is reported on the next normal save
      try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(result.data)); } catch (e) { /* ignore */ }
    }
    return { state: result.data, fresh: false };
  }

  function backupCorrupt(raw) {
    try { window.localStorage.setItem(STORAGE_KEY + ':corrupt-' + Date.now(), raw); } catch (e) { /* ignore */ }
  }

  var changeListeners = [];
  var applyingRemote = false;
  var touched = false; // true once the user changed anything on this device

  function saveState(opts) {
    opts = opts || {};
    var statusEl = $('#save-status');
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      storageOk = true;
      statusEl.textContent = (opts.remote ? '동기화됨 ' : '자동 저장됨 ') + timeStamp();
      statusEl.classList.remove('is-error');
      hideStorageWarning();
      if (!opts.silent && !applyingRemote) {
        if (!opts.initial) touched = true;
        changeListeners.forEach(function (cb) { try { cb(state); } catch (e) { /* listener errors must not break saving */ } });
      }
      return true;
    } catch (e) {
      storageOk = false;
      statusEl.textContent = '저장 실패';
      statusEl.classList.add('is-error');
      showStorageWarning('변경 사항을 저장하지 못했습니다. 저장 공간이 부족하거나 브라우저가 저장을 막고 있을 수 있습니다. JSON 내보내기로 백업하세요.', 'save');
      return false;
    }
  }

  function showStorageWarning(msg, kind) {
    var el = $('#storage-warning');
    warningKind = kind;
    el.textContent = msg;
    el.hidden = false;
  }
  function hideStorageWarning() {
    var el = $('#storage-warning');
    if (!el.hidden && warningKind === 'save') { el.hidden = true; el.textContent = ''; warningKind = null; }
  }

  /* ---------- state ---------- */
  var state;
  var ui = { filter: 'all', editMode: false, pendingUndo: null, undoTimer: null, collapsed: {}, noteForm: null, qtyEdit: null, highlightEdit: false, activeCategory: null, highlightsCollapsed: false, itemEdit: null, view: 'checklist', picksEdit: null, picksActive: 'gpt', dateEdit: null, nameEdit: null, search: '', searchOpen: false, stripOpen: false, onboardingDismissed: false, deviceName: '', autoName: '', toastRemote: true, activity: [], supportEdit: null, memoFocus: null, templateCleared: false, bulkOpen: null, doneTab: {}, tagFilter: {}, tagsMigrated: false, subTab: {}, subsMigrated: false, showSubLabel: false, recordTab: 'notes', planTab: 'picks', addSub: {}, addSubPick: {}, memoOpen: null, memoEdit: false, memoDraft: '', commentDraft: '', tableSel: null, noteComments: {}, noteCommentDraft: {}, noteOpen: null, detailFrom: null, archiveTab: 'fav', rxOpen: {}, rxDraft: {}, ledgerMonth: '', ledgerForm: null, ledgerType: 'out', budgetEdit: false, settingsFrom: 'mamibag', portalSeeded: false };

  // Active tab (narrow screens): falls back to the first category when the saved one is gone.
  function activeCategoryId() {
    if (!state.categories.length) return null;
    for (var i = 0; i < state.categories.length; i++) if (state.categories[i].id === ui.activeCategory) return ui.activeCategory;
    return state.categories[0].id;
  }

  function setActiveCategory(id) {
    ui.activeCategory = id;
    ui.qtyEdit = null;
    ui.itemEdit = null;
    saveUiPrefs();
    render();
  }

  function toggleHighlightsCollapsed() {
    ui.highlightsCollapsed = !ui.highlightsCollapsed;
    saveUiPrefs();
    renderHighlights();
  }

  var uiPrefsFound = false;
  function loadUiPrefs() {
    try {
      var raw = window.localStorage.getItem(UI_KEY);
      if (!raw) return;
      uiPrefsFound = true;
      var parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        if (parsed.collapsed && typeof parsed.collapsed === 'object') ui.collapsed = parsed.collapsed;
        if (typeof parsed.activeCategory === 'string') ui.activeCategory = parsed.activeCategory;
        ui.highlightsCollapsed = parsed.highlightsCollapsed === true;
        if (VIEWS.indexOf(parsed.view) !== -1) ui.view = parsed.view;
        ui.portalSeeded = parsed.portalSeeded === true;
        ui.onboardingDismissed = parsed.onboardingDismissed === true;
        if (typeof parsed.deviceName === 'string') ui.deviceName = parsed.deviceName.slice(0, 12);
        if (typeof parsed.autoName === 'string') ui.autoName = parsed.autoName.slice(0, 12);
        ui.templateCleared = parsed.templateCleared === true;
        ui.tagsMigrated = parsed.tagsMigrated === true;
        ui.subsMigrated = parsed.subsMigrated === true;
        if (parsed.addSub && typeof parsed.addSub === 'object') ui.addSub = parsed.addSub;
        if (parsed.archiveTab === 'fav' || parsed.archiveTab === 'like') ui.archiveTab = parsed.archiveTab;
        if (parsed.recordTab === 'notes' || parsed.recordTab === 'memos') ui.recordTab = parsed.recordTab;
        if (parsed.planTab === 'picks' || parsed.planTab === 'names') ui.planTab = parsed.planTab;
        if (parsed.subTab && typeof parsed.subTab === 'object') ui.subTab = parsed.subTab;
        if (parsed.doneTab && typeof parsed.doneTab === 'object') ui.doneTab = parsed.doneTab;
        if (parsed.tagFilter && typeof parsed.tagFilter === 'object') ui.tagFilter = parsed.tagFilter;
        if (parsed.toastRemote === false) ui.toastRemote = false;
        if (parsed.picksActive === 'gpt' || parsed.picksActive === 'claude') ui.picksActive = parsed.picksActive;
      }
    } catch (e) { /* UI preferences are optional */ }
  }

  function saveUiPrefs() {
    try {
      var keep = {};
      state.categories.forEach(function (c) { if (ui.collapsed[c.id]) keep[c.id] = true; });
      ui.collapsed = keep;
      window.localStorage.setItem(UI_KEY, JSON.stringify({
        collapsed: ui.collapsed,
        activeCategory: ui.activeCategory,
        picksActive: ui.picksActive,
        view: ui.view,
        onboardingDismissed: ui.onboardingDismissed,
        deviceName: ui.deviceName,
        autoName: ui.autoName,
        templateCleared: ui.templateCleared,
        tagsMigrated: ui.tagsMigrated,
        subsMigrated: ui.subsMigrated,
        recordTab: ui.recordTab,
        archiveTab: ui.archiveTab,
        addSub: ui.addSub,
        planTab: ui.planTab,
        subTab: ui.subTab,
        doneTab: ui.doneTab,
        tagFilter: ui.tagFilter,
        toastRemote: ui.toastRemote,
        portalSeeded: ui.portalSeeded,
        highlightsCollapsed: ui.highlightsCollapsed
      }));
    } catch (e) { /* ignore */ }
  }

  function toggleCollapsed(categoryId) {
    if (ui.collapsed[categoryId]) delete ui.collapsed[categoryId];
    else ui.collapsed[categoryId] = true;
    saveUiPrefs();
    render();
  }

  function itemsOf(categoryId) {
    return state.items.filter(function (it) { return it.categoryId === categoryId; });
  }

  function findItem(id) {
    for (var i = 0; i < state.items.length; i++) if (state.items[i].id === id) return state.items[i];
    return null;
  }

  function findCategory(id) {
    for (var i = 0; i < state.categories.length; i++) if (state.categories[i].id === id) return state.categories[i];
    return null;
  }

  function computeProgress(items) {
    var total = 0, done = 0, excluded = 0, sum = 0, priced = 0;
    items.forEach(function (it) {
      if (it.excluded) { excluded++; return; }
      total++;
      if (it.done) done++;
      if (typeof it.price === 'number') { sum += it.price; priced++; }
    });
    var percent = 0;
    var result_sum = sum;
    if (total > 0) {
      percent = done === total ? 100 : Math.min(99, Math.floor((done / total) * 100));
    }
    return { total: total, done: done, excluded: excluded, percent: percent, sum: result_sum, priced: priced };
  }

  // 화면용: '합계 12,000원' 부분만 굵게
  function progressHtml(p) {
    var base = escapeHtml(progressText(p, true));
    if (p.total > 0 && p.sum > 0) base += ' · <b class="sum">합계 ' + escapeHtml(formatWon(p.sum)) + '</b>';
    return base;
  }
  function progressText(p, noSum) {
    if (p.total === 0) {
      return p.excluded > 0 ? '준비 항목 없음 · 제외 ' + p.excluded + '개' : '준비 항목 없음';
    }
    var t = p.done + '/' + p.total + '개 완료 · ' + p.percent + '%';
    if (p.excluded > 0) t += ' · 제외 ' + p.excluded + '개';
    if (p.sum > 0 && !noSum) t += ' · 합계 ' + formatWon(p.sum);
    return t;
  }

  // 금액 정렬: 금액 없는 항목은 항상 맨 아래, 같은 금액은 원래 순서 유지
  function sortItems(list, mode) {
    if (mode !== 'price-desc' && mode !== 'price-asc') return list;
    var dir = mode === 'price-desc' ? -1 : 1;
    return list.map(function (it, i) { return { it: it, i: i }; }).sort(function (a, b) {
      var pa = a.it.price, pb = b.it.price;
      if (pa === null && pb === null) return a.i - b.i;
      if (pa === null) return 1;
      if (pb === null) return -1;
      if (pa !== pb) return (pa - pb) * dir;
      return a.i - b.i;
    }).map(function (x) { return x.it; });
  }

  function doneTabOf(catId) { var v = ui.doneTab[catId]; return v === 'todo' || v === 'done' ? v : 'all'; }
  function tagFilterOf(catId) { return typeof ui.tagFilter[catId] === 'string' ? ui.tagFilter[catId] : ''; }
  function matchesCategoryView(cat, it) {
    if (ui.editMode) return true;
    if (cat.doneTabs) {
      var dt = doneTabOf(cat.id);
      if (dt === 'todo' && (it.done || it.excluded)) return false;
      if (dt === 'done' && (!it.done || it.excluded)) return false;
    }
    var tf = tagFilterOf(cat.id);
    if (tf && (!it.tags || it.tags.indexOf(tf) === -1)) return false;
    return true;
  }
  function tagCounts(items) {
    var counts = {}; var order = [];
    items.forEach(function (it) { (it.tags || []).forEach(function (t) { if (!counts[t]) { counts[t] = 0; order.push(t); } counts[t]++; }); });
    order.sort(function (a, b) { var ia = TAG_NAMES.indexOf(a), ib = TAG_NAMES.indexOf(b); if (ia === -1) ia = 99; if (ib === -1) ib = 99; return ia - ib || a.localeCompare(b); });
    return { counts: counts, order: order };
  }

  function matchesFilter(it) {
    switch (ui.filter) {
      case 'todo': return !it.excluded && !it.done;
      case 'done': return !it.excluded && it.done;
      case 'excluded': return it.excluded;
      default: return true;
    }
  }

  function emptyMessage(catItems) {
    if (catItems.length === 0) return '아직 준비물이 없습니다. 위 칸에 이름을 적고 추가를 누르세요. 한 번에 여러 개를 넣으려면 ‘여러 개’를 누르세요.';
    if (!ui.editMode) { var c0 = findCategory(catItems[0].categoryId); if (c0 && (tagFilterOf(c0.id) || (c0.doneTabs && doneTabOf(c0.id) !== 'all'))) return '이 조건에 맞는 준비물이 없습니다. 위의 탭이나 이름 칩을 ‘전체’로 바꿔 보세요.'; }
    switch (ui.filter) {
      case 'todo': return '미완료 항목이 없습니다. 이 분류는 준비를 마쳤어요.';
      case 'done': return '아직 완료한 항목이 없습니다.';
      case 'excluded': return '제외한 항목이 없습니다.';
      default: return '표시할 항목이 없습니다.';
    }
  }

  /* ---------- rendering ---------- */
  function focusKeyOf(el) {
    while (el && el !== document.body) {
      if (el.dataset && el.dataset.focusKey) return el.dataset.focusKey;
      el = el.parentElement;
    }
    return null;
  }

  // 지금 화면이 속한 공간: portal · ledger · mamibag (포털에서 연 설정은 'settings')
  function spaceOf(view) {
    if (view === 'portal' || view === 'ledger') return view;
    if (view === 'settings' && ui.settingsFrom !== 'mamibag') return 'settings';
    return 'mamibag';
  }
  function setView(view, from, fromHistory) {
    if (VIEWS.indexOf(view) === -1) return;
    if (!fromHistory && view !== ui.view) { try { window.history.pushState({ view: view }, ''); } catch (e) { /* ignore */ } }
    if (view === 'settings') ui.settingsFrom = from || (spaceOf(ui.view) === 'mamibag' ? 'mamibag' : spaceOf(ui.view));
    if (ui.view === view) { render(); return; }
    if (view !== 'ledger') ui.ledgerForm = null;
    if (ui.view === 'memos' && ui.memoOpen) closeMemo();
    if (ui.view === 'notes' && ui.noteOpen && view !== 'notes') closeNote();
    if (view !== 'notes' && view !== 'memos') ui.detailFrom = null;
    ui.view = view;
    if (view === 'notes' || view === 'memos') ui.recordTab = view;
    if (view === 'picks' || view === 'names') ui.planTab = view;
    ui.qtyEdit = null;
    ui.itemEdit = null;
    ui.dateEdit = null;
    ui.nameEdit = null;
    ui.supportEdit = null;
    saveUiPrefs();
    try { window.sessionStorage.setItem(SESSION_VIEW_KEY, view); } catch (e) { /* ignore */ }
    render();
    window.scrollTo(0, 0);
  }
  var SESSION_VIEW_KEY = 'luckybbu:view';

  function renderPrimaryTabs() {
    var p = computeProgress(state.items);
    document.body.classList.toggle('is-checklist-view', ui.view === 'checklist');
    var cCount = $('#ptab-checklist-count');
    if (cCount) cCount.textContent = p.total ? p.done + '/' + p.total : '';
    var nCount = $('#ptab-notes-count');
    if (nCount) nCount.textContent = state.notes.length ? String(state.notes.length) : '';
    var pkFilled = PICK_KEYS.filter(function (k) { return state.picks && state.picks[k]; }).length;
    var pkCount = $('#ptab-picks-count');
    if (pkCount) pkCount.textContent = pkFilled ? String(pkFilled) : '';
    var nmCount = $('#ptab-names-count');
    if (nmCount) nmCount.textContent = state.names.length ? String(state.names.length) : '';
    var group = (ui.view === 'notes' || ui.view === 'memos') ? 'record' : (ui.view === 'picks' || ui.view === 'names') ? 'plan' : '';
    var counts = { notes: state.notes.length, memos: state.memos.length, picks: state.dates.length + pkFilled, names: state.names.length };
    Array.prototype.forEach.call(document.querySelectorAll('.view-switch__btn'), function (b) {
      var on = b.dataset.target === ui.view;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
      var c = b.querySelector('[data-count]'); if (c) c.textContent = counts[c.dataset.count] ? String(counts[c.dataset.count]) : '';
    });
    var mc = $('#memos-count'); if (mc) mc.textContent = counts.memos ? counts.memos + '개' : '';
    Array.prototype.forEach.call(document.querySelectorAll('.primary-tab'), function (btn) {
      var active = btn.dataset.group ? btn.dataset.group === group : btn.dataset.view === ui.view;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
      btn.tabIndex = active ? 0 : -1;
    });
    var space = spaceOf(ui.view);
    document.body.dataset.space = space;
    var vpo = $('#view-portal'); if (vpo) vpo.hidden = ui.view !== 'portal';
    var vle = $('#view-ledger'); if (vle) vle.hidden = ui.view !== 'ledger';
    var ptabsNav = $('#primary-tabs'); if (ptabsNav) ptabsNav.hidden = space !== 'mamibag';
    var back = $('#space-back'); if (back) back.hidden = space === 'portal';
    var titleText = $('#app-title-text');
    if (titleText) titleText.textContent = space === 'ledger' ? '가계부' : space === 'settings' ? '설정' : '마미백';
    var titleBtn = $('#app-title-btn');
    if (titleBtn) { titleBtn.dataset.action = space === 'mamibag' ? 'go-home' : (space === 'ledger' ? 'go-ledger' : 'go-portal'); titleBtn.setAttribute('aria-label', space === 'mamibag' ? '마미백 홈으로' : titleText ? titleText.textContent : ''); }
    var vh = $('#view-home');
    if (vh) vh.hidden = ui.view !== 'home';
    var vs = $('#view-settings'); if (vs) vs.hidden = ui.view !== 'settings';
    var vsp = $('#view-supports'); if (vsp) vsp.hidden = ui.view !== 'supports';
    var vmm = $('#view-memos'); if (vmm) vmm.hidden = ui.view !== 'memos';
    var vc = $('#view-checklist'), vn = $('#view-notes'), vp = $('#view-picks'), vm = $('#view-names');
    if (vc) vc.hidden = ui.view !== 'checklist';
    if (vn) vn.hidden = ui.view !== 'notes';
    if (vp) vp.hidden = ui.view !== 'picks';
    if (vm) vm.hidden = ui.view !== 'names';
  }

  function updateTabScroll(bar) {
    if (!bar) return;
    var scrollable = bar.scrollWidth > bar.clientWidth + 2;
    bar.classList.toggle('is-scrollable', scrollable);
    if (!scrollable) return;
    var active = bar.querySelector('.is-active');
    if (!active) return;
    var al = active.offsetLeft, ar = al + active.offsetWidth;
    if (al < bar.scrollLeft) bar.scrollLeft = Math.max(0, al - 8);
    else if (ar > bar.scrollLeft + bar.clientWidth) bar.scrollLeft = ar - bar.clientWidth + 8;
  }

  // 상세 분류 탭 줄: 다시 그린 뒤 선택된 탭이 보이도록 가로 위치를 맞춘다
  var renderCategoriesBase = renderCategories;
  renderCategories = function () {
    renderCategoriesBase.apply(this, arguments);
    Array.prototype.forEach.call(document.querySelectorAll('.sub-tabs'), function (bar) {
      var on = bar.querySelector('.is-active'); if (!on) return;
      var l = on.offsetLeft - bar.offsetLeft, r = l + on.offsetWidth;
      if (l < bar.scrollLeft) bar.scrollLeft = Math.max(0, l - 16);
      else if (r > bar.scrollLeft + bar.clientWidth) bar.scrollLeft = r - bar.clientWidth + 16;
    });
  };

  function render() {
    var activeKey = focusKeyOf(document.activeElement);
    renderPrimaryTabs();
    renderOverall();
    renderTabs();
    renderCategories();
    renderNotes();
    renderPicks();
    renderDates();
    renderNames();
    renderHighlights();
    updateTabScroll($('#primary-tabs'));
    updateTabScroll($('#category-tabs'));
    updateTabScroll($('#pick-tabs'));
    renderHome();
    renderPortal();
    renderLedger();
    renderHighlightsStrip();
    renderDday();
    renderMemo();
    renderSettings();
    renderSupports();
    var searchBox = $('#search-wrap');
    if (searchBox) searchBox.hidden = !ui.searchOpen || ui.editMode || ui.view !== 'checklist';
    var st = $('#search-toggle');
    if (st) { st.setAttribute('aria-pressed', ui.searchOpen ? 'true' : 'false'); st.classList.toggle('is-active', ui.searchOpen || !!ui.search); }
    var fs = $('#filter-select');
    if (fs && fs.value !== ui.filter) fs.value = ui.filter;
    Array.prototype.forEach.call(document.querySelectorAll('[data-edit-toggle]'), function (b) {
      b.setAttribute('aria-pressed', ui.editMode ? 'true' : 'false');
      b.textContent = ui.editMode ? '편집 완료' : (b.dataset.editToggle === 'short' ? '편집' : '편집 모드');
    });
    if (activeKey) {
      var target = document.querySelector('[data-focus-key="' + activeKey + '"]');
      if (target) target.focus({ preventScroll: true });
    }
  }

  function renderOverall() {
    var p = computeProgress(state.items);
    $('#overall-progress-text').innerHTML = progressHtml(p);
    $('#overall-progress-fill').style.width = p.percent + '%';
    $('#overall-progress-bar').setAttribute('aria-valuenow', String(p.percent));
    $('#overall-progress-bar').setAttribute('aria-valuetext', progressText(p));
  }

  function refreshProgress() {
    renderOverall();
    renderTabs();
    state.categories.forEach(function (cat) {
      var card = document.querySelector('.category[data-category-id="' + cat.id + '"]');
      if (!card) return;
      var p = computeProgress(itemsOf(cat.id));
      $('.progress-text', card).textContent = progressText(p, true);
      $('.progress-bar__fill', card).style.width = p.percent + '%';
      $('.progress-bar', card).setAttribute('aria-valuenow', String(p.percent));
      $('.progress-bar', card).setAttribute('aria-valuetext', progressText(p, true));
      var tl = $('.cat-total__label', card), ts = $('.cat-total__sum', card);
      if (tl) tl.textContent = '총 합계 · 금액 입력 ' + p.priced + '/' + p.total + '개' + (p.excluded ? ' (제외 ' + p.excluded + '개 미포함)' : '');
      if (ts) ts.textContent = formatWon(p.sum);
    });
  }

  function searching() { return !ui.editMode && ui.view === 'checklist' && ui.search.trim() !== ''; }

  function renderSearchResults(root, q) {
    var needle = q.trim().toLowerCase();
    var matches = [];
    state.categories.forEach(function (cat) {
      itemsOf(cat.id).forEach(function (it) {
        if ((it.name.toLowerCase().indexOf(needle) !== -1 || (it.tags || []).some(function (t) { return t.toLowerCase().indexOf(needle) !== -1; })) && matchesFilter(it)) matches.push({ it: it, cat: cat });
      });
    });
    var html = '<div class="search-results">';
    html += '<p class="search-results__count">‘' + escapeHtml(q.trim()) + '’ 검색 결과 ' + matches.length + '개</p>';
    if (!matches.length) {
      html += '<p class="items-empty">일치하는 준비물이 없습니다.</p>';
    } else {
      html += '<ul class="items">' + matches.map(function (m) {
        var it = m.it;
        var cls = 'item search-item' + (it.done ? ' is-done' : '') + (it.excluded ? ' is-excluded' : '');
        var meta = [];
        if (it.price !== null) meta.push('금액 ' + formatWon(it.price));
        var h = '<li class="' + cls + '" data-item-id="' + escapeHtml(it.id) + '"><div class="item__row"><label class="item__check">';
        h += '<input type="checkbox" data-action="toggle-done"' + (it.done ? ' checked' : '') + (it.excluded ? ' disabled' : '') + ' aria-label="' + escapeHtml(it.name) + ' 가방에 담기 완료">';
        h += '<span class="item__body"><span class="item__name">' + tagsHtml(it) + escapeHtml(it.name) + '</span>';
        h += '<span class="badge badge--cat">' + (m.cat.icon ? escapeHtml(m.cat.icon) + ' ' : '') + escapeHtml(m.cat.name) + '</span>';
        if (it.excluded) h += '<span class="badge badge--excluded">제외</span>';
        else if (it.done) h += '<span class="badge badge--done">완료</span>';
        if (meta.length) h += '<span class="item__meta">' + escapeHtml(meta.join(' · ')) + '</span>';
        if (it.memo) h += '<span class="item__memo">' + escapeHtml(it.memo) + '</span>';
        h += '</span></label></div></li>';
        return h;
      }).join('') + '</ul>';
    }
    html += '</div>';
    root.innerHTML = html;
  }

  function renderCategories() {
    var editBar = $('#edit-bar');
    if (editBar) {
      editBar.hidden = !ui.editMode || !state.categories.length;
      var ccb = $('#clear-category-btn'); var ac = state.categories.length ? findCategory(activeCategoryId()) : null;
      if (ccb) { ccb.textContent = '🗑 ' + (ac ? '‘' + ac.name + '’ 비우기' : '이 분류 비우기'); ccb.disabled = !ac || itemsOf(ac.id).length === 0; }
      var cab = $('#clear-items-btn-2'); if (cab) cab.disabled = state.items.length === 0;
    }
    var root = $('#categories');
    var catTabs = $('#category-tabs');
    if (searching()) {
      if (catTabs) catTabs.hidden = true;
      renderSearchResults(root, ui.search);
      return;
    }
    if (catTabs) catTabs.hidden = false;
    if (state.categories.length === 0) {
      root.innerHTML = '<div class="empty-state"><p>분류가 없습니다.</p><p>분류 탭의 <strong>+</strong> 버튼으로 다시 시작할 수 있어요.</p></div>';
      return;
    }
    root.innerHTML = state.categories.map(renderCategory).join('');
  }

  function renderTabs() {
    var bar = $('#category-tabs');
    if (state.categories.length === 0) { bar.innerHTML = ''; bar.hidden = true; return; }
    bar.hidden = false;
    var active = activeCategoryId();
    bar.innerHTML = state.categories.map(function (cat) {
      var p = computeProgress(itemsOf(cat.id));
      var isActive = cat.id === active;
      var count = p.total ? p.done + '/' + p.total : '0';
      return '<button type="button" role="tab" class="category-tab' + (isActive ? ' is-active' : '') + '" data-action="select-tab" data-category-id="' + escapeHtml(cat.id) + '" data-focus-key="tab:' + escapeHtml(cat.id) + '" aria-selected="' + (isActive ? 'true' : 'false') + '" aria-controls="cat-' + escapeHtml(cat.id) + '" tabindex="' + (isActive ? '0' : '-1') + '">' +
        (cat.icon ? '<span class="category-tab__icon" aria-hidden="true">' + escapeHtml(cat.icon) + '</span>' : '') +
        '<span class="category-tab__name">' + escapeHtml(cat.name) + '</span>' +
        '<span class="category-tab__count">' + escapeHtml(count) + '</span></button>';
    }).join('') + '<button type="button" class="category-tab category-tab--add" data-action="add-category-tab" aria-label="분류 추가">+</button>';
  }

  function renderCategory(cat) {
    var catItems = itemsOf(cat.id);
    var p = computeProgress(catItems);
    // 보기 모드는 항상 금액 높은순(미입력은 맨 아래), 편집 모드는 ▲▼로 정한 기본 순서
    var scope = catItems.filter(function (it) { return inSubScope(cat, it); });
    var visible = sortItems(scope.filter(matchesFilter).filter(function (it) { return matchesCategoryView(cat, it); }), ui.editMode ? 'default' : 'price-desc');
    var subs = subsOf(cat);
    var subTab = ui.editMode ? '' : subTabOf(cat);
    var titleId = 'cat-title-' + cat.id;
    var collapsed = !ui.editMode && !!ui.collapsed[cat.id];
    var bodyId = 'cat-body-' + cat.id;
    var isActive = cat.id === activeCategoryId();
    var html = '<section class="category' + (collapsed ? ' is-collapsed' : '') + (isActive ? ' is-active' : '') + '" id="cat-' + escapeHtml(cat.id) + '" data-category-id="' + escapeHtml(cat.id) + '" aria-labelledby="' + titleId + '">';
    html += '<div class="category__head">';
    if (ui.editMode) {
      html += '<label class="visually-hidden" for="cat-icon-' + escapeHtml(cat.id) + '">분류 아이콘</label>';
      html += '<input type="text" class="category__icon-input" id="cat-icon-' + escapeHtml(cat.id) + '" data-action="set-icon" data-focus-key="cat-icon:' + escapeHtml(cat.id) + '" value="' + escapeHtml(cat.icon || '') + '" maxlength="' + ICON_MAX + '" placeholder="아이콘" autocomplete="off">';
      html += '<label class="visually-hidden" for="cat-name-' + escapeHtml(cat.id) + '">분류 이름</label>';
      html += '<input type="text" class="category__title-input" id="cat-name-' + escapeHtml(cat.id) + '" data-action="rename-category" data-focus-key="cat-name:' + escapeHtml(cat.id) + '" value="' + escapeHtml(cat.name) + '" maxlength="40" aria-labelledby="' + titleId + '">';
      html += '<h2 id="' + titleId + '" class="visually-hidden">' + escapeHtml(cat.name) + '</h2>';
      var cidx = state.categories.indexOf(cat);
      html += '<span class="reorder">';
      html += '<button type="button" class="btn btn--small reorder__btn" data-action="cat-up"' + (cidx <= 0 ? ' disabled' : '') + ' aria-label="분류 위로">▲</button>';
      html += '<button type="button" class="btn btn--small reorder__btn" data-action="cat-down"' + (cidx >= state.categories.length - 1 ? ' disabled' : '') + ' aria-label="분류 아래로">▼</button></span>';
      html += '<button type="button" class="btn btn--small btn--danger" data-action="delete-category" data-focus-key="cat-del:' + escapeHtml(cat.id) + '" aria-label="분류 ' + escapeHtml(cat.name) + ' 삭제">삭제</button>';
      html += '</div><div class="icon-presets" role="group" aria-label="' + escapeHtml(cat.name) + ' 아이콘 선택">';
      ICON_PRESETS.forEach(function (ic) {
        html += '<button type="button" class="icon-presets__btn' + (cat.icon === ic ? ' is-active' : '') + '" data-action="pick-icon" data-icon="' + escapeHtml(ic) + '" aria-label="아이콘 ' + escapeHtml(ic) + '" aria-pressed="' + (cat.icon === ic ? 'true' : 'false') + '">' + escapeHtml(ic) + '</button>';
      });
      html += '<button type="button" class="icon-presets__btn icon-presets__btn--none' + (!cat.icon ? ' is-active' : '') + '" data-action="pick-icon" data-icon="" aria-pressed="' + (!cat.icon ? 'true' : 'false') + '">없음</button>';
      html += '<label class="cat-opt"><input type="checkbox" data-action="toggle-done-tabs" data-focus-key="cat-dt:' + escapeHtml(cat.id) + '"' + (cat.doneTabs ? ' checked' : '') + '> 완료/미완료 탭 표시</label>';
      html += '<label class="cat-opt">마미백 홈 묶음 <select data-action="set-group" data-focus-key="cat-group:' + escapeHtml(cat.id) + '"><option value="birth"' + (cat.group === 'birth' ? ' selected' : '') + '>출산</option><option value="baby"' + (cat.group === 'baby' ? ' selected' : '') + '>육아</option></select></label>';
    } else {
      html += '<h2 id="' + titleId + '" class="category__title">';
      html += '<button type="button" class="category__toggle" data-action="toggle-collapse" data-focus-key="cat-toggle:' + escapeHtml(cat.id) + '" aria-expanded="' + (collapsed ? 'false' : 'true') + '" aria-controls="' + bodyId + '">';
      if (cat.icon) html += '<span class="category__icon" aria-hidden="true">' + escapeHtml(cat.icon) + '</span>';
      html += '<span class="category__name">' + escapeHtml(cat.name) + '</span>';
      html += '<span class="category__chevron" aria-hidden="true"></span>';
      html += '<span class="visually-hidden">' + (collapsed ? ' 펼치기' : ' 접기') + '</span>';
      html += '</button></h2>';
    }
    html += '</div>';

    html += '<div class="category__progress"><p class="progress-text">' + escapeHtml(progressText(p, true)) + '</p>';
    html += '<div class="progress-bar" role="progressbar" aria-label="' + escapeHtml(cat.name) + ' 진행률" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + p.percent + '" aria-valuetext="' + escapeHtml(progressText(p, true)) + '"><div class="progress-bar__fill" style="width:' + p.percent + '%"></div></div></div>';
    // 총 합계(목록 위) + 금액 정렬 칩
    if (catItems.length && !collapsed) {
      html += '<div class="cat-total" aria-live="polite"><span class="cat-total__label">총 합계 · 금액 입력 ' + p.priced + '/' + p.total + '개' + (p.excluded ? ' (제외 ' + p.excluded + '개 미포함)' : '') + '</span><strong class="cat-total__sum">' + escapeHtml(formatWon(p.sum)) + '</strong></div>';
    }

    html += '<div class="category__body" id="' + bodyId + '"' + (collapsed ? ' hidden' : '') + '>';
    if (ui.editMode) html += renderSubsManager(cat);
    if (!ui.editMode && catItems.length) {
      // 필터 줄: 상세 분류(밑줄 탭) + 담당(작은 점 칩). 넓은 화면에서는 한 줄, 좁은 화면에서는 두 줄.
      var cidE = escapeHtml(cat.id);
      var filters = '';
      if (subs.length) {
        var nNone = catItems.filter(function (it) { return !hasSub(cat, it); }).length;
        var subBtn = function (key, label, n, on) {
          return '<button type="button" role="tab" class="sub-tab' + (on ? ' is-active' : '') + '" data-action="sub-tab" data-sub="' + escapeHtml(key) + '" data-focus-key="st:' + cidE + ':' + escapeHtml(key) + '" aria-selected="' + (on ? 'true' : 'false') + '">' + escapeHtml(label) + '<b>' + n + '</b></button>';
        };
        filters += '<div class="sub-tabs" role="tablist" aria-label="' + escapeHtml(cat.name) + ' 상세 분류">';
        filters += subBtn('', '전체', catItems.length, !subTab);
        subs.forEach(function (sb) {
          filters += subBtn(sb.id, sb.name, catItems.filter(function (it) { return it.sub === sb.id; }).length, subTab === sb.id);
        });
        if (nNone) filters += subBtn('__none', '미분류', nNone, subTab === '__none');
        filters += '</div>';
      }
      var tc = tagCounts(scope);
      if (tc.order.length) {
        var tf = tagFilterOf(cat.id);
        filters += '<div class="tag-chips" role="group" aria-label="' + escapeHtml(cat.name) + ' 담당별 보기"><span class="tag-chips__label" aria-hidden="true">담당</span>';
        filters += '<button type="button" class="tag-chip tag-chip--all' + (!tf ? ' is-active' : '') + '" data-action="tag-filter" data-tag="" data-focus-key="tf:' + cidE + ':" aria-pressed="' + (!tf ? 'true' : 'false') + '">모두</button>';
        tc.order.forEach(function (t) {
          var on = tf === t;
          filters += '<button type="button" class="tag-chip ' + tagClass(t) + (on ? ' is-active' : '') + '" data-action="tag-filter" data-tag="' + escapeHtml(t) + '" data-focus-key="tf:' + cidE + ':' + escapeHtml(t) + '" aria-pressed="' + (on ? 'true' : 'false') + '">' + escapeHtml(t) + '<b>' + tc.counts[t] + '</b></button>';
        });
        filters += '</div>';
      }
      if (filters) html += '<div class="cat-filters' + (subs.length ? ' cat-filters--tabs' : '') + '">' + filters + '</div>';
      if (cat.doneTabs) {
        var dt = doneTabOf(cat.id);
        var nAll = scope.filter(function (it) { return !it.excluded; }).length;
        var nDone = scope.filter(function (it) { return !it.excluded && it.done; }).length;
        html += '<div class="done-tabs" role="tablist" aria-label="' + escapeHtml(cat.name) + ' 완료 여부">';
        [['all', '전체', nAll], ['todo', '미완료', nAll - nDone], ['done', '완료', nDone]].forEach(function (o) {
          var on = dt === o[0];
          html += '<button type="button" role="tab" class="done-tab' + (on ? ' is-active' : '') + '" data-action="done-tab" data-tab="' + o[0] + '" data-focus-key="dt:' + cidE + ':' + o[0] + '" aria-selected="' + (on ? 'true' : 'false') + '">' + o[1] + '<b>' + o[2] + '</b></button>';
        });
        html += '</div>';
      }
    }
    var bulkOpen = ui.bulkOpen === cat.id;
    // 추가할 상세 분류: 상세 탭을 골랐으면 그 탭, 아니면 이 분류에서 마지막으로 고른 것
    var addSubId = '';
    if (subs.length) {
      if (ui.addSubPick[cat.id] && findSub(cat, ui.addSubPick[cat.id])) addSubId = ui.addSubPick[cat.id];
      else if (subTab && subTab !== '__none') addSubId = subTab;
      else if (!subTab && ui.addSub[cat.id] && findSub(cat, ui.addSub[cat.id])) addSubId = ui.addSub[cat.id];
    }
    html += '<form class="inline-form quick-add quick-add--sub" data-action="add-item">';
    if (true) {
      html += '<label class="visually-hidden" for="add-sub-' + escapeHtml(cat.id) + '">추가할 상세 분류</label>';
      html += '<select class="quick-add__sub" id="add-sub-' + escapeHtml(cat.id) + '" data-role="add-sub" data-focus-key="add-sub:' + escapeHtml(cat.id) + '">';
      html += '<option value=""' + (!addSubId ? ' selected' : '') + '>상세 분류 선택 (미분류)</option>';
      subs.forEach(function (sb) { html += '<option value="' + escapeHtml(sb.id) + '"' + (addSubId === sb.id ? ' selected' : '') + '>' + escapeHtml(subLabel(sb)) + '</option>'; });
      if (subs.length < SUB_MAX) html += '<option value="__new">＋ 새 상세 분류 만들기…</option>';
      html += '</select>';
    }
    html += '<label class="visually-hidden" for="new-item-' + escapeHtml(cat.id) + '">' + escapeHtml(cat.name) + '에 추가할 준비물</label>';
    html += '<input type="text" id="new-item-' + escapeHtml(cat.id) + '" data-focus-key="new-item:' + escapeHtml(cat.id) + '" placeholder="준비물 (예: 윤서 수유 패드 5,000원)" maxlength="80" autocomplete="off" enterkeyhint="done">';
    html += '<button type="submit" class="btn btn--primary">추가</button>';
    html += '<button type="button" class="btn quick-add__bulk' + (bulkOpen ? ' is-active' : '') + '" data-action="bulk-toggle" data-focus-key="bulk-toggle:' + escapeHtml(cat.id) + '" aria-expanded="' + (bulkOpen ? 'true' : 'false') + '" aria-controls="bulk-' + escapeHtml(cat.id) + '">여러 개</button>';
    html += '</form>';
    html += '<form class="bulk-add" id="bulk-' + escapeHtml(cat.id) + '" data-action="bulk-add"' + (bulkOpen ? '' : ' hidden') + '>';
    html += '<label class="visually-hidden" for="bulk-text-' + escapeHtml(cat.id) + '">한 줄에 하나씩 준비물 입력</label>';
    html += '<textarea id="bulk-text-' + escapeHtml(cat.id) + '" data-focus-key="bulk-text:' + escapeHtml(cat.id) + '" rows="6" placeholder="한 줄에 하나씩 적으세요&#10;수유 패드 5,000원&#10;산모 수첩&#10;물티슈 12000"></textarea>';
    html += '<div class="bulk-add__actions"><span class="bulk-add__hint">앞에 이름(기준·윤서·축복)을 붙이면 태그로, 뒤에 금액을 적으면 금액으로 저장됩니다(예: 윤서 물티슈 12000, 축복 젖병 1.5만원). 메모장·카톡에서 복사한 목록을 그대로 붙여넣어도 됩니다.</span>';
    html += '<button type="submit" class="btn btn--primary btn--small">모두 추가</button></div>';
    html += '</form>';
    if (visible.length === 0) {
      html += '<p class="items-empty">' + escapeHtml(emptyMessage(catItems)) + '</p>';
    } else {
      if (!ui.editMode) html += '<div class="items-colhead" aria-hidden="true"><span>준비물</span><span>금액</span></div>';
      if (!ui.editMode && subs.length && !subTab) {
        // '전체': 상세 분류별로 묶어서(묶음 안은 금액 높은순), 묶음마다 개수·소계
        var groups = subs.map(function (sb) { return { sub: sb, list: visible.filter(function (it) { return it.sub === sb.id; }) }; });
        groups.push({ sub: null, list: visible.filter(function (it) { return !hasSub(cat, it); }) });
        groups.forEach(function (g) {
          if (!g.list.length) return;
          var gp = computeProgress(g.list);
          html += '<div class="sub-group"><span class="sub-group__name">' + escapeHtml(g.sub ? subLabel(g.sub) : '미분류') + '</span><span class="sub-group__meta">' + g.list.length + '개' + (gp.sum > 0 ? ' · ' + escapeHtml(formatWon(gp.sum)) : '') + '</span></div>';
          html += '<ul class="items">' + g.list.map(renderItemView).join('') + '</ul>';
        });
      } else {
        ui.showSubLabel = !ui.editMode && !!subTab && subTab !== '__none';
        html += '<ul class="items">' + visible.map(ui.editMode ? renderItemEdit : renderItemView).join('') + '</ul>';
        ui.showSubLabel = false;
      }
    }

    html += '</div>';
    html += '</section>';
    return html;
  }

  function renderSubsManager(cat) {
    var cid = escapeHtml(cat.id);
    var h = '<div class="subs-manager"><p class="subs-manager__title">상세 분류 <small>(분류 안에서 한 번 더 나누기 · 최대 ' + SUB_MAX + '개)</small></p>';
    subsOf(cat).forEach(function (sb) {
      var n = itemsOf(cat.id).filter(function (it) { return it.sub === sb.id; }).length;
      h += '<div class="subs-row" data-sub-id="' + escapeHtml(sb.id) + '">';
      h += '<input type="text" class="subs-row__icon" data-action="set-sub-icon" data-focus-key="sbi:' + escapeHtml(sb.id) + '" value="' + escapeHtml(sb.icon || '') + '" maxlength="' + ICON_MAX + '" placeholder="🙂" aria-label="' + escapeHtml(sb.name) + ' 아이콘">';
      h += '<input type="text" class="subs-row__name" data-action="rename-sub" data-focus-key="sbn:' + escapeHtml(sb.id) + '" value="' + escapeHtml(sb.name) + '" maxlength="' + SUB_NAME_MAX + '" aria-label="상세 분류 이름">';
      h += '<span class="subs-row__count">' + n + '개</span>';
      h += '<button type="button" class="btn btn--small btn--danger" data-action="delete-sub" data-focus-key="sbd:' + escapeHtml(sb.id) + '" aria-label="' + escapeHtml(sb.name) + ' 상세 분류 삭제">삭제</button></div>';
    });
    if (subsOf(cat).length < SUB_MAX) {
      h += '<form class="inline-form subs-add" data-action="add-sub"><label class="visually-hidden" for="new-sub-' + cid + '">새 상세 분류 이름</label>';
      h += '<input type="text" id="new-sub-' + cid + '" data-focus-key="new-sub:' + cid + '" placeholder="새 상세 분류 (예: 🍼 수유)" maxlength="' + (SUB_NAME_MAX + 4) + '" autocomplete="off"><button type="submit" class="btn btn--small">추가</button></form>';
    }
    h += '</div>';
    return h;
  }
  function addSub(catId, text) {
    var cat = findCategory(catId); if (!cat) return false;
    var t = String(text || '').trim();
    if (!t) { showToast('상세 분류 이름을 입력하세요.'); return false; }
    if (subsOf(cat).length >= SUB_MAX) { showToast('상세 분류는 분류마다 ' + SUB_MAX + '개까지 만들 수 있습니다.'); return false; }
    // 맨 앞이 이모지면 아이콘으로
    var icon = '', name = t;
    var m = t.match(/^(\S+)\s+(.+)$/);
    if (m && !/[0-9A-Za-z가-힣]/.test(m[1])) { icon = cleanIcon(m[1]); name = m[2]; }
    name = name.slice(0, SUB_NAME_MAX);
    if (subsOf(cat).some(function (x) { return x.name === name; })) { showToast('같은 이름의 상세 분류가 이미 있습니다.'); return false; }
    if (!cat.subs) cat.subs = [];
    var newId = uid();
    cat.subs.push({ id: newId, name: name, icon: icon });
    commit(); act('category', '‘' + cat.name + '’에 상세 분류 ‘' + name + '’ 추가');
    return newId;
  }
  function deleteSub(catId, subId) {
    var cat = findCategory(catId); var sb = cat && findSub(cat, subId); if (!sb) return;
    var idx = cat.subs.indexOf(sb);
    var moved = state.items.filter(function (it) { return it.categoryId === catId && it.sub === subId; });
    if (moved.length && !window.confirm('‘' + sb.name + '’ 상세 분류를 삭제할까요? 안에 있는 준비물 ' + moved.length + '개는 지워지지 않고 ‘미분류’로 옮겨집니다.')) return;
    cat.subs.splice(idx, 1); moved.forEach(function (it) { it.sub = ''; });
    commit(); act('category', '‘' + cat.name + '’의 상세 분류 ‘' + sb.name + '’ 삭제');
    showToast('상세 분류 ‘' + sb.name + '’을 삭제했습니다.', function () {
      cat.subs.splice(Math.min(idx, cat.subs.length), 0, sb); moved.forEach(function (it) { it.sub = subId; });
      commit(); showToast('삭제를 취소했습니다.');
    });
  }
  // 상세 분류 해제(되돌리기용): catId가 없으면 모든 분류. 준비물은 지우지 않는다.
  function clearSubs(catId) {
    var cats = state.categories.filter(function (c) { return (!catId || c.id === catId) && subsOf(c).length; });
    if (!cats.length) { showToast('해제할 상세 분류가 없습니다.'); return false; }
    if (!window.confirm((catId ? '‘' + cats[0].name + '’의' : '모든 분류의') + ' 상세 분류를 해제할까요? 준비물은 그대로 남고 상세 탭만 사라집니다.')) return false;
    var snap = cats.map(function (c) { return { cat: c, subs: c.subs.slice(), items: state.items.filter(function (it) { return it.categoryId === c.id && it.sub; }).map(function (it) { return { it: it, sub: it.sub }; }) }; });
    snap.forEach(function (x) { x.cat.subs = []; x.items.forEach(function (y) { y.it.sub = ''; }); });
    commit(); act('category', (catId ? '‘' + cats[0].name + '’ ' : '전체 ') + '상세 분류 해제');
    showToast('상세 분류를 해제했습니다.', function () {
      snap.forEach(function (x) { x.cat.subs = x.subs; x.items.forEach(function (y) { y.it.sub = y.sub; }); });
      commit(); showToast('상세 분류를 되돌렸습니다.');
    });
    return true;
  }

  function qtyLabel(it) { return formatWon(it.price); }
  function priceFieldHtml(it, id, focusKey) {
    return '<div class="price-field"><input type="text" id="' + focusKey.replace(':', '-') + '" data-field="price" data-focus-key="' + focusKey + '" value="' + (it.price === null ? '' : formatNumber(it.price)) + '" inputmode="numeric" autocomplete="off" maxlength="11" placeholder="예: 5,000"><span class="price-field__suffix" aria-hidden="true">원</span></div>';
  }

  function renderItemView(it) {
    var id = escapeHtml(it.id);
    var editing = ui.qtyEdit === it.id && !it.excluded;
    var cls = 'item' + (it.done ? ' is-done' : '') + (it.excluded ? ' is-excluded' : '') + (editing ? ' is-qty-editing' : '');
    var html = '<li class="' + cls + '" data-item-id="' + id + '">';
    html += '<div class="item__row">';
    html += '<label class="item__check">';
    html += '<input type="checkbox" data-action="toggle-done" data-focus-key="check:' + id + '"' + (it.done ? ' checked' : '') + (it.excluded ? ' disabled' : '') + ' aria-label="' + escapeHtml(it.name) + ' 가방에 담기 완료">';
    html += '<span class="item__body">';
    if (ui.showSubLabel && it.sub) { var sCat = findCategory(it.categoryId), sSub = sCat && findSub(sCat, it.sub); if (sSub) html += '<span class="item__sub">' + escapeHtml(sSub.name) + '</span>'; }
    html += '<span class="item__name">' + tagsHtml(it) + escapeHtml(it.name) + '</span>';
    if (it.excluded) html += '<span class="badge badge--excluded">제외</span>';
    else if (it.done) html += '<span class="badge badge--done">완료</span>';
    if (it.memo) html += '<span class="item__memo">' + escapeHtml(it.memo) + '</span>';
    html += '</span></label>';
    html += '<div class="item__side">';
    if (it.excluded) {
      html += '<button type="button" class="btn btn--small" data-action="toggle-excluded" data-focus-key="excl:' + id + '" aria-label="' + escapeHtml(it.name) + ' 다시 포함">다시 포함</button>';
    } else {
      var label = qtyLabel(it);
      html += '<button type="button" class="item__qty' + (label ? '' : ' item__qty--empty') + '" data-action="edit-qty" data-focus-key="qty-btn:' + id + '" aria-expanded="' + (editing ? 'true' : 'false') + '" aria-label="' + escapeHtml(it.name) + ' 금액 ' + (label ? escapeHtml(label) : '미입력') + ', 누르면 수정">' + (label ? escapeHtml(label) : '<span aria-hidden="true">＋</span>') + '</button>';
    }
    html += '</div></div>';
    if (editing) {
      html += '<div class="item__qty-edit">';
      html += '<div class="item__qty-edit__row">';
      html += '<div class="field"><label for="q-qty-' + id + '">금액</label>' + priceFieldHtml(it, id, 'q-qty:' + id) + '</div>';
      html += '<button type="button" class="btn btn--primary btn--small item__qty-done" data-action="close-qty" data-focus-key="q-done:' + id + '">완료</button>';
      html += '</div>';
      html += '<p class="field-error" data-error hidden></p>';
      html += '</div>';
    }
    html += '</li>';
    return html;
  }

  function renderItemEdit(it) {
    var id = escapeHtml(it.id);
    var badges = (it.excluded ? ' <span class="badge badge--excluded">제외됨</span>' : '') + (it.done && !it.excluded ? ' <span class="badge badge--done">완료</span>' : '');
    if (ui.itemEdit !== it.id) {
      // Compact row: keeps edit mode short on phones; one item expands at a time.
      var c = 'item item--edit-compact' + (it.done ? ' is-done' : '') + (it.excluded ? ' is-excluded' : '');
      var h = '<li class="' + c + '" data-item-id="' + id + '"><div class="item__edit-row">';
      h += '<span class="item__body"><span class="item__name">' + tagsHtml(it) + escapeHtml(it.name) + '</span>' + badges;
      if (it.memo) h += '<span class="item__memo">' + escapeHtml(it.memo) + '</span>';
      h += '</span>';
      var siblings = itemsOf(it.categoryId);
      var pos = siblings.map(function (x) { return x.id; }).indexOf(it.id);
      h += '<span class="item__edit-btns">';
      h += '<span class="reorder"><button type="button" class="btn btn--small reorder__btn" data-action="item-up" data-focus-key="iup:' + id + '"' + (pos <= 0 ? ' disabled' : '') + ' aria-label="' + escapeHtml(it.name) + ' 위로">▲</button>';
      h += '<button type="button" class="btn btn--small reorder__btn" data-action="item-down" data-focus-key="idown:' + id + '"' + (pos >= siblings.length - 1 ? ' disabled' : '') + ' aria-label="' + escapeHtml(it.name) + ' 아래로">▼</button></span>';
      h += '<button type="button" class="btn btn--small" data-action="open-item-edit" data-focus-key="iedit:' + id + '" aria-label="' + escapeHtml(it.name) + ' 수정">수정</button>';
      h += '<button type="button" class="btn btn--small btn--danger" data-action="delete-item" data-focus-key="del:' + id + '" aria-label="' + escapeHtml(it.name) + ' 삭제">삭제</button>';
      h += '</span></div></li>';
      return h;
    }
    var cls = 'item item--edit' + (it.done ? ' is-done' : '') + (it.excluded ? ' is-excluded' : '');
    var html = '<li class="' + cls + '" data-item-id="' + id + '">';
    html += '<div class="item__edit-grid">';

    html += '<div class="field"><label for="name-' + id + '">이름' + badges + '</label>';
    html += '<input type="text" id="name-' + id + '" data-field="name" data-focus-key="name:' + id + '" value="' + escapeHtml(it.name) + '" maxlength="60" required></div>';

    html += '<div class="field"><label for="qty-' + id + '">금액</label>' + priceFieldHtml(it, id, 'qty:' + id) + '</div>';
    var eCat = findCategory(it.categoryId);
    if (eCat && subsOf(eCat).length) {
      html += '<div class="field"><label for="sub-' + id + '">상세 분류</label><select id="sub-' + id + '" data-field="sub" data-focus-key="sub:' + id + '">';
      html += '<option value=""' + (!hasSub(eCat, it) ? ' selected' : '') + '>미분류</option>';
      subsOf(eCat).forEach(function (sb) { html += '<option value="' + escapeHtml(sb.id) + '"' + (it.sub === sb.id ? ' selected' : '') + '>' + escapeHtml(subLabel(sb)) + '</option>'; });
      html += '</select></div>';
    }

    var tagOptions = TAG_NAMES.slice(); (it.tags || []).forEach(function (t) { if (tagOptions.indexOf(t) === -1) tagOptions.push(t); });
    html += '<div class="field"><span class="field__label">누구 것 (여러 명 선택 가능)</span><div class="tag-picks">';
    tagOptions.forEach(function (t) {
      var on = (it.tags || []).indexOf(t) !== -1;
      html += '<label class="tag-pick ' + tagClass(t) + (on ? ' is-active' : '') + '"><input type="checkbox" data-field="tag" data-tag="' + escapeHtml(t) + '" data-focus-key="tag:' + id + ':' + escapeHtml(t) + '"' + (on ? ' checked' : '') + '> ' + escapeHtml(t) + '</label>';
    });
    html += '</div></div>';
    html += '<div class="field"><label for="memo-' + id + '">메모 (선택)</label>';
    html += '<input type="text" id="memo-' + id + '" data-field="memo" data-focus-key="memo:' + id + '" value="' + escapeHtml(it.memo) + '" maxlength="200" placeholder="예: 출발 직전에 챙기기, 병원 제공, 보호자 담당"></div>';

    html += '<p class="field-error" data-error hidden></p>';

    html += '<div class="item__actions">';
    html += '<div class="field"><label class="visually-hidden" for="move-' + id + '">분류 이동</label>';
    html += '<select id="move-' + id + '" data-action="move-item" data-focus-key="move:' + id + '" aria-label="' + escapeHtml(it.name) + ' 분류 이동">';
    state.categories.forEach(function (c) {
      html += '<option value="' + escapeHtml(c.id) + '"' + (c.id === it.categoryId ? ' selected' : '') + '>' + escapeHtml(c.name) + (c.id === it.categoryId ? ' (현재)' : '') + '</option>';
    });
    html += '</select></div>';
    html += '<button type="button" class="btn btn--small" data-action="toggle-excluded" data-focus-key="excl:' + id + '">' + (it.excluded ? '다시 포함' : '준비 대상에서 제외') + '</button>';
    html += '<button type="button" class="btn btn--small btn--danger" data-action="delete-item" data-focus-key="del:' + id + '" aria-label="' + escapeHtml(it.name) + ' 삭제">삭제</button>';
    html += '<button type="button" class="btn btn--small btn--primary" data-action="close-item-edit" data-focus-key="iclose:' + id + '">완료</button>';
    html += '</div>';

    html += '</div></li>';
    return html;
  }

  /* ---------- 진료 메모 ---------- */
  function sortedNotes() {
    return state.notes.slice().sort(function (a, b) {
      if (!!a.fav !== !!b.fav) return a.fav ? -1 : 1; // 즐겨찾기 먼저
      if (a.date !== b.date) return a.date < b.date ? 1 : -1; // newest first; '' (no date) last
      return 0;
    });
  }

  function formatNoteDate(d) {
    if (!d) return '날짜 없음';
    var parts = d.split('-');
    return parts[0] + '년 ' + parseInt(parts[1], 10) + '월 ' + parseInt(parts[2], 10) + '일';
  }

  function noteFormHtml(note) {
    var isNew = !note;
    var id = isNew ? 'new' : escapeHtml(note.id);
    var html = '<form class="note-form" data-note-form="' + id + '">';
    html += '<div class="field-row"><div class="field"><label for="note-date-' + id + '">진료 날짜</label>';
    html += '<input type="date" id="note-date-' + id + '" name="date" data-focus-key="note-date:' + id + '" value="' + escapeHtml(isNew ? todayStamp() : note.date) + '"></div>';
    html += '<div class="field"><label for="note-title-' + id + '">제목 (선택)</label>';
    html += '<input type="text" id="note-title-' + id + '" name="title" data-focus-key="note-title:' + id + '" value="' + escapeHtml(isNew ? '' : note.title) + '" maxlength="60" placeholder="예: 32주 정기검진"></div></div>';
    html += '<div class="field"><label for="note-body-' + id + '">내용</label>';
    html += '<textarea id="note-body-' + id + '" name="body" data-focus-key="note-body:' + id + '" rows="6" maxlength="' + NOTE_MAX + '" placeholder="선생님 말씀, 검사 결과, 다음 진료 일정 등을 한 줄씩 적어 두세요.">' + escapeHtml(isNew ? '' : note.body) + '</textarea></div>';
    html += '<p class="field-error" data-error hidden></p>';
    html += '<div class="note-form__actions"><button type="submit" class="btn btn--primary">' + (isNew ? '메모 저장' : '수정 저장') + '</button>';
    html += '<button type="button" class="btn" data-action="cancel-note">취소</button></div>';
    html += '</form>';
    return html;
  }

  function backLabel() { return ui.detailFrom === 'archive' ? '← 보관함' : '← 목록'; }
  function noteCountsHtml(n) {
    return (n.likes.length ? '<span class="memo-count memo-count--like">♥ ' + n.likes.length + '</span>' : '') + (n.comments.length ? '<span class="memo-count">💬 ' + n.comments.length + '</span>' : '');
  }
  function renderNotes() {
    var view = $('#view-notes'), wrap = $('#notes-list-wrap'), detail = $('#note-detail'), list = $('#notes-list');
    if (!view || !wrap || !detail || !list) return;
    if (ui.noteOpen && !findNote(ui.noteOpen)) { ui.noteOpen = null; if (ui.noteForm !== 'new') ui.noteForm = null; } // 다른 기기에서 삭제됨
    var open = ui.noteOpen ? findNote(ui.noteOpen) : null;
    view.classList.toggle('is-detail', !!open);
    wrap.hidden = !!open; detail.hidden = !open;
    $('#notes-count').textContent = state.notes.length ? state.notes.length + '개' : '';
    if (open) {
      detail.dataset.noteId = open.id;
      detail.innerHTML = noteDetailHtml(open);
      return;
    }
    detail.removeAttribute('data-note-id'); detail.innerHTML = '';
    var notes = sortedNotes();
    var html = '';
    if (ui.noteForm === 'new') html += '<li class="note note--editing">' + noteFormHtml(null) + '</li>';
    if (notes.length === 0 && ui.noteForm !== 'new') {
      html += '<li class="notes-empty">아직 진료 메모가 없습니다. ‘일지 쓰기’를 눌러 첫 기록을 남겨 보세요.</li>';
    }
    notes.forEach(function (n) {
      var id = escapeHtml(n.id);
      var lines = n.body.split('\n').map(function (l) { return l.trim(); }).filter(Boolean);
      html += '<li class="memo-card note-card' + (n.fav ? ' is-fav' : '') + '" data-note-id="' + id + '">';
      html += '<button type="button" class="memo-card__open" data-action="note-open" data-focus-key="note-open:' + id + '">';
      html += '<span class="memo-card__title"><span class="note-card__date">' + escapeHtml(formatNoteDate(n.date)) + '</span>' + (n.title ? ' · ' + escapeHtml(n.title) : '') + '</span>';
      if (lines.length) html += '<span class="memo-card__preview">' + escapeHtml(lines.slice(0, 4).join(' ').slice(0, 160)) + '</span>';
      html += '<span class="memo-card__meta"><span class="memo-card__by"></span><span class="memo-card__counts">' + noteCountsHtml(n) + '</span></span></button>';
      html += '<button type="button" class="memo-card__fav' + (n.fav ? ' is-on' : '') + '" data-action="note-fav" data-focus-key="note-fav:' + id + '" aria-pressed="' + (n.fav ? 'true' : 'false') + '" aria-label="즐겨찾기' + (n.fav ? ' 해제' : '') + '">' + (n.fav ? '★' : '☆') + '</button></li>';
    });
    list.innerHTML = html;
    $('#add-note-btn').hidden = ui.noteForm === 'new';
  }
  // 일지 상세: 읽기(좋아요·댓글) 또는 수정 폼
  function noteDetailHtml(n) {
    var id = escapeHtml(n.id);
    var editing = ui.noteForm === n.id;
    var h = '<div class="memo-detail__bar"><button type="button" class="btn btn--small" data-action="note-back" data-focus-key="note-back">' + backLabel() + '</button><span class="memo-detail__actions">';
    h += '<button type="button" class="btn btn--small memo-favbtn' + (n.fav ? ' is-on' : '') + '" data-action="note-fav" data-focus-key="note-favd" aria-pressed="' + (n.fav ? 'true' : 'false') + '">' + (n.fav ? '★ 즐겨찾기' : '☆ 즐겨찾기') + '</button>';
    if (!editing) {
      h += '<button type="button" class="btn btn--small" data-action="edit-note" data-focus-key="note-edit:' + id + '">수정</button>';
      h += '<button type="button" class="btn btn--small btn--danger" data-action="delete-note" data-focus-key="note-del:' + id + '">삭제</button>';
    }
    h += '</span></div>';
    if (editing) return h + '<div class="note note--editing">' + noteFormHtml(n) + '</div>';
    var me = myName();
    var liked = n.likes.indexOf(me) !== -1;
    h += '<article class="memo-detail__body"><p class="memo-detail__meta">🏥 ' + escapeHtml(formatNoteDate(n.date)) + '</p>';
    if (n.title) h += '<h3 class="note-detail__title">' + escapeHtml(n.title) + '</h3>';
    if (n.body) h += '<div class="memo-detail__text">' + escapeHtml(n.body) + '</div>';
    h += '</article>';
    h += '<div class="memo-detail__react"><button type="button" class="memo-like' + (liked ? ' is-on' : '') + '" data-action="note-like" data-focus-key="note-like:' + id + '" aria-pressed="' + (liked ? 'true' : 'false') + '">' + (liked ? '♥' : '♡') + ' 좋아요' + (n.likes.length ? ' <b>' + n.likes.length + '</b>' : '') + '</button>';
    if (n.likes.length) h += '<span class="memo-like__who">' + escapeHtml(n.likes.join(', ')) + '</span>';
    h += '</div>';
    h += '<section class="memo-comments note__comments" aria-label="댓글"><h3 class="memo-comments__title">💬 댓글 ' + (n.comments.length || '') + '</h3>';
    if (n.comments.length) {
      h += '<ul class="memo-comments__list">' + n.comments.map(function (c) {
        return '<li class="memo-comment" data-comment-id="' + escapeHtml(c.id) + '"><div class="memo-comment__head"><span class="memo-comment__who">' + escapeHtml(c.who || '가족') + '</span><span class="memo-comment__time">' + escapeHtml(memoStamp(c.t)) + '</span>' +
          '<button type="button" class="memo-comment__del" data-action="note-comment-del" aria-label="이 댓글 삭제">×</button></div><p class="memo-comment__text">' + escapeHtml(c.text) + '</p></li>';
      }).join('') + '</ul>';
    } else h += '<p class="memo-comments__empty">첫 댓글을 남겨 보세요.</p>';
    h += '<form class="memo-comments__form" data-action="note-comment"><label class="visually-hidden" for="note-comment-' + id + '">댓글 입력</label>';
    h += '<input type="text" id="note-comment-' + id + '" data-role="note-comment-input" data-focus-key="note-comment:' + id + '" maxlength="' + COMMENT_MAX + '" placeholder="댓글 달기" autocomplete="off" enterkeyhint="send" value="' + escapeHtml(ui.noteCommentDraft[n.id] || '') + '"><button type="submit" class="btn btn--primary btn--small">등록</button></form></section>';
    return h;
  }
  function openNote(id, from) {
    if (!findNote(id)) return;
    ui.noteOpen = id; ui.noteForm = null; ui.detailFrom = from || null;
    if (ui.view !== 'notes') setView('notes'); else renderNotes();
    window.scrollTo(0, 0);
  }
  function closeNote() { ui.noteOpen = null; if (ui.noteForm !== 'new') ui.noteForm = null; ui.detailFrom = null; }

  /* ---------- 보관함 (설정 탭): 즐겨찾기 / 내가 좋아요 한 글 ---------- */
  function archiveEntries(tab) {
    var me = myName();
    var pick = function (x) { return tab === 'fav' ? !!x.fav : x.likes.indexOf(me) !== -1; };
    var out = [];
    state.notes.forEach(function (n) {
      if (!pick(n)) return;
      var lines = n.body.split('\n').map(function (l) { return l.trim(); }).filter(Boolean);
      out.push({ kind: 'note', id: n.id, title: n.title || lines[0] || formatNoteDate(n.date), sub: formatNoteDate(n.date), t: n.date ? Date.parse(n.date + 'T00:00:00') || 0 : 0, likes: n.likes.length, comments: n.comments.length });
    });
    state.memos.forEach(function (m) {
      if (!pick(m)) return;
      out.push({ kind: 'memo', id: m.id, title: (memoLines(m)[0] || '').slice(0, 80), sub: [m.who, memoStamp(m.updated)].filter(Boolean).join(' · '), t: m.updated || 0, likes: m.likes.length, comments: m.comments.length });
    });
    state.dates.forEach(function (d) {
      if (!(tab === 'fav' ? !!d.fav : d.likes.indexOf(me) !== -1)) return;
      out.push({ kind: 'date', id: d.id, title: dateHeadline(d) + (d.label ? ' · ' + d.label : ''), sub: d.memo ? d.memo.split('\n')[0].slice(0, 40) : '택일 후보', t: d.date ? Date.parse(d.date + 'T00:00:00') || 0 : 0, likes: d.likes.length, comments: d.comments.length });
    });
    state.names.forEach(function (n) {
      if (!(tab === 'fav' ? !!n.favorite : n.likes.indexOf(me) !== -1)) return;
      out.push({ kind: 'name', id: n.id, title: n.name, sub: n.hanja.length ? n.hanja.map(function (x) { return x.chars; }).filter(Boolean).join(' / ') || '이름 후보' : '이름 후보', t: 0, likes: n.likes.length, comments: n.comments.length });
    });
    var rank = { note: 0, memo: 0, date: 1, name: 2 };
    out.sort(function (a, b) { return rank[a.kind] - rank[b.kind] || b.t - a.t; });
    return out;
  }
  function renderArchive() {
    var box = $('#archive-list'); if (!box) return;
    var favs = archiveEntries('fav'), likes = archiveEntries('like');
    var fc = $('#archive-fav-count'), lc = $('#archive-like-count');
    if (fc) fc.textContent = favs.length ? String(favs.length) : '';
    if (lc) lc.textContent = likes.length ? String(likes.length) : '';
    Array.prototype.forEach.call(document.querySelectorAll('.archive-tab'), function (b) {
      var on = b.dataset.tab === ui.archiveTab;
      b.classList.toggle('is-active', on); b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    var list = ui.archiveTab === 'like' ? likes : favs;
    if (!list.length) {
      box.innerHTML = '<li class="archive-empty">' + (ui.archiveTab === 'like' ? '아직 좋아요를 누른 글이 없습니다. 일지·메모·택일·작명에서 ♡ 좋아요를 눌러 보세요.' : '아직 즐겨찾기한 글이 없습니다. 일지·메모·택일·작명에서 ☆를 눌러 보세요.') + '</li>';
      return;
    }
    box.innerHTML = list.map(function (e) {
      return '<li><button type="button" class="archive-item" data-action="archive-open" data-kind="' + e.kind + '" data-id="' + escapeHtml(e.id) + '" data-focus-key="arch:' + e.kind + ':' + escapeHtml(e.id) + '">' +
        '<span class="archive-item__kind archive-item__kind--' + e.kind + '">' + ({ note: '일지', memo: '메모', date: '택일', name: '작명' })[e.kind] + '</span>' +
        '<span class="archive-item__main"><span class="archive-item__title">' + escapeHtml(e.title) + '</span><span class="archive-item__sub">' + escapeHtml(e.sub) + (e.likes ? ' · ♥ ' + e.likes : '') + (e.comments ? ' · 💬 ' + e.comments : '') + '</span></span>' +
        '<span class="archive-item__chev" aria-hidden="true">›</span></button></li>';
    }).join('');
  }

  function findNote(id) { for (var i = 0; i < state.notes.length; i++) if (state.notes[i].id === id) return state.notes[i]; return null; }
  function noteLabel(n) { return n.title || formatNoteDate(n.date); }
  function toggleNoteFav(id) {
    var n = findNote(id); if (!n) return;
    n.fav = !n.fav; commit();
    showToast(n.fav ? '즐겨찾기에 추가했습니다. 목록 맨 위에 고정됩니다.' : '즐겨찾기를 해제했습니다.');
  }
  function toggleNoteLike(id) {
    var n = findNote(id); if (!n) return;
    var me = myName(); var i = n.likes.indexOf(me);
    if (i === -1) n.likes.push(me); else n.likes.splice(i, 1);
    commit();
    if (i === -1) act('note', '일지 ‘' + noteLabel(n) + '’에 좋아요');
  }
  function addNoteComment(id, text) {
    var n = findNote(id); if (!n) return false;
    var t = String(text || '').replace(/\r\n?/g, '\n').trim().slice(0, COMMENT_MAX);
    if (!t) { showToast('댓글 내용을 입력하세요.'); return false; }
    if (n.comments.length >= COMMENTS_PER_MEMO) { showToast('댓글은 일지마다 ' + COMMENTS_PER_MEMO + '개까지 남길 수 있습니다.'); return false; }
    n.comments.push({ id: uid(), who: myName(), text: t, t: Date.now() });
    delete ui.noteCommentDraft[id];
    commit(); act('note', '일지 ‘' + noteLabel(n) + '’에 댓글: ' + t.slice(0, 30));
    return true;
  }
  function deleteNoteComment(id, cid) {
    var n = findNote(id); if (!n) return;
    var idx = -1; n.comments.forEach(function (c, i) { if (c.id === cid) idx = i; });
    if (idx < 0) return;
    var c = n.comments[idx];
    n.comments.splice(idx, 1); commit();
    showToast('댓글을 삭제했습니다.', function () { var nn = findNote(id); if (!nn) return; nn.comments.splice(Math.min(idx, nn.comments.length), 0, c); commit(); showToast('삭제를 취소했습니다.'); });
  }

  function readNoteForm(form) {
    var date = form.elements.date.value;
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) date = '';
    var title = form.elements.title.value.trim().slice(0, 60);
    var body = form.elements.body.value.replace(/\r\n?/g, '\n').trim().slice(0, NOTE_MAX);
    return { date: date, title: title, body: body };
  }

  function submitNoteForm(form) {
    var v = readNoteForm(form);
    var err = $('[data-error]', form);
    if (!v.title && !v.body) {
      err.textContent = '내용이나 제목 중 하나는 입력해야 합니다.';
      err.hidden = false;
      form.elements.body.focus();
      return;
    }
    var key = form.dataset.noteForm;
    if (key === 'new') {
      state.notes.push({ id: uid(), date: v.date, title: v.title, body: v.body, fav: false, likes: [], comments: [] });
      ui.noteForm = null;
      commit();
      act('note', '일지 ‘' + (v.title || formatNoteDate(v.date)) + '’ 작성');
      showToast('일지를 저장했습니다.');
      var addBtn = $('#add-note-btn');
      if (addBtn) addBtn.focus();
    } else {
      var note = null;
      for (var i = 0; i < state.notes.length; i++) if (state.notes[i].id === key) note = state.notes[i];
      if (!note) { ui.noteForm = null; render(); return; }
      note.date = v.date; note.title = v.title; note.body = v.body;
      ui.noteForm = null;
      commit();
      act('note', '일지 ‘' + (v.title || formatNoteDate(v.date)) + '’ 수정');
      showToast('일지를 수정했습니다.');
      var editBtn = document.querySelector('[data-focus-key="note-edit:' + key + '"]');
      if (editBtn) editBtn.focus();
    }
  }

  function deleteNote(id) {
    var idx = -1;
    for (var i = 0; i < state.notes.length; i++) if (state.notes[i].id === id) idx = i;
    if (idx < 0) return;
    var note = state.notes[idx];
    if (!window.confirm('‘' + formatNoteDate(note.date) + (note.title ? ' · ' + note.title : '') + '’ 메모를 삭제할까요?')) return;
    state.notes.splice(idx, 1);
    if (ui.noteForm === id) ui.noteForm = null;
    if (ui.noteOpen === id) { ui.noteOpen = null; ui.detailFrom = null; }
    commit();
    act('note', '일지 ‘' + (note.title || formatNoteDate(note.date)) + '’ 삭제');
    showToast('일지를 삭제했습니다.', function () {
      state.notes.splice(Math.min(idx, state.notes.length), 0, note);
      commit();
      showToast('삭제를 취소했습니다.');
    });
  }

  /* ---------- 택일 정보 (GPT / Claude) ---------- */
  function activePickKey() {
    return ui.picksActive === 'claude' ? 'claude' : 'gpt';
  }

  function renderPickTabs() {
    var bar = $('#pick-tabs');
    if (!bar) return;
    var active = activePickKey();
    bar.innerHTML = PICK_KEYS.map(function (key) {
      var filled = !!(state.picks && state.picks[key]);
      var on = key === active;
      return '<button type="button" role="tab" class="category-tab' + (on ? ' is-active' : '') + '" data-action="pick-subtab" data-pick-key="' + key + '" data-focus-key="picktab:' + key + '" aria-selected="' + (on ? 'true' : 'false') + '" aria-controls="pick-' + key + '" tabindex="' + (on ? '0' : '-1') + '">' +
        '<span class="category-tab__name">' + pickLabel(key) + '</span>' +
        (filled ? '<span class="category-tab__count">작성됨</span>' : '') + '</button>';
    }).join('');
  }

  function renderPicks() {
    renderPickTabs();
    var active = activePickKey();
    PICK_KEYS.forEach(function (key) {
      var card = document.querySelector('[data-pick="' + key + '"]');
      if (!card) return;
      card.hidden = key !== active; // only the active pick block is shown
      var body = $('.pick__body', card);
      var editBtn = $('[data-action="edit-pick"]', card);
      var text = (state.picks && state.picks[key]) || '';
      if (ui.picksEdit === key) {
        editBtn.hidden = true;
        body.innerHTML = '<form class="pick-form" data-pick-form="' + key + '">' +
          '<label class="visually-hidden" for="pick-input-' + key + '">' + pickLabel(key) + '이(가) 알려준 택일 정보</label>' +
          '<textarea id="pick-input-' + key + '" rows="12" maxlength="' + PICK_MAX + '" data-focus-key="pick-input:' + key + '" placeholder="' + pickLabel(key) + '에게 받은 택일 정보를 붙여넣으세요.">' + escapeHtml(text) + '</textarea>' +
          '<div class="note-form__actions"><button type="submit" class="btn btn--primary btn--small">저장</button>' +
          '<button type="button" class="btn btn--small" data-action="cancel-pick">취소</button></div></form>';
        return;
      }
      editBtn.hidden = false;
      editBtn.textContent = text ? '수정' : '붙여넣기';
      body.innerHTML = text
        ? '<div class="pick__text">' + escapeHtml(text) + '</div>'
        : '<p class="pick__empty">' + pickLabel(key) + '에게 받은 택일 정보를 여기에 붙여넣으세요.</p>';
    });
  }

  function setActivePick(key) {
    if (PICK_KEYS.indexOf(key) === -1 || key === activePickKey()) return;
    ui.picksActive = key;
    ui.picksEdit = null;
    saveUiPrefs();
    renderPicks();
  }

  function savePick(key, text) {
    if (PICK_KEYS.indexOf(key) === -1) return;
    if (!state.picks) state.picks = emptyPicks();
    state.picks[key] = cleanPickText(text);
    ui.picksEdit = null;
    commit();
    act('pick', pickLabel(key) + ' 택일 메모 ' + (state.picks[key] ? '수정' : '비움'));
    showToast(state.picks[key] ? (pickLabel(key) + ' 택일 정보를 저장했습니다.') : (pickLabel(key) + ' 택일 정보를 비웠습니다.'));
    var eb = document.querySelector('[data-pick="' + key + '"] [data-action="edit-pick"]');
    if (eb) eb.focus();
  }

  /* ---------- 택일 후보 + 작명 노트 (연계) ---------- */
  function findDate(id) { for (var i = 0; i < state.dates.length; i++) if (state.dates[i].id === id) return state.dates[i]; return null; }
  function findName(id) { for (var i = 0; i < state.names.length; i++) if (state.names[i].id === id) return state.names[i]; return null; }

  function dateHeadline(d) {
    var parts = [];
    if (d.date) parts.push(formatNoteDate(d.date));
    if (d.time) parts.push(d.time);
    return parts.join(' ') || '날짜 미정';
  }
  function namesForDate(dateId) { return state.names.filter(function (n) { return n.dateIds.indexOf(dateId) !== -1; }); }

  function dateFormHtml(d) {
    var isNew = !d;
    var id = isNew ? 'new' : escapeHtml(d.id);
    var h = '<form class="date-form" data-date-form="' + id + '">';
    h += '<div class="field-row"><div class="field"><label for="date-d-' + id + '">날짜</label>';
    h += '<input type="date" id="date-d-' + id + '" name="date" data-focus-key="date-d:' + id + '" value="' + escapeHtml(isNew ? '' : d.date) + '"></div>';
    h += '<div class="field"><label for="date-t-' + id + '">시간 (선택)</label>';
    h += '<input type="text" id="date-t-' + id + '" name="time" data-focus-key="date-t:' + id + '" value="' + escapeHtml(isNew ? '' : d.time) + '" maxlength="' + DATE_TIME_MAX + '" placeholder="예: 오전 10시"></div></div>';
    h += '<div class="field"><label for="date-l-' + id + '">라벨 (선택)</label>';
    h += '<input type="text" id="date-l-' + id + '" name="label" data-focus-key="date-l:' + id + '" value="' + escapeHtml(isNew ? '' : d.label) + '" maxlength="' + DATE_LABEL_MAX + '" placeholder="예: 1순위, 철학관 추천"></div>';
    h += '<div class="field"><label for="date-m-' + id + '">메모 (선택)</label>';
    h += '<textarea id="date-m-' + id + '" name="memo" rows="3" maxlength="' + DATE_MEMO_MAX + '" data-focus-key="date-m:' + id + '" placeholder="사주 풀이, 병원 가능 여부 등">' + escapeHtml(isNew ? '' : d.memo) + '</textarea></div>';
    h += '<p class="field-error" data-error hidden></p>';
    h += '<div class="note-form__actions"><button type="submit" class="btn btn--primary btn--small">' + (isNew ? '택일 후보 저장' : '수정 저장') + '</button>';
    h += '<button type="button" class="btn btn--small" data-action="cancel-date">취소</button></div></form>';
    return h;
  }

  function datesSorted() {
    return state.dates.slice().sort(function (a, b) {
      if (!!a.fav !== !!b.fav) return a.fav ? -1 : 1; // 즐겨찾기 먼저
      var ad = a.date || '9999-99-99', bd = b.date || '9999-99-99';
      if (ad !== bd) return ad < bd ? -1 : 1;
      return state.dates.indexOf(a) - state.dates.indexOf(b);
    });
  }

  /* ---------- 택일·작명 공용: 좋아요 · 댓글(펼침) ---------- */
  function rxTarget(kind, id) { return kind === 'date' ? findDate(id) : findName(id); }
  function rxLabel(kind, x) { return kind === 'date' ? '택일 후보 ‘' + (x.label || dateHeadline(x)) + '’' : '이름 후보 ‘' + x.name + '’'; }
  function rxRender(kind) { if (kind === 'date') renderDates(); else renderNames(); }
  function rxHtml(kind, x) {
    var key = kind + ':' + x.id, id = escapeHtml(x.id);
    var me = myName();
    var liked = x.likes.indexOf(me) !== -1;
    var open = !!ui.rxOpen[key];
    var h = '<div class="note__react">';
    h += '<button type="button" class="memo-like memo-like--small' + (liked ? ' is-on' : '') + '" data-action="rx-like" data-focus-key="rx-like:' + kind + ':' + id + '" aria-pressed="' + (liked ? 'true' : 'false') + '">' + (liked ? '♥' : '♡') + ' 좋아요' + (x.likes.length ? ' <b>' + x.likes.length + '</b>' : '') + '</button>';
    h += '<button type="button" class="memo-like memo-like--small note__cbtn' + (open ? ' is-open' : '') + '" data-action="rx-comments" data-focus-key="rx-cbtn:' + kind + ':' + id + '" aria-expanded="' + (open ? 'true' : 'false') + '">💬 댓글' + (x.comments.length ? ' <b>' + x.comments.length + '</b>' : '') + '</button>';
    if (x.likes.length) h += '<span class="memo-like__who">' + escapeHtml(x.likes.join(', ')) + '</span>';
    h += '</div>';
    if (!open) return h;
    h += '<section class="memo-comments note__comments rx-comments" aria-label="댓글">';
    if (x.comments.length) {
      h += '<ul class="memo-comments__list">' + x.comments.map(function (c) {
        return '<li class="memo-comment" data-comment-id="' + escapeHtml(c.id) + '"><div class="memo-comment__head"><span class="memo-comment__who">' + escapeHtml(c.who || '가족') + '</span><span class="memo-comment__time">' + escapeHtml(memoStamp(c.t)) + '</span>' +
          '<button type="button" class="memo-comment__del" data-action="rx-comment-del" aria-label="이 댓글 삭제">×</button></div><p class="memo-comment__text">' + escapeHtml(c.text) + '</p></li>';
      }).join('') + '</ul>';
    } else h += '<p class="memo-comments__empty">첫 댓글을 남겨 보세요.</p>';
    h += '<form class="memo-comments__form" data-action="rx-comment"><label class="visually-hidden" for="rx-input-' + kind + '-' + id + '">댓글 입력</label>';
    h += '<input type="text" id="rx-input-' + kind + '-' + id + '" data-role="rx-input" data-focus-key="rx-input:' + kind + ':' + id + '" maxlength="' + COMMENT_MAX + '" placeholder="댓글 달기" autocomplete="off" enterkeyhint="send" value="' + escapeHtml(ui.rxDraft[key] || '') + '"><button type="submit" class="btn btn--primary btn--small">등록</button></form></section>';
    return h;
  }
  function rxToggleLike(kind, id) {
    var x = rxTarget(kind, id); if (!x) return;
    var me = myName(); var i = x.likes.indexOf(me);
    if (i === -1) x.likes.push(me); else x.likes.splice(i, 1);
    commit();
    if (i === -1) act(kind, rxLabel(kind, x) + '에 좋아요');
  }
  function rxAddComment(kind, id, text) {
    var x = rxTarget(kind, id); if (!x) return false;
    var t = String(text || '').replace(/\r\n?/g, '\n').trim().slice(0, COMMENT_MAX);
    if (!t) { showToast('댓글 내용을 입력하세요.'); return false; }
    if (x.comments.length >= COMMENTS_PER_MEMO) { showToast('댓글은 항목마다 ' + COMMENTS_PER_MEMO + '개까지 남길 수 있습니다.'); return false; }
    x.comments.push({ id: uid(), who: myName(), text: t, t: Date.now() });
    delete ui.rxDraft[kind + ':' + id];
    commit(); act(kind, rxLabel(kind, x) + '에 댓글: ' + t.slice(0, 30));
    return true;
  }
  function rxDeleteComment(kind, id, cid) {
    var x = rxTarget(kind, id); if (!x) return;
    var idx = -1; x.comments.forEach(function (c, i) { if (c.id === cid) idx = i; });
    if (idx < 0) return;
    var c = x.comments[idx];
    x.comments.splice(idx, 1); commit();
    showToast('댓글을 삭제했습니다.', function () { var y = rxTarget(kind, id); if (!y) return; y.comments.splice(Math.min(idx, y.comments.length), 0, c); commit(); showToast('삭제를 취소했습니다.'); });
  }
  function toggleDateFav(id) {
    var d = findDate(id); if (!d) return;
    d.fav = !d.fav; commit();
    act('date', rxLabel('date', d) + ' ' + (d.fav ? '★ 즐겨찾기' : '즐겨찾기 해제'));
    showToast(d.fav ? '즐겨찾기에 추가했습니다. 목록 맨 위에 고정됩니다.' : '즐겨찾기를 해제했습니다.');
  }
  // 보관함 등에서 특정 카드로 이동: 화면 전환 → 댓글 펼침 → 스크롤·강조
  function jumpToCard(kind, id) {
    if (!rxTarget(kind, id)) return;
    ui.rxOpen[kind + ':' + id] = true;
    var view = kind === 'date' ? 'picks' : 'names';
    if (ui.view !== view) setView(view); else rxRender(kind);
    var el = document.querySelector('[data-' + kind + '-id="' + id + '"]');
    if (!el) return;
    el.scrollIntoView({ block: 'center' });
    el.classList.add('is-flash');
    setTimeout(function () { el.classList.remove('is-flash'); }, 1600);
    var fb = el.querySelector('[data-action="rx-like"]'); if (fb) fb.focus({ preventScroll: true });
  }
  // 택일·작명 화면의 좋아요/댓글 이벤트
  function bindRx(viewEl, kind) {
    var idOf = function (el) { var li = el.closest('[data-' + kind + '-id]'); return li ? li.dataset[kind + 'Id'] : null; };
    viewEl.addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-action^="rx-"]'); if (!btn) return;
      var id = idOf(btn); if (!id) return;
      switch (btn.dataset.action) {
        case 'rx-like': rxToggleLike(kind, id); break;
        case 'rx-comments': {
          var key = kind + ':' + id;
          if (ui.rxOpen[key]) delete ui.rxOpen[key]; else ui.rxOpen[key] = true;
          rxRender(kind);
          var f = document.querySelector('[data-focus-key="' + (ui.rxOpen[key] ? 'rx-input:' : 'rx-cbtn:') + kind + ':' + id + '"]'); if (f) f.focus();
          break;
        }
        case 'rx-comment-del': rxDeleteComment(kind, id, btn.closest('[data-comment-id]').dataset.commentId); break;
      }
    });
    viewEl.addEventListener('submit', function (e) {
      var form = e.target.closest('form[data-action="rx-comment"]'); if (!form) return;
      e.preventDefault(); e.stopPropagation();
      var id = idOf(form); if (!id) return;
      if (rxAddComment(kind, id, $('input', form).value)) { var again = document.querySelector('[data-focus-key="rx-input:' + kind + ':' + id + '"]'); if (again) again.focus(); }
    }, true);
    viewEl.addEventListener('input', function (e) {
      if (e.target.dataset.role !== 'rx-input') return;
      var id = idOf(e.target); if (id) ui.rxDraft[kind + ':' + id] = e.target.value;
    });
  }

  function renderDates() {
    var list = $('#date-list');
    if (!list) return;
    var html = '';
    if (ui.dateEdit === 'new') html += '<li class="datecard datecard--editing">' + dateFormHtml(null) + '</li>';
    if (!state.dates.length && ui.dateEdit !== 'new') {
      html += '<li class="datecard-empty">아직 택일 후보가 없습니다. ‘후보 추가’로 날짜를 등록하면 작명 노트의 이름과 연결할 수 있어요.</li>';
    }
datesSorted().forEach(function (d) {
      if (ui.dateEdit === d.id) { html += '<li class="datecard datecard--editing" data-date-id="' + escapeHtml(d.id) + '">' + dateFormHtml(d) + '</li>'; return; }
      var linked = namesForDate(d.id);
      html += '<li class="datecard' + (d.fav ? ' is-fav' : '') + '" data-date-id="' + escapeHtml(d.id) + '">';
      html += '<div class="datecard__head"><div class="datecard__meta"><button type="button" class="star" data-action="date-fav" data-focus-key="date-fav:' + escapeHtml(d.id) + '" aria-pressed="' + (d.fav ? 'true' : 'false') + '" aria-label="' + escapeHtml(dateHeadline(d)) + ' 즐겨찾기">' + (d.fav ? '★' : '☆') + '</button><span class="datecard__date">' + escapeHtml(dateHeadline(d)) + '</span>';
      if (d.label) html += '<span class="badge badge--label">' + escapeHtml(d.label) + '</span>';
      html += '</div><div class="datecard__actions">';
      html += '<button type="button" class="btn btn--small" data-action="edit-date" data-focus-key="date-edit:' + escapeHtml(d.id) + '">수정</button>';
      html += '<button type="button" class="btn btn--small btn--danger" data-action="delete-date">삭제</button></div></div>';
      if (d.memo) html += '<p class="datecard__memo">' + escapeHtml(d.memo) + '</p>';
      html += '<div class="linkrow"><span class="linkrow__label">연결된 이름</span>';
      if (linked.length) html += linked.map(function (n) { return '<span class="chip">' + escapeHtml(n.name) + (n.favorite ? ' ★' : '') + '</span>'; }).join('');
      else html += '<span class="linkrow__empty">없음 — 작명 노트에서 이름을 이 택일에 연결하세요</span>';
      html += '</div>' + rxHtml('date', d) + '</li>';
    });
    list.innerHTML = html;
    var addBtn = $('#add-date-btn');
    if (addBtn) addBtn.hidden = ui.dateEdit === 'new';
  }

  function readDateForm(form) {
    var date = form.elements.date.value;
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) date = '';
    return {
      date: date,
      time: form.elements.time.value.trim().slice(0, DATE_TIME_MAX),
      label: form.elements.label.value.trim().slice(0, DATE_LABEL_MAX),
      memo: form.elements.memo.value.replace(/\r\n?/g, '\n').trim().slice(0, DATE_MEMO_MAX)
    };
  }

  function submitDateForm(form) {
    var v = readDateForm(form);
    var err = $('[data-error]', form);
    if (!v.date) { err.textContent = '날짜를 선택하세요.'; err.hidden = false; var di = $('input[name="date"]', form); if (di) di.focus(); return; }
    var key = form.dataset.dateForm;
    if (key === 'new') {
      state.dates.push({ id: uid(), date: v.date, time: v.time, label: v.label, memo: v.memo, fav: false, likes: [], comments: [] });
      ui.dateEdit = null; commit(); act('date', '택일 후보 ‘' + (v.label || formatNoteDate(v.date)) + '’ 추가'); showToast('택일 후보를 저장했습니다.');
      var ab = $('#add-date-btn'); if (ab) ab.focus();
    } else {
      var d = findDate(key);
      if (!d) { ui.dateEdit = null; render(); return; }
      d.date = v.date; d.time = v.time; d.label = v.label; d.memo = v.memo;
      ui.dateEdit = null; commit(); act('date', '택일 후보 ‘' + (v.label || formatNoteDate(v.date)) + '’ 수정'); showToast('택일 후보를 수정했습니다.');
    }
  }

  function deleteDate(id) {
    var idx = -1; for (var i = 0; i < state.dates.length; i++) if (state.dates[i].id === id) idx = i;
    if (idx < 0) return;
    var d = state.dates[idx];
    var linked = namesForDate(id);
    var msg = '‘' + dateHeadline(d) + (d.label ? ' · ' + d.label : '') + '’ 택일 후보를 삭제할까요?' + (linked.length ? '\n연결된 이름 ' + linked.length + '개에서 이 택일 연결이 해제됩니다.' : '');
    if (!window.confirm(msg)) return;
    var affected = linked.map(function (n) { return n.id; });
    state.dates.splice(idx, 1);
    state.names.forEach(function (n) { n.dateIds = n.dateIds.filter(function (x) { return x !== id; }); });
    if (ui.dateEdit === id) ui.dateEdit = null;
    commit();
    act('date', '택일 후보 ‘' + (d.label || dateHeadline(d)) + '’ 삭제');
    showToast('택일 후보를 삭제했습니다.', function () {
      state.dates.splice(Math.min(idx, state.dates.length), 0, d);
      affected.forEach(function (nid) { var n = findName(nid); if (n && n.dateIds.indexOf(id) === -1) n.dateIds.push(id); });
      commit(); showToast('삭제를 취소했습니다.');
    });
  }

  /* ---- 작명 노트 ---- */
  function namesSorted() {
    return state.names.slice().sort(function (a, b) {
      if (!!a.favorite !== !!b.favorite) return a.favorite ? -1 : 1;
      return state.names.indexOf(a) - state.names.indexOf(b);
    });
  }

  function hanjaRowHtml(h) {
    h = h || { chars: '', meaning: '' };
    return '<div class="hanja-row">' +
      '<input type="text" class="hanja-row__chars" value="' + escapeHtml(h.chars) + '" maxlength="' + HANJA_CHARS_MAX + '" placeholder="한자 (예: 舒俊)" aria-label="한자">' +
      '<input type="text" class="hanja-row__meaning" value="' + escapeHtml(h.meaning) + '" maxlength="' + HANJA_MEANING_MAX + '" placeholder="풀이 (예: 舒 펼 서 · 俊 준걸 준)" aria-label="한자 풀이">' +
      '<button type="button" class="hanja-row__del" data-action="remove-hanja" aria-label="이 한자 후보 삭제">×</button></div>';
  }

  function nameFormHtml(n) {
    var isNew = !n;
    var id = isNew ? 'new' : escapeHtml(n.id);
    var hanja = isNew ? [{ chars: '', meaning: '' }] : (n.hanja.length ? n.hanja : [{ chars: '', meaning: '' }]);
    var h = '<form class="name-form" data-name-form="' + id + '">';
    h += '<div class="field"><label for="name-n-' + id + '">이름 (한글)</label>';
    h += '<input type="text" id="name-n-' + id + '" name="name" data-focus-key="name-n:' + id + '" value="' + escapeHtml(isNew ? '' : n.name) + '" maxlength="' + NAME_MAX + '" placeholder="예: 서준" required></div>';
    h += '<label class="chk"><input type="checkbox" name="favorite"' + (!isNew && n.favorite ? ' checked' : '') + '> 즐겨찾기 (★로 위에 고정)</label>';
    h += '<fieldset class="subfield"><legend>한자 풀이 후보</legend><div class="hanja-rows" data-hanja-rows>';
    h += hanja.map(hanjaRowHtml).join('');
    h += '</div><button type="button" class="btn btn--small" data-action="add-hanja">+ 한자 후보 추가</button></fieldset>';
    h += '<div class="field"><label for="name-m-' + id + '">메모 (선택)</label>';
    h += '<textarea id="name-m-' + id + '" name="memo" rows="3" maxlength="' + NAME_MEMO_MAX + '" placeholder="뜻·느낌·유래 등">' + escapeHtml(isNew ? '' : n.memo) + '</textarea></div>';
    h += '<fieldset class="subfield"><legend>연결할 택일 후보</legend>';
    if (state.dates.length) {
      h += '<div class="date-links">' + state.dates.map(function (d) {
        var checked = !isNew && n.dateIds.indexOf(d.id) !== -1;
        return '<label class="chk chk--chip"><input type="checkbox" name="dateId" value="' + escapeHtml(d.id) + '"' + (checked ? ' checked' : '') + '> ' + escapeHtml(dateHeadline(d) + (d.label ? ' · ' + d.label : '')) + '</label>';
      }).join('') + '</div>';
    } else {
      h += '<p class="subfield__hint">택일 탭에서 택일 후보를 먼저 추가하면 여기에서 연결할 수 있습니다.</p>';
    }
    h += '</fieldset>';
    h += '<p class="field-error" data-error hidden></p>';
    h += '<div class="note-form__actions"><button type="submit" class="btn btn--primary btn--small">' + (isNew ? '이름 저장' : '수정 저장') + '</button>';
    h += '<button type="button" class="btn btn--small" data-action="cancel-name">취소</button></div></form>';
    return h;
  }

  function renderNames() {
    var list = $('#name-list');
    if (!list) return;
    var html = '';
    if (ui.nameEdit === 'new') html += '<li class="namecard namecard--editing">' + nameFormHtml(null) + '</li>';
    if (!state.names.length && ui.nameEdit !== 'new') {
      html += '<li class="datecard-empty">아직 이름 후보가 없습니다. ‘이름 추가’로 한글 이름과 한자 풀이 후보를 적어 보세요.</li>';
    }
    namesSorted().forEach(function (n) {
      if (ui.nameEdit === n.id) { html += '<li class="namecard namecard--editing" data-name-id="' + escapeHtml(n.id) + '">' + nameFormHtml(n) + '</li>'; return; }
      html += '<li class="namecard' + (n.favorite ? ' is-fav' : '') + '" data-name-id="' + escapeHtml(n.id) + '">';
      html += '<div class="namecard__head">';
      html += '<button type="button" class="star" data-action="toggle-fav" aria-pressed="' + (n.favorite ? 'true' : 'false') + '" aria-label="' + escapeHtml(n.name) + ' 즐겨찾기">' + (n.favorite ? '★' : '☆') + '</button>';
      html += '<span class="namecard__name">' + escapeHtml(n.name) + '</span>';
      html += '<div class="namecard__actions"><button type="button" class="btn btn--small" data-action="edit-name" data-focus-key="name-edit:' + escapeHtml(n.id) + '">수정</button>';
      html += '<button type="button" class="btn btn--small btn--danger" data-action="delete-name">삭제</button></div></div>';
      if (n.hanja.length) {
        html += '<ul class="hanja-list">' + n.hanja.map(function (h) {
          return '<li class="hanja">' + (h.chars ? '<span class="hanja__chars">' + escapeHtml(h.chars) + '</span>' : '') + (h.meaning ? '<span class="hanja__meaning">' + escapeHtml(h.meaning) + '</span>' : '') + '</li>';
        }).join('') + '</ul>';
      }
      if (n.memo) html += '<p class="namecard__memo">' + escapeHtml(n.memo) + '</p>';
      html += '<div class="linkrow"><span class="linkrow__label">연결된 택일</span>';
      var linked = n.dateIds.map(findDate).filter(Boolean);
      if (linked.length) html += linked.map(function (d) { return '<span class="chip">' + escapeHtml(dateHeadline(d) + (d.label ? ' · ' + d.label : '')) + '</span>'; }).join('');
      else html += '<span class="linkrow__empty">없음</span>';
      html += '</div>' + rxHtml('name', n) + '</li>';
    });
    list.innerHTML = html;
    var addBtn = $('#add-name-btn');
    if (addBtn) addBtn.hidden = ui.nameEdit === 'new';
  }

  function readNameForm(form) {
    var hanja = [];
    Array.prototype.forEach.call(form.querySelectorAll('.hanja-row'), function (row) {
      var chars = row.querySelector('.hanja-row__chars').value.trim().slice(0, HANJA_CHARS_MAX);
      var meaning = row.querySelector('.hanja-row__meaning').value.trim().slice(0, HANJA_MEANING_MAX);
      if (chars || meaning) hanja.push({ id: uid(), chars: chars, meaning: meaning });
    });
    var dateIds = [];
    Array.prototype.forEach.call(form.querySelectorAll('input[name="dateId"]:checked'), function (cb) {
      if (findDate(cb.value)) dateIds.push(cb.value);
    });
    return { name: form.elements.name.value.trim().slice(0, NAME_MAX), favorite: form.elements.favorite.checked, memo: form.elements.memo.value.replace(/\r\n?/g, '\n').trim().slice(0, NAME_MEMO_MAX), hanja: hanja, dateIds: dateIds };
  }

  function submitNameForm(form) {
    var v = readNameForm(form);
    var err = $('[data-error]', form);
    if (!v.name) { err.textContent = '한글 이름을 입력하세요.'; err.hidden = false; form.elements.name.focus(); return; }
    var key = form.dataset.nameForm;
    if (key === 'new') {
      state.names.push({ id: uid(), name: v.name, favorite: v.favorite, memo: v.memo, hanja: v.hanja, dateIds: v.dateIds, likes: [], comments: [] });
      ui.nameEdit = null; commit(); act('name', '이름 후보 ‘' + v.name + '’ 추가'); showToast('이름 후보를 저장했습니다.');
      var ab = $('#add-name-btn'); if (ab) ab.focus();
    } else {
      var n = findName(key);
      if (!n) { ui.nameEdit = null; render(); return; }
      n.name = v.name; n.favorite = v.favorite; n.memo = v.memo; n.hanja = v.hanja; n.dateIds = v.dateIds;
      ui.nameEdit = null; commit(); act('name', '이름 후보 ‘' + v.name + '’ 수정'); showToast('이름 후보를 수정했습니다.');
    }
  }

  function toggleNameFav(id) {
    var n = findName(id); if (!n) return;
    n.favorite = !n.favorite; commit();
    act('name', '이름 후보 ‘' + n.name + '’ ' + (n.favorite ? '★ 즐겨찾기' : '즐겨찾기 해제'));
  }

  function deleteName(id) {
    var idx = -1; for (var i = 0; i < state.names.length; i++) if (state.names[i].id === id) idx = i;
    if (idx < 0) return;
    var n = state.names[idx];
    if (!window.confirm('‘' + n.name + '’ 이름 후보를 삭제할까요?')) return;
    state.names.splice(idx, 1);
    if (ui.nameEdit === id) ui.nameEdit = null;
    commit();
    act('name', '이름 후보 ‘' + n.name + '’ 삭제');
    showToast('이름 후보를 삭제했습니다.', function () {
      state.names.splice(Math.min(idx, state.names.length), 0, n);
      commit(); showToast('삭제를 취소했습니다.');
    });
  }

  /* ---------- 홈 (개요) ---------- */
  /* ---------- 선 아이콘 ---------- */
  var SVG_PATHS = {
    bag: '<rect x="3" y="7" width="18" height="13" rx="2.5"/><path d="M8 7V5.5A2.5 2.5 0 0 1 10.5 3h3A2.5 2.5 0 0 1 16 5.5V7"/><path d="M9 13.5l2 2 4-4"/>',
    wallet: '<path d="M17 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v2"/><rect x="3" y="7" width="18" height="13" rx="2.5"/><path d="M21 11h-4a2 2 0 0 0 0 4h4"/>',
    clinic: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1M12 9v6M9 12h6"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2.5"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    gov: '<path d="M3 21h18M5 21V10M19 21V10M9.5 21V10M14.5 21V10M2.5 10L12 4l9.5 6z"/>',
    pen: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13 7l4 4"/>',
    syringe: '<path d="M17 3l4 4M19 5l-9.5 9.5M14 4l6 6M11 8l5 5M7.5 12.5l4 4L8 20H4v-4z"/>',
    growth: '<path d="M3 20h18M5 16l4-5 4 3 6-8"/>',
    book: '<path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z"/><path d="M5 17a3 3 0 0 1 3-3h11"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    suitcase: '<rect x="5" y="7" width="14" height="12" rx="2"/><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M9 11v4M15 11v4M8 19v1.5M16 19v1.5"/>',
    bed: '<path d="M3 18V7M3 14h18v4M21 14v-2a3 3 0 0 0-3-3h-7v5"/><circle cx="7" cy="11" r="2"/>',
    bottle: '<path d="M10 3h4v3h-4z"/><path d="M8.5 9a2.5 2.5 0 0 1 2-3h3a2.5 2.5 0 0 1 2 3v10a2 2 0 0 1-2 2h-3a2 2 0 0 1-2-2z"/><path d="M8.5 13h3M8.5 16h3"/>',
    box: '<path d="M3 8l9-5 9 5v8l-9 5-9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>',
    shirt: '<path d="M8 3L3 6l2 4 2-1v12h10V9l2 1 2-4-5-3c-.5 1.5-2 2.5-4 2.5S8.5 4.5 8 3z"/>',
    baby: '<circle cx="12" cy="13" r="8"/><path d="M11 5c1-1.5 3-1.3 3.3.2M9.5 12.5h.01M14.5 12.5h.01M10 16c1.2.8 2.8.8 4 0"/>',
    toy: '<circle cx="12" cy="13" r="6"/><circle cx="7" cy="7" r="2.5"/><circle cx="17" cy="7" r="2.5"/><path d="M10 12.5h.01M14 12.5h.01M11 15.5h2"/>',
    doc: '<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4M10 12h5M10 16h5"/>',
    sparkle: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/>',
    back: '<path d="M15 18l-6-6 6-6"/>',
    next: '<path d="M9 6l6 6-6 6"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    settings: '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>'
  };
  function svgIcon(name, size) {
    var s = size || 24;
    return '<svg class="ico" width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + SVG_PATHS[name] + '</svg>';
  }

  /* ---------- 마미백 홈: 출산 · 육아 아이콘 묶음 ---------- */
  // 분류 타일은 이모지 대신 선 아이콘: 이름 → 이모지 → 기본(가방) 순으로 고른다
  var CAT_ICON_RULES = [
    [/병원|캐리어|출산\s*가방|입원/, 'suitcase'], [/조리원|산후/, 'bed'], [/수유|젖병|분유/, 'bottle'],
    [/옷|의류|내의|배냇/, 'shirt'], [/장난감|놀이|인형/, 'toy'], [/서류|문서|증명/, 'doc'],
    [/아기|축복|육아|신생아|베이비|맞이/, 'baby'], [/기타|그\s*외|잡화/, 'box']
  ];
  var EMOJI_ICON = { '🧳': 'suitcase', '🛏️': 'bed', '🛏': 'bed', '👶🏻': 'baby', '👶': 'baby', '🤱🏻': 'bottle', '🤱': 'bottle', '🍼': 'bottle', '🧸': 'toy', '🏥': 'clinic', '🎒': 'bag', '🧴': 'bottle', '👕': 'shirt', '📄': 'doc', '✨': 'sparkle' };
  function categoryIcon(cat) {
    for (var i = 0; i < CAT_ICON_RULES.length; i++) if (CAT_ICON_RULES[i][0].test(cat.name)) return CAT_ICON_RULES[i][1];
    return EMOJI_ICON[cat.icon] || 'bag';
  }
  var MB_FIXED = {
    birth: [
      { label: '산부인과 일지', icon: 'clinic', view: 'notes' },
      { label: '택일·작명', icon: 'calendar', view: 'plan' },
      { label: '정부 지원', icon: 'gov', view: 'supports' }
    ],
    baby: [
      { label: '예방접종', icon: 'syringe' },
      { label: '성장 기록', icon: 'growth' },
      { label: '육아 일지', icon: 'book' }
    ]
  };
  function fixedTileMeta(view) {
    if (view === 'notes') return state.notes.length ? state.notes.length + '개' : '';
    if (view === 'picks') return state.dates.length ? '후보 ' + state.dates.length : '';
    if (view === 'plan') { var parts = []; if (state.dates.length) parts.push('택일 ' + state.dates.length); if (state.names.length) parts.push('이름 ' + state.names.length); return parts.join(' · '); }
    if (view === 'supports') return state.supports.length ? state.supports.filter(function (x) { return x.status === 'applied' || x.status === 'received'; }).length + '/' + state.supports.length : '';
    if (view === 'names') return state.names.length ? '후보 ' + state.names.length : '';
    return '';
  }
  function renderHome() {
    GROUPS.forEach(function (g) {
      var grid = $('#mb-' + g);
      if (!grid) return;
      var cats = state.categories.filter(function (c) { return c.group === g; });
      var ids = {}; cats.forEach(function (c) { ids[c.id] = true; });
      var p = computeProgress(state.items.filter(function (it) { return ids[it.categoryId]; }));
      var sum = $('#mb-' + g + '-sum');
      if (sum) sum.textContent = p.total ? '준비물 ' + p.done + '/' + p.total : '';
      var html = cats.map(function (cat) {
        var cp = computeProgress(itemsOf(cat.id));
        return '<button type="button" class="mb-tile" data-action="go-category" data-category-id="' + escapeHtml(cat.id) + '">' +
          '<span class="mb-tile__icon mb-tile__icon--solid">' + svgIcon(categoryIcon(cat), 28) + '</span>' +
          '<span class="mb-tile__label">' + escapeHtml(cat.name) + '</span>' +
          '<span class="mb-tile__meta">' + (cp.total ? cp.done + '/' + cp.total : '비어 있음') + '</span></button>';
      }).join('');
      html += MB_FIXED[g].map(function (f) {
        var meta = f.view ? fixedTileMeta(f.view) : '준비 중';
        return '<button type="button" class="mb-tile' + (f.view ? '' : ' is-soon') + '" data-action="' + (f.view ? 'mb-open' : 'mb-soon') + '"' + (f.view ? ' data-target="' + f.view + '"' : '') + ' data-label="' + escapeHtml(f.label) + '">' +
          '<span class="mb-tile__icon">' + svgIcon(f.icon, 28) + '</span>' +
          '<span class="mb-tile__label">' + escapeHtml(f.label) + '</span>' +
          '<span class="mb-tile__meta">' + escapeHtml(meta) + '</span></button>';
      }).join('');
      grid.innerHTML = html;
    });
  }

  /* ---------- luckybbu 포털: 디데이 두 개 ---------- */
  var WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
  function dateOf(iso) { var p = iso.split('-'); return new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1, parseInt(p[2], 10)); }
  function todayDate() { var n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); }
  function daysFromToday(iso) { return Math.round((dateOf(iso) - todayDate()) / 86400000); }
  function shortDate(iso) { var d = dateOf(iso); return (d.getMonth() + 1) + '월 ' + d.getDate() + '일 (' + WEEKDAYS[d.getDay()] + ')'; }
  // 결혼한 날을 1일로 센다
  function marriedDays() { return state.anniversary ? 1 - daysFromToday(state.anniversary) : 0; }
  function nextMilestone(a) {
    var w = dateOf(state.anniversary), today = todayDate();
    // 그해의 결혼기념일 (2월 29일은 평년에 2월 28일로)
    var inYear = function (y) { var d = new Date(y, w.getMonth(), w.getDate()); return d.getMonth() !== w.getMonth() ? new Date(y, w.getMonth() + 1, 0) : d; };
    var years = today.getFullYear() - w.getFullYear();
    if (years > 0 && inYear(today.getFullYear()).getTime() === today.getTime()) return '오늘 ' + years + '주년이에요';
    if (a % 100 === 0) return '오늘 ' + formatNumber(a) + '일이에요';
    var next = inYear(today.getFullYear());
    if (next <= today) next = inYear(today.getFullYear() + 1);
    var toYear = Math.round((next - today) / 86400000);
    var hundred = (Math.floor(a / 100) + 1) * 100, toHundred = hundred - a;
    if (toYear < toHundred) return (next.getFullYear() - w.getFullYear()) + '주년까지 ' + toYear + '일';
    return formatNumber(hundred) + '일까지 ' + toHundred + '일';
  }
  var HEART_SVG = '<svg class="dday__heart" width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 21s-7.5-4.6-9.5-9.3C1.1 8.3 3.2 4.5 6.8 4.5c2.1 0 3.6 1.1 5.2 3 1.6-1.9 3.1-3 5.2-3 3.6 0 5.7 3.8 4.3 7.2C19.5 16.4 12 21 12 21z"/></svg>';
  // 디데이 카드: 글자 + 그림, 아래에 타임라인 (시안 ①)
  var BABY_ART = '<svg class="dcard__art" width="84" height="84" viewBox="0 0 96 96" aria-hidden="true"><circle cx="48" cy="50" r="34" fill="#FFE3D6"/><path d="M44 17c4-4 10-3 11 2" fill="none" stroke="#C9A58F" stroke-width="3" stroke-linecap="round"/><path d="M36 50c2 3 6 3 8 0M52 50c2 3 6 3 8 0" fill="none" stroke="#6B5A55" stroke-width="2.6" stroke-linecap="round"/><circle cx="33" cy="60" r="5" fill="#FFB8C6" opacity="0.8"/><circle cx="63" cy="60" r="5" fill="#FFB8C6" opacity="0.8"/><path d="M44 64c2.5 2 5.5 2 8 0" fill="none" stroke="#6B5A55" stroke-width="2.4" stroke-linecap="round"/><circle cx="78" cy="22" r="4" fill="#C9B8FF"/><circle cx="16" cy="30" r="3" fill="#C9B8FF"/></svg>';
  var RINGS_ART = '<svg class="dcard__art" width="84" height="84" viewBox="0 0 96 96" aria-hidden="true"><circle cx="38" cy="56" r="20" fill="none" stroke="#F4B7C9" stroke-width="7"/><circle cx="58" cy="56" r="20" fill="none" stroke="#FFD27F" stroke-width="7"/><path d="M48 31c-5-6-15-3-12 5 2 5 12 10 12 10s10-5 12-10c3-8-7-11-12-5z" fill="#FF7FA6"/></svg>';
  function md(d) { return (d.getMonth() + 1) + '/' + d.getDate(); }
  function addDays(d, n) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); }
  // 오늘부터 그날까지 주 단위 점 (너무 멀면 몇 주씩 건너뛴다)
  function weekTrackHtml(daysLeft) {
    var today = todayDate(), weeks = Math.ceil(daysLeft / 7), step = weeks > 6 ? Math.ceil(weeks / 5) : 1;
    var pts = [{ label: '오늘', edge: true }];
    for (var k = step; k * 7 < daysLeft; k += step) pts.push({ label: md(addDays(today, k * 7)) });
    pts.push({ label: md(addDays(today, daysLeft)), edge: true });
    return '<div class="dtrack dtrack--weeks" role="img" aria-label="오늘부터 ' + escapeHtml(pts[pts.length - 1].label) + '까지 ' + (step === 1 ? '한 주' : step + '주') + '씩">' +
      pts.map(function (p, i) { return '<span class="dtrack__pt' + (i === 0 ? ' is-now' : p.edge ? ' is-end' : '') + '"><i></i>' + (p.edge ? '<b>' + p.label + '</b>' : p.label) + '</span>'; }).join('') + '</div>';
  }
  // 기념일 점: start일째 ~ end일째 구간에 이정표를 놓고 오늘(now일째) 위치를 표시
  function mileTrackHtml(start, end, now, miles, nowLabel) {
    var pos = function (n) { return Math.max(0, Math.min(100, (n - start) / (end - start) * 100)); };
    return '<div class="dtrack dtrack--miles" role="img" aria-label="' + escapeHtml(miles.map(function (m) { return m.label + (m.n <= now ? ' 지남' : ''); }).join(', ')) + '">' +
      '<span class="dtrack__line"></span><span class="dtrack__fill" style="width:' + pos(now).toFixed(1) + '%"></span>' +
      miles.map(function (m) { return '<span class="dtrack__mile' + (m.n <= now ? ' is-done' : '') + '" style="left:' + pos(m.n).toFixed(1) + '%"><i></i><b>' + escapeHtml(m.label) + '</b>' + escapeHtml(m.date) + '</span>'; }).join('') +
      '<span class="dtrack__now" style="left:' + pos(now).toFixed(1) + '%">' + escapeHtml(nowLabel || '오늘') + '</span></div>';
  }
  // 함께한 날(첫날 = 1일)의 이정표: 지난 기념일(또는 첫날) ~ 다음 기념일 사이, 100일 단위 포함
  function dayMilestones(startIso, n, firstLabel, yearLabel) {
    var w = dateOf(startIso);
    var inYear = function (y) { var d = new Date(y, w.getMonth(), w.getDate()); return d.getMonth() !== w.getMonth() ? new Date(y, w.getMonth() + 1, 0) : d; };
    var dayOf = function (d) { return Math.round((d - w) / 86400000) + 1; };
    var years = 0; while (dayOf(inYear(w.getFullYear() + years + 1)) <= n) years++;
    var from = years ? dayOf(inYear(w.getFullYear() + years)) : 1, to = dayOf(inYear(w.getFullYear() + years + 1));
    var miles = [{ n: from, label: years ? yearLabel(years) : firstLabel, date: md(addDays(w, from - 1)) }];
    for (var h = Math.ceil((from + 1) / 100) * 100; h < to; h += 100) if (h - from >= 30 && to - h >= 30) miles.push({ n: h, label: formatNumber(h) + '일', date: md(addDays(w, h - 1)) });
    miles.push({ n: to, label: yearLabel(years + 1), date: md(addDays(w, to - 1)) });
    return { start: from, end: to, miles: miles };
  }
  // 축복이 만나기까지: 임신 시작(예정일 280일 전)부터 예정일까지 채워지는 진행 바. 날이 지날 때마다 '오늘'이 오른쪽으로 간다.
  function pregnancyTrackHtml(daysLeft) {
    // 남은 일정 위주: 막달 구간(30주→출산)만 보여 주고, 아직 30주 전이면 20주→출산 구간. 날이 지날수록 '오늘'이 오른쪽으로 간다.
    var total = 280, now = total - daysLeft;
    var due = dateOf(state.dueDate), start0 = addDays(due, -total);
    var fromWeek = daysLeft > 70 ? 20 : 30;
    var mark = function (week, label) { var n = week * 7; return { n: n, label: label || (week + '주'), date: md(addDays(start0, n)) }; };
    var miles = fromWeek === 30 ? [mark(30), mark(34), mark(37, '만삭'), mark(40, '출산 예정')] : [mark(20), mark(28), mark(34), mark(40, '출산 예정')];
    var w = Math.floor(Math.max(0, now) / 7), dd = Math.max(0, now) % 7;
    var nowLabel = now < fromWeek * 7 ? '오늘' : '오늘 ' + w + '주' + (dd ? ' ' + dd + '일' : '');
    return mileTrackHtml(fromWeek * 7, total, Math.max(fromWeek * 7, now), miles, nowLabel);
  }
  function weeksLeftText(d) {
    var wk = Math.floor(d / 7), dd = d % 7;
    if (!wk) return d + '일 남았어요';
    return dd ? wk + '주 ' + dd + '일 남았어요' : '딱 ' + wk + '주 남았어요';
  }
  function dcardHtml(kind, label, num, sub, art, track) {
    return '<section class="dcard dcard--' + kind + '"><div class="dcard__top"><div class="dcard__text"><p class="dcard__label">' + label + '</p><p class="dcard__num">' + num + '</p><p class="dcard__sub">' + escapeHtml(sub) + '</p></div>' + art + '</div>' +
      (track ? '<div class="dcard__track">' + track + '</div>' : '') + '</section>';
  }
  function renderPortal() {
    var box = $('#portal-ddays');
    if (!box) return;
    var html = '';
    if (state.dueDate) {
      var d = daysFromToday(state.dueDate);
      if (d > 0) html += dcardHtml('baby', '축복이 만나기까지', escapeHtml(ddayText(state.dueDate)), shortDate(state.dueDate) + ' · ' + weeksLeftText(d), BABY_ART, pregnancyTrackHtml(d));
      else if (d === 0) html += dcardHtml('baby', '오늘 축복이를 만나요', 'D-Day', shortDate(state.dueDate), BABY_ART, '');
      else {
        var born = 1 - d, bm = dayMilestones(state.dueDate, born, '탄생', function (y) { return y === 1 ? '돌' : y + '번째 생일'; });
        html += dcardHtml('baby', '축복이와 만난 지', '+' + formatNumber(born) + '<span class="dcard__unit">일</span>', formatNoteDate(state.dueDate) + '부터', BABY_ART, mileTrackHtml(bm.start, bm.end, born, bm.miles));
      }
    } else {
      html += '<button type="button" class="dday-empty" data-action="open-settings">출산 예정일을 넣으면 축복이 D-day가 보여요</button>';
    }
    if (state.anniversary) {
      var a = marriedDays();
      if (a >= 1) {
        var am = dayMilestones(state.anniversary, a, '결혼', function (y) { return y + '주년'; });
        html += dcardHtml('love', HEART_SVG + '우리 결혼한 지', '+' + formatNumber(a) + '<span class="dcard__unit">일</span>', formatNoteDate(state.anniversary) + '부터 · ' + nextMilestone(a), RINGS_ART, mileTrackHtml(am.start, am.end, a, am.miles));
      } else {
        html += dcardHtml('love', HEART_SVG + '결혼식까지', 'D-' + (1 - a), shortDate(state.anniversary), RINGS_ART, weekTrackHtml(1 - a));
      }
    } else {
      html += '<button type="button" class="dday-empty" data-action="open-settings">결혼기념일을 넣으면 함께한 날이 보여요</button>';
    }
    box.innerHTML = html;
  }

  // 처음 한 번: 비어 있는 날짜에 우리 가족 날짜를 채운다(이미 적힌 값은 건드리지 않음)
  var FAMILY_DUE = '2026-11-09', FAMILY_ANNIVERSARY = '2026-05-23';
  function seedFamilyDatesOnce() {
    if (ui.portalSeeded) return;
    ui.portalSeeded = true;
    saveUiPrefs();
    var changed = false;
    if (!state.anniversary) { state.anniversary = FAMILY_ANNIVERSARY; changed = true; }
    if (!state.dueDate) { state.dueDate = FAMILY_DUE; changed = true; }
    if (changed) commit();
  }

  /* ---------- 가계부 ---------- */
  var LEDGER_COLORS = { '식비': '#7FD6AE', '생활': '#8DB9FF', '육아·출산': '#FFA48C', '교통': '#FFD966', '의료': '#C9B8FF', '쇼핑': '#FFB3C8', '기타': '#D9DEDB', '급여': '#7FD6AE', '부수입': '#8DB9FF' };
  var LEDGER_WHO = TAG_NAMES.slice(0, 2);
  function currentMonth() { return todayStamp().slice(0, 7); }
  function ledgerMonth() { return /^\d{4}-\d{2}$/.test(ui.ledgerMonth) ? ui.ledgerMonth : currentMonth(); }
  function shiftMonth(m, by) {
    var d = new Date(parseInt(m.slice(0, 4), 10), parseInt(m.slice(5, 7), 10) - 1 + by, 1);
    return d.getFullYear() + '-' + (d.getMonth() < 9 ? '0' : '') + (d.getMonth() + 1);
  }
  function monthLabel(m) { return m.slice(0, 4) + '년 ' + parseInt(m.slice(5, 7), 10) + '월'; }
  function findEntry(id) { for (var i = 0; i < state.ledger.length; i++) if (state.ledger[i].id === id) return state.ledger[i]; return null; }
  function signedWon(e) { return (e.type === 'in' ? '+' : '−') + formatNumber(e.amount); }
  function entriesOfMonth(m) {
    return state.ledger.filter(function (e) { return e.date.slice(0, 7) === m; })
      .sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : (b.t || 0) - (a.t || 0); });
  }
  function renderLedger() {
    var root = $('#ledger-root');
    if (!root) return;
    var m = ledgerMonth(), mo = parseInt(m.slice(5, 7), 10);
    var list = entriesOfMonth(m);
    var out = 0, inn = 0, byCat = {};
    list.forEach(function (e) {
      if (e.type === 'in') inn += e.amount;
      else { out += e.amount; byCat[e.cat] = (byCat[e.cat] || 0) + e.amount; }
    });
    var html = '<div class="ledger-month">' +
      '<button type="button" class="icon-btn" data-action="ledger-month" data-by="-1" aria-label="이전 달">' + svgIcon('back', 18) + '</button>' +
      '<h2 class="ledger-month__label" aria-live="polite">' + monthLabel(m) + '</h2>' +
      '<button type="button" class="icon-btn" data-action="ledger-month" data-by="1" aria-label="다음 달">' + svgIcon('next', 18) + '</button>' +
      (m !== currentMonth() ? '<button type="button" class="btn btn--small ledger-month__today" data-action="ledger-month" data-by="0">이번 달</button>' : '') + '</div>';

    html += '<section class="ledger-sum" aria-labelledby="ledger-sum-title">' +
      '<h3 class="ledger-sum__label" id="ledger-sum-title">' + mo + '월 지출</h3>' +
      '<p class="ledger-sum__num">' + formatNumber(out) + '원</p>';
    if (ui.budgetEdit) {
      html += '<form class="ledger-budget-form" data-action="ledger-budget"><label for="ledger-budget-input">한 달 예산</label>' +
        '<input type="text" id="ledger-budget-input" inputmode="numeric" autocomplete="off" data-price-input value="' + (state.budget ? formatNumber(state.budget) : '') + '" placeholder="예: 2,000,000">' +
        '<button type="submit" class="btn btn--primary btn--small">저장</button>' +
        (state.budget ? '<button type="button" class="btn btn--small" data-action="ledger-budget-clear">예산 없애기</button>' : '') +
        '<button type="button" class="btn btn--small" data-action="ledger-budget-cancel">취소</button></form>';
    } else if (state.budget) {
      var pct = Math.round(out / state.budget * 100), left = state.budget - out;
      html += '<div class="ledger-bar" role="progressbar" aria-label="예산 사용" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + Math.min(100, pct) + '"><span style="width:' + Math.min(100, pct) + '%"' + (left < 0 ? ' class="is-over"' : '') + '></span></div>' +
        '<p class="ledger-sum__budget">예산 ' + formatNumber(state.budget) + '원 중 ' + pct + '% · ' + (left >= 0 ? '남은 예산 <strong>' + formatNumber(left) + '원</strong>' : '<strong>' + formatNumber(-left) + '원</strong> 넘었어요') +
        ' <button type="button" class="link-btn" data-action="ledger-budget-edit">예산 수정</button></p>';
    } else {
      html += '<p class="ledger-sum__budget"><button type="button" class="link-btn" data-action="ledger-budget-edit">한 달 예산 정하기</button></p>';
    }
    var net = inn - out;
    html += '<div class="ledger-sum__row"><div><span>수입</span><strong>' + formatNumber(inn) + '원</strong></div>' +
      '<div><span>수입 − 지출</span><strong>' + (net > 0 ? '+' : net < 0 ? '−' : '') + formatNumber(Math.abs(net)) + '원</strong></div></div></section>';

    if (out > 0) {
      var cats = Object.keys(byCat).sort(function (a, b) { return byCat[b] - byCat[a]; });
      html += '<section class="ledger-card" aria-labelledby="ledger-cat-title"><h3 class="ledger-card__title" id="ledger-cat-title">분류별 지출</h3>' +
        '<div class="ledger-stack" role="img" aria-label="' + escapeHtml(cats.map(function (c) { return c + ' ' + Math.round(byCat[c] / out * 100) + '%'; }).join(', ')) + '">' +
        cats.map(function (c) { return '<span style="width:' + (byCat[c] / out * 100) + '%;background:' + LEDGER_COLORS[c] + '"></span>'; }).join('') + '</div>' +
        '<ul class="ledger-legend">' + cats.map(function (c) {
          return '<li><span class="ledger-legend__dot" style="background:' + LEDGER_COLORS[c] + '"></span><span class="ledger-legend__name">' + escapeHtml(c) + '</span><strong>' + formatNumber(byCat[c]) + '</strong></li>';
        }).join('') + '</ul></section>';
    }

    html += '<section class="ledger-card" aria-labelledby="ledger-list-title"><h3 class="ledger-card__title" id="ledger-list-title">내역 <span class="notes__count">' + (list.length ? list.length + '건' : '') + '</span></h3>';
    if (!list.length) {
      html += '<p class="ledger-empty">' + (state.ledger.length ? mo + '월에는 기록이 없어요.' : '아직 기록이 없어요. 아래 ‘기록’을 눌러 첫 지출이나 수입을 적어 보세요.') + '</p>';
    } else {
      var day = '';
      list.forEach(function (e) {
        if (e.date !== day) {
          if (day) html += '</ul>';
          day = e.date;
          var dayOut = 0; list.forEach(function (x) { if (x.date === day && x.type === 'out') dayOut += x.amount; });
          html += '<p class="ledger-day">' + escapeHtml(shortDate(day)) + (dayOut ? '<span>−' + formatNumber(dayOut) + '원</span>' : '') + '</p><ul class="ledger-list">';
        }
        var meta = [e.who, LEDGER_PAYS[e.pay] || ''].filter(Boolean).join(' · ');
        html += '<li><button type="button" class="ledger-row" data-action="ledger-edit" data-id="' + escapeHtml(e.id) + '" data-focus-key="ledger:' + escapeHtml(e.id) + '">' +
          '<span class="ledger-row__cat" style="background:' + LEDGER_COLORS[e.cat] + '">' + escapeHtml(e.cat.replace('·출산', '')) + '</span>' +
          '<span class="ledger-row__body"><span class="ledger-row__text">' + escapeHtml(e.text || e.cat) + '</span>' + (meta ? '<span class="ledger-row__meta">' + escapeHtml(meta) + '</span>' : '') + '</span>' +
          '<span class="ledger-row__amt' + (e.type === 'in' ? ' is-in' : '') + '">' + signedWon(e) + '</span></button></li>';
      });
      html += '</ul>';
    }
    html += '</section>';
    root.innerHTML = html;
    renderLedgerSheet();
  }

  function ledgerChips(name, options, selected) {
    return options.map(function (o) {
      var val = typeof o === 'string' ? o : o.value, label = typeof o === 'string' ? o : o.label;
      return '<label class="choice"><input type="radio" name="' + name + '" value="' + escapeHtml(val) + '"' + (val === selected ? ' checked' : '') + '><span>' + escapeHtml(label) + '</span></label>';
    }).join('');
  }
  function renderLedgerSheet() {
    var sheet = $('#ledger-sheet');
    if (!sheet) return;
    var open = ui.view === 'ledger' && !!ui.ledgerForm;
    document.body.classList.toggle('has-sheet', open);
    // 시트가 열린 동안 뒤 화면은 탭·스크린리더가 닿지 않게 한다
    ['.app-header', '#ledger-root', '#ledger-fab'].forEach(function (sel) { var n = $(sel); if (n) { if (open) n.setAttribute('inert', ''); else n.removeAttribute('inert'); } });
    if (!open) { sheet.hidden = true; sheet.innerHTML = ''; return; }
    if (!sheet.hidden && sheet.dataset.form === ui.ledgerForm) return; // 이미 열린 폼은 입력 중인 값을 지키려고 다시 그리지 않는다
    var e = ui.ledgerForm === 'new' ? null : findEntry(ui.ledgerForm);
    var type = e ? e.type : ui.ledgerType;
    var me = myName();
    var who = e ? e.who : (LEDGER_WHO.indexOf(me) !== -1 ? me : '');
    var m = ledgerMonth();
    var date = e ? e.date : (m === currentMonth() ? todayStamp() : m + '-01');
    sheet.dataset.form = ui.ledgerForm;
    sheet.innerHTML = '<div class="sheet__backdrop" data-action="ledger-close"></div>' +
      '<form class="sheet__panel" id="ledger-form" role="dialog" aria-modal="true" aria-labelledby="ledger-form-title" novalidate>' +
      '<span class="sheet__handle" aria-hidden="true"></span>' +
      '<div class="sheet__head"><h2 id="ledger-form-title" tabindex="-1">' + (e ? '기록 수정' : '기록 추가') + '</h2>' +
      '<button type="button" class="icon-btn" data-action="ledger-close" aria-label="닫기">' + svgIcon('close', 20) + '</button></div>' +
      '<div class="seg" role="radiogroup" aria-label="종류">' + ledgerChips('type', [{ value: 'out', label: '지출' }, { value: 'in', label: '수입' }], type) + '</div>' +
      '<div class="field"><label for="ledger-text">내용</label><input type="text" id="ledger-text" maxlength="' + LEDGER_TEXT_MAX + '" autocomplete="off" value="' + escapeHtml(e ? e.text : '') + '" placeholder="예: 점심 국밥 9천원"></div>' +
      '<div class="field"><label for="ledger-amount">금액</label><input type="text" id="ledger-amount" inputmode="numeric" autocomplete="off" data-price-input value="' + (e ? formatNumber(e.amount) : '') + '" placeholder="내용에 ‘9천원’처럼 적어도 돼요"></div>' +
      '<fieldset class="chips-field"><legend>분류</legend><div class="choices" id="ledger-cat-chips">' + ledgerChips('cat', type === 'in' ? LEDGER_IN_CATS : LEDGER_OUT_CATS, e ? e.cat : (type === 'in' ? '급여' : '식비')) + '</div></fieldset>' +
      '<div class="sheet__two"><fieldset class="chips-field"><legend>누가</legend><div class="choices">' + ledgerChips('who', LEDGER_WHO.concat([{ value: '', label: '함께' }]), who) + '</div></fieldset>' +
      '<fieldset class="chips-field"><legend>결제</legend><div class="choices">' + ledgerChips('pay', Object.keys(LEDGER_PAYS).map(function (k) { return { value: k, label: LEDGER_PAYS[k] }; }), e ? e.pay : 'card') + '</div></fieldset></div>' +
      '<div class="field"><label for="ledger-date">날짜</label><input type="date" id="ledger-date" value="' + date + '" required></div>' +
      '<div class="sheet__actions"><button type="submit" class="btn btn--primary">저장</button>' +
      (e ? '<button type="button" class="btn btn--danger" data-action="ledger-delete">삭제</button>' : '') + '</div></form>';
    sheet.hidden = false;
    // 새 기록은 바로 입력하도록 내용 칸에, 수정은 키보드가 먼저 뜨지 않게 제목에 초점을 둔다
    var first = e ? $('#ledger-form-title') : $('#ledger-text');
    if (first) first.focus({ preventScroll: true });
  }
  function openLedgerForm(id) {
    ui.ledgerForm = id || 'new';
    if (!id) ui.ledgerType = 'out';
    // 뒤로 가기(안드로이드 버튼·스와이프)로 입력 창만 닫히도록 기록을 하나 쌓는다
    try { window.history.pushState({ view: 'ledger', sheet: true }, ''); } catch (e) { /* ignore */ }
    renderLedgerSheet();
  }
  // 저장·삭제·닫기 뒤에 시트용 기록을 걷어낸다 → 다음 뒤로 가기가 바로 이전 화면으로 간다
  function dropSheetHistory() {
    if (window.history.state && window.history.state.sheet) { sheetPopSilently = true; window.history.back(); }
  }
  var sheetPopSilently = false;
  function closeLedgerForm(fromHistory) {
    var back = ui.ledgerForm && ui.ledgerForm !== 'new' ? ui.ledgerForm : null;
    ui.ledgerForm = null;
    if (!fromHistory) dropSheetHistory();
    renderLedgerSheet();
    var target = back ? document.querySelector('[data-focus-key="ledger:' + back + '"]') : $('#ledger-fab');
    if (target) target.focus({ preventScroll: true });
  }
  function submitLedgerForm(form) {
    var val = function (name) { var c = form.querySelector('input[name="' + name + '"]:checked'); return c ? c.value : ''; };
    var text = $('#ledger-text').value.trim();
    var amountEl = $('#ledger-amount');
    var pp = parsePrice(amountEl.value);
    if (!pp.ok) { showToast('금액은 숫자로 적어 주세요. 예: 9000, 9천원'); amountEl.focus(); return; }
    var amount = pp.value;
    if (amount === null && text) {
      var line = parseItemLine(text);
      if (line && line.price) { amount = line.price; text = line.name; }
    }
    if (!amount) { showToast('금액을 입력하세요.'); amountEl.focus(); return; }
    var date = $('#ledger-date').value;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { showToast('날짜를 골라 주세요.'); $('#ledger-date').focus(); return; }
    var type = val('type') === 'in' ? 'in' : 'out';
    var cats = type === 'in' ? LEDGER_IN_CATS : LEDGER_OUT_CATS;
    var cat = cats.indexOf(val('cat')) !== -1 ? val('cat') : '기타';
    var who = LEDGER_WHO.indexOf(val('who')) !== -1 ? val('who') : '';
    var pay = LEDGER_PAYS[val('pay')] ? val('pay') : '';
    var e = ui.ledgerForm === 'new' ? null : findEntry(ui.ledgerForm);
    var data = { id: e ? e.id : uid(), date: date, type: type, amount: amount, cat: cat, text: text.slice(0, LEDGER_TEXT_MAX), who: who, pay: pay, t: e ? e.t : Date.now() };
    if (e) Object.keys(data).forEach(function (k) { e[k] = data[k]; });
    else state.ledger.push(data);
    ui.ledgerForm = null;
    ui.ledgerMonth = date.slice(0, 7);
    dropSheetHistory();
    commit();
    var label = (text || cat) + ' ' + formatWon(amount);
    act('ledger', '가계부 ' + (e ? '수정: ' : (type === 'in' ? '수입: ' : '지출: ')) + label);
    showToast((e ? '수정했어요: ' : '기록했어요: ') + label);
    var back = e ? document.querySelector('[data-focus-key="ledger:' + e.id + '"]') : $('#ledger-fab');
    if (back) back.focus({ preventScroll: true });
  }
  function deleteLedgerEntry(id) {
    var idx = -1;
    for (var i = 0; i < state.ledger.length; i++) if (state.ledger[i].id === id) idx = i;
    if (idx === -1) return;
    var removed = state.ledger.splice(idx, 1)[0];
    ui.ledgerForm = null;
    dropSheetHistory();
    commit();
    act('ledger', '가계부 삭제: ' + (removed.text || removed.cat) + ' ' + formatWon(removed.amount));
    showToast('기록을 지웠어요.', function () {
      if (findEntry(removed.id)) return;
      state.ledger.splice(Math.min(idx, state.ledger.length), 0, removed);
      commit();
      showToast('되돌렸어요.');
    });
  }
  function saveBudget() {
    var input = $('#ledger-budget-input');
    var pp = parsePrice(input.value);
    if (!pp.ok) { showToast('예산은 숫자로 적어 주세요.'); input.focus(); return; }
    state.budget = pp.value || 0;
    ui.budgetEdit = false;
    commit();
    act('ledger', state.budget ? '가계부 한 달 예산 ' + formatWon(state.budget) : '가계부 예산 없앰');
    showToast(state.budget ? '한 달 예산을 ' + formatWon(state.budget) + '으로 정했어요.' : '예산을 없앴어요.');
  }

  /* ---------- D-day ---------- */
  function ddayText(due) {
    if (!due) return '';
    var parts = due.split('-');
    var target = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
    var now = new Date(); var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var diff = Math.round((target - today) / 86400000);
    if (diff === 0) return 'D-Day';
    return diff > 0 ? 'D-' + diff : 'D+' + Math.abs(diff);
  }
  function renderDday() {
    var pill = $('#dday-pill');
    if (!pill) return;
    var t = spaceOf(ui.view) === 'mamibag' ? ddayText(state.dueDate) : '';
    pill.hidden = !t;
    if (t) {
      pill.textContent = '👶🏻 ' + t;
      pill.title = '출산 예정일 ' + formatNoteDate(state.dueDate);
    }
  }

  /* ---------- 메모 (목록 → 상세: 댓글·좋아요·즐겨찾기) ---------- */
  function findMemo(id) { for (var i = 0; i < state.memos.length; i++) if (state.memos[i].id === id) return state.memos[i]; return null; }
  // 즐겨찾기 먼저, 그 안에서는 최근 수정 순
  function memosSorted() { return state.memos.slice().sort(function (a, b) { return (b.fav ? 1 : 0) - (a.fav ? 1 : 0) || (b.updated || 0) - (a.updated || 0); }); }
  function memoStamp(t) { return t ? relTime(t) : ''; }
  function memoLines(m) {
    var lines = m.text.trim().split('\n').map(function (l) { return l.trim(); }).filter(Boolean);
    if (lines.length || !m.tables || !m.tables.length) return lines;
    var cells = [];
    m.tables[0].rows.forEach(function (r) { r.forEach(function (c) { if (c.trim()) cells.push(c.trim().split('\n')[0]); }); });
    return ['▦ 표' + (cells.length ? ' · ' + cells.slice(0, 3).join(', ') : '')];
  }
  function memoHasTableContent(m) { return m.tables.some(function (t) { return t.rows.some(function (r) { return r.some(function (c) { return c.trim(); }); }); }); }
  function memoMetaHtml(m) {
    var parts = [];
    if (m.who) parts.push(escapeHtml(m.who));
    if (m.updated) parts.push(escapeHtml(memoStamp(m.updated)));
    var h = '<span class="memo-card__by">' + parts.join(' · ') + '</span>';
    h += '<span class="memo-card__counts">' + (m.likes.length ? '<span class="memo-count memo-count--like">♥ ' + m.likes.length + '</span>' : '') + (m.comments.length ? '<span class="memo-count">💬 ' + m.comments.length + '</span>' : '') + (m.tables.length ? '<span class="memo-count">▦ ' + m.tables.length + '</span>' : '') + '</span>';
    return h;
  }
  function renderMemo() {
    // 홈 카드: 즐겨찾기·최신 메모 미리보기
    var prev = $('#memo-preview'); var cnt = $('#memo-count');
    if (prev) {
      var list = memosSorted();
      if (!list.length) prev.innerHTML = '<p class="memo-empty">아직 메모가 없습니다. ‘새 메모’로 적어 두면 여기서 바로 보입니다.</p>';
      else prev.innerHTML = list.slice(0, 3).map(function (m) {
        var lines = memoLines(m); var first = lines[0] || '';
        return '<button type="button" class="memo-preview__item" data-action="open-memo" data-memo-id="' + escapeHtml(m.id) + '"><span class="memo-preview__text">' + (m.fav ? '★ ' : '') + escapeHtml(first.slice(0, 80)) + (lines.length > 1 || first.length > 80 ? '…' : '') + '</span><span class="memo-preview__time">' + escapeHtml(memoStamp(m.updated)) + '</span></button>';
      }).join('');
      if (cnt) cnt.textContent = list.length ? list.length + '개' : '';
    }
    var view = $('#view-memos'), wrap = $('#memo-list-wrap'), detail = $('#memo-detail'), box = $('#memo-list');
    if (!view || !wrap || !detail || !box) return;
    if (ui.memoOpen && ui.memoOpen !== 'new' && !findMemo(ui.memoOpen)) { ui.memoOpen = null; ui.memoEdit = false; } // 다른 기기에서 삭제됨
    var open = ui.memoOpen;
    view.classList.toggle('is-detail', !!open);
    wrap.hidden = !!open; detail.hidden = !open;
    if (open) { detail.innerHTML = memoDetailHtml(open === 'new' ? null : findMemo(open)); return; }
    detail.innerHTML = '';
    var items = memosSorted();
    if (!items.length) { box.innerHTML = '<li class="datecard-empty">메모가 없습니다. ‘새 메모’를 눌러 적어 보세요. 가족 공유 중이면 함께 보입니다.</li>'; return; }
    box.innerHTML = items.map(function (m) {
      var lines = memoLines(m); var id = escapeHtml(m.id);
      return '<li class="memo-card' + (m.fav ? ' is-fav' : '') + '" data-memo-id="' + id + '">' +
        '<button type="button" class="memo-card__open" data-action="memo-open" data-focus-key="memo-open:' + id + '">' +
        '<span class="memo-card__title">' + escapeHtml((lines[0] || '').slice(0, 80)) + '</span>' +
        (lines.length > 1 ? '<span class="memo-card__preview">' + escapeHtml(lines.slice(1, 4).join(' ').slice(0, 160)) + '</span>' : '') +
        '<span class="memo-card__meta">' + memoMetaHtml(m) + '</span></button>' +
        '<button type="button" class="memo-card__fav' + (m.fav ? ' is-on' : '') + '" data-action="memo-fav" data-focus-key="memo-fav:' + id + '" aria-pressed="' + (m.fav ? 'true' : 'false') + '" aria-label="즐겨찾기' + (m.fav ? ' 해제' : '') + '">' + (m.fav ? '★' : '☆') + '</button></li>';
    }).join('');
  }
  function memoDetailHtml(m) {
    var isNew = !m;
    var h = '<div class="memo-detail__bar"><button type="button" class="btn btn--small" data-action="memo-back" data-focus-key="memo-back">' + backLabel() + '</button><span class="memo-detail__actions">';
    if (!isNew) h += '<button type="button" class="btn btn--small memo-favbtn' + (m.fav ? ' is-on' : '') + '" data-action="memo-fav" data-focus-key="memo-favd" aria-pressed="' + (m.fav ? 'true' : 'false') + '">' + (m.fav ? '★ 즐겨찾기' : '☆ 즐겨찾기') + '</button>';
    if (!isNew && !ui.memoEdit) {
      h += '<button type="button" class="btn btn--small" data-action="memo-edit" data-focus-key="memo-editbtn">수정</button>';
      h += '<button type="button" class="btn btn--small btn--danger" data-action="memo-delete" data-focus-key="memo-del">삭제</button>';
    }
    h += '</span></div>';
    if (isNew || ui.memoEdit) {
      h += '<label class="visually-hidden" for="memo-edit-input">메모 내용</label>';
      h += '<textarea class="memo-detail__input" id="memo-edit-input" data-focus-key="memo-edit" maxlength="' + MEMO_MAX + '" placeholder="내용을 입력하세요. 첫 줄이 제목처럼 보입니다.">' + escapeHtml(ui.memoDraft) + '</textarea>';
      h += '<div class="memo-detail__editbar"><button type="button" class="btn btn--primary" data-action="memo-save" data-focus-key="memo-save">저장</button><button type="button" class="btn" data-action="memo-cancel" data-focus-key="memo-cancel">취소</button></div>';
      if (!isNew) h += memoTablesHtml(m); else h += '<section class="mtables" aria-label="표"><button type="button" class="btn btn--small mtables__add" data-action="table-add" data-focus-key="table-add">▦ 표 추가</button></section>';
      return h;
    }
    var me = myName();
    var liked = m.likes.indexOf(me) !== -1;
    h += '<article class="memo-detail__body"><p class="memo-detail__meta">' + [m.who ? escapeHtml(m.who) : '', m.updated ? '수정 ' + escapeHtml(memoStamp(m.updated)) : ''].filter(Boolean).join(' · ') + '</p>';
    h += '<div class="memo-detail__text">' + escapeHtml(m.text) + '</div></article>';
    h += memoTablesHtml(m);
    h += '<div class="memo-detail__react"><button type="button" class="memo-like' + (liked ? ' is-on' : '') + '" data-action="memo-like" data-focus-key="memo-like" aria-pressed="' + (liked ? 'true' : 'false') + '">' + (liked ? '♥' : '♡') + ' 좋아요' + (m.likes.length ? ' <b>' + m.likes.length + '</b>' : '') + '</button>';
    if (m.likes.length) h += '<span class="memo-like__who">' + escapeHtml(m.likes.join(', ')) + '</span>';
    h += '</div>';
    h += '<section class="memo-comments" aria-label="댓글"><h3 class="memo-comments__title">💬 댓글 ' + (m.comments.length || '') + '</h3>';
    if (m.comments.length) {
      h += '<ul class="memo-comments__list">' + m.comments.map(function (c) {
        return '<li class="memo-comment" data-comment-id="' + escapeHtml(c.id) + '"><div class="memo-comment__head"><span class="memo-comment__who">' + escapeHtml(c.who || '가족') + '</span><span class="memo-comment__time">' + escapeHtml(memoStamp(c.t)) + '</span>' +
          '<button type="button" class="memo-comment__del" data-action="memo-comment-del" aria-label="이 댓글 삭제">×</button></div><p class="memo-comment__text">' + escapeHtml(c.text) + '</p></li>';
      }).join('') + '</ul>';
    } else h += '<p class="memo-comments__empty">첫 댓글을 남겨 보세요.</p>';
    h += '<form class="memo-comments__form" data-action="memo-comment"><label class="visually-hidden" for="memo-comment-input">댓글 입력</label>';
    h += '<input type="text" id="memo-comment-input" data-focus-key="memo-comment" maxlength="' + COMMENT_MAX + '" placeholder="댓글 달기" autocomplete="off" enterkeyhint="send" value="' + escapeHtml(ui.commentDraft) + '"><button type="submit" class="btn btn--primary btn--small">등록</button></form></section>';
    return h;
  }
  // 표: 셀은 그 자리에서 고치고, 선(손잡이)을 끌어 열 너비·행 높이를 조절한다
  function memoTablesHtml(m) {
    var h = '<section class="mtables" aria-label="표">';
    m.tables.forEach(function (t, ti) {
      var tid = escapeHtml(t.id);
      var total = t.cols.reduce(function (a, b) { return a + b; }, 0);
      var sel = ui.tableSel && ui.tableSel.t === t.id ? ui.tableSel : null;
      h += '<div class="mtable" data-table-id="' + tid + '"><div class="mtable__scroll"><table style="width:' + total + 'px" aria-label="표 ' + (ti + 1) + '"><colgroup>' + t.cols.map(function (w) { return '<col style="width:' + w + 'px">'; }).join('') + '</colgroup><tbody>';
      t.rows.forEach(function (row, r) {
        h += '<tr>' + row.map(function (cell, c) {
          var on = sel && sel.r === r && sel.c === c;
          return '<td class="' + (on ? 'is-sel' : '') + '"><div class="mtable__cell" contenteditable="true" role="textbox" aria-multiline="true" aria-label="' + (r + 1) + '행 ' + (c + 1) + '열" data-r="' + r + '" data-c="' + c + '" data-focus-key="cell:' + tid + ':' + r + ':' + c + '" style="min-height:' + t.rowH[r] + 'px">' + escapeHtml(cell) + '</div>' +
            '<span class="mtable__colgrip" data-grip="col" data-i="' + c + '" aria-hidden="true"></span><span class="mtable__rowgrip" data-grip="row" data-i="' + r + '" aria-hidden="true"></span></td>';
        }).join('') + '</tr>';
      });
      h += '</tbody></table></div>';
      h += '<div class="mtable__tools"><button type="button" class="btn btn--small" data-action="table-row-add"' + (t.rows.length >= TABLE_ROWS_MAX ? ' disabled' : '') + '>＋ 행</button>';
      h += '<button type="button" class="btn btn--small" data-action="table-col-add"' + (t.cols.length >= TABLE_COLS_MAX ? ' disabled' : '') + '>＋ 열</button>';
      h += '<button type="button" class="btn btn--small" data-action="table-row-del"' + (t.rows.length <= 1 ? ' disabled' : '') + '>행 삭제</button>';
      h += '<button type="button" class="btn btn--small" data-action="table-col-del"' + (t.cols.length <= 1 ? ' disabled' : '') + '>열 삭제</button>';
      h += '<button type="button" class="btn btn--small btn--danger" data-action="table-del">표 삭제</button></div>';
      h += '<p class="mtable__hint">칸을 눌러 바로 입력합니다. 칸 사이의 선을 끌면 열 너비·행 높이가 바뀌고, 행·열 삭제는 마지막으로 누른 칸 기준입니다.</p></div>';
    });
    if (m.tables.length < TABLES_PER_MEMO) h += '<button type="button" class="btn btn--small mtables__add" data-action="table-add" data-focus-key="table-add">▦ 표 추가</button>';
    h += '</section>';
    return h;
  }
  function findTable(m, tid) { for (var i = 0; i < m.tables.length; i++) if (m.tables[i].id === tid) return m.tables[i]; return null; }
  function touchMemo(m) { m.updated = Date.now(); }
  function addMemoTable(id) {
    if (id === 'new') {
      var created = { id: uid(), text: String(ui.memoDraft).replace(/\r\n?/g, '\n').slice(0, MEMO_MAX), updated: Date.now(), who: myName(), fav: false, likes: [], comments: [], tables: [] };
      state.memos.unshift(created);
      ui.memoOpen = created.id; // 편집 상태(ui.memoEdit)와 적던 글(ui.memoDraft)은 그대로 둔다
      id = created.id;
    }
    var m = findMemo(id); if (!m) return;
    if (m.tables.length >= TABLES_PER_MEMO) { showToast('표는 메모마다 ' + TABLES_PER_MEMO + '개까지 넣을 수 있습니다.'); return; }
    var t = { id: uid(), cols: [COL_W_DEFAULT, COL_W_DEFAULT, COL_W_DEFAULT], rowH: [ROW_H_MIN, ROW_H_MIN, ROW_H_MIN], rows: [['', '', ''], ['', '', ''], ['', '', '']] };
    m.tables.push(t); touchMemo(m);
    ui.tableSel = { t: t.id, r: 0, c: 0 };
    commit(); act('memo', '메모에 표 추가: ' + (memoLines(m)[0] || '').slice(0, 30));
    var first = document.querySelector('[data-focus-key="cell:' + t.id + ':0:0"]'); if (first) first.focus();
  }
  function selIn(t) { return ui.tableSel && ui.tableSel.t === t.id ? ui.tableSel : null; }
  function tableAction(id, tid, action) {
    var m = findMemo(id); var t = m && findTable(m, tid); if (!t) return;
    var sel = selIn(t);
    var r = sel ? Math.min(sel.r, t.rows.length - 1) : t.rows.length - 1;
    var c = sel ? Math.min(sel.c, t.cols.length - 1) : t.cols.length - 1;
    var focusKey = null;
    switch (action) {
      case 'table-row-add':
        if (t.rows.length >= TABLE_ROWS_MAX) return;
        t.rows.splice(r + 1, 0, t.cols.map(function () { return ''; })); t.rowH.splice(r + 1, 0, ROW_H_MIN);
        ui.tableSel = { t: t.id, r: r + 1, c: c }; focusKey = 'cell:' + t.id + ':' + (r + 1) + ':' + c; break;
      case 'table-col-add':
        if (t.cols.length >= TABLE_COLS_MAX) return;
        t.rows.forEach(function (row) { row.splice(c + 1, 0, ''); }); t.cols.splice(c + 1, 0, COL_W_DEFAULT);
        ui.tableSel = { t: t.id, r: r, c: c + 1 }; focusKey = 'cell:' + t.id + ':' + r + ':' + (c + 1); break;
      case 'table-row-del': {
        if (t.rows.length <= 1) return;
        if (t.rows[r].some(function (x) { return x.trim(); }) && !window.confirm((r + 1) + '번째 행에 내용이 있습니다. 삭제할까요?')) return;
        t.rows.splice(r, 1); t.rowH.splice(r, 1);
        ui.tableSel = { t: t.id, r: Math.min(r, t.rows.length - 1), c: c }; break;
      }
      case 'table-col-del': {
        if (t.cols.length <= 1) return;
        if (t.rows.some(function (row) { return row[c].trim(); }) && !window.confirm((c + 1) + '번째 열에 내용이 있습니다. 삭제할까요?')) return;
        t.rows.forEach(function (row) { row.splice(c, 1); }); t.cols.splice(c, 1);
        ui.tableSel = { t: t.id, r: r, c: Math.min(c, t.cols.length - 1) }; break;
      }
      case 'table-del': {
        var filled = t.rows.some(function (row) { return row.some(function (x) { return x.trim(); }); });
        if (filled && !window.confirm('이 표를 삭제할까요?')) return;
        var idx = m.tables.indexOf(t);
        m.tables.splice(idx, 1); ui.tableSel = null; touchMemo(m); commit();
        showToast('표를 삭제했습니다.', function () { var mm = findMemo(id); if (!mm) return; mm.tables.splice(Math.min(idx, mm.tables.length), 0, t); commit(); showToast('삭제를 취소했습니다.'); });
        return;
      }
      default: return;
    }
    touchMemo(m); commit();
    if (focusKey) { var f = document.querySelector('[data-focus-key="' + focusKey + '"]'); if (f) f.focus(); }
  }
  // 셀 내용 저장(다시 그리지 않는다: 다른 칸을 누르는 도중 화면이 바뀌면 포커스를 잃는다)
  function saveTableCell(id, tid, r, c, text) {
    var m = findMemo(id); var t = m && findTable(m, tid); if (!t || !t.rows[r] || t.rows[r][c] === undefined) return;
    var v = String(text || '').replace(/\r\n?/g, '\n').replace(/\n+$/, '').slice(0, CELL_MAX);
    if (v === t.rows[r][c]) return;
    t.rows[r][c] = v; touchMemo(m);
    saveState();
  }

  function openMemo(id, from) {
    if (!findMemo(id)) return;
    ui.memoOpen = id; ui.memoEdit = false; ui.memoDraft = ''; ui.commentDraft = ''; ui.detailFrom = from || null;
    if (ui.view !== 'memos') setView('memos'); else renderMemo();
    window.scrollTo(0, 0);
  }
  function newMemo() {
    ui.memoOpen = 'new'; ui.memoEdit = true; ui.memoDraft = ''; ui.commentDraft = ''; ui.detailFrom = null;
    if (ui.view !== 'memos') setView('memos'); else renderMemo();
    window.scrollTo(0, 0);
    var ta = $('#memo-edit-input'); if (ta) ta.focus();
  }
  // 편집 중인 내용을 저장한다. 바뀐 게 없으면 아무 일도 하지 않는다. (quiet: 안내 없이)
  function saveMemoEdit(quiet) {
    if (!ui.memoOpen || !ui.memoEdit) return false;
    var v = String(ui.memoDraft).replace(/\r\n?/g, '\n').slice(0, MEMO_MAX);
    if (ui.memoOpen === 'new') {
      if (!v.trim()) return false;
      var m = { id: uid(), text: v, updated: Date.now(), who: myName(), fav: false, likes: [], comments: [], tables: [] };
      state.memos.unshift(m);
      ui.memoOpen = m.id; ui.memoEdit = false; ui.memoDraft = '';
      commit(); act('memo', '메모 추가: ' + (memoLines(m)[0] || '').slice(0, 30));
      if (!quiet) showToast('메모를 저장했습니다.');
      return true;
    }
    var cur = findMemo(ui.memoOpen); if (!cur) return false;
    ui.memoEdit = false;
    if (v === cur.text || (!v.trim() && !cur.tables.length)) { ui.memoDraft = ''; renderMemo(); return false; }
    cur.text = v; cur.updated = Date.now(); ui.memoDraft = '';
    commit(); act('memo', '메모 수정: ' + (memoLines(cur)[0] || '').slice(0, 30));
    if (!quiet) showToast('메모를 저장했습니다.');
    return true;
  }
  function closeMemo() {
    var ae = document.activeElement; // 표 칸에 커서가 있으면 그 내용부터 저장
    if (ae && ae.classList && ae.classList.contains('mtable__cell') && ui.memoOpen && ui.memoOpen !== 'new') {
      var tEl = ae.closest('[data-table-id]');
      if (tEl) saveTableCell(ui.memoOpen, tEl.dataset.tableId, Number(ae.dataset.r), Number(ae.dataset.c), ae.innerText);
    }
    if (ui.memoEdit) saveMemoEdit(true); // 목록으로 나가면 적던 내용은 저장
    var leaving = ui.memoOpen && ui.memoOpen !== 'new' ? findMemo(ui.memoOpen) : null;
    ui.memoOpen = null; ui.memoEdit = false; ui.memoDraft = ''; ui.commentDraft = '';
    if (leaving && !leaving.text.trim() && !memoHasTableContent(leaving) && !leaving.comments.length) {
      state.memos = state.memos.filter(function (x) { return x !== leaving; });
      saveState();
    }
  }
  function deleteMemo(id) {
    var idx = -1; for (var i = 0; i < state.memos.length; i++) if (state.memos[i].id === id) idx = i;
    if (idx < 0) return;
    var m = state.memos[idx];
    if (!window.confirm('이 메모를 삭제할까요?' + (m.comments.length ? ' 댓글 ' + m.comments.length + '개도 함께 지워집니다.' : ''))) return;
    state.memos.splice(idx, 1);
    if (ui.memoOpen === id) { ui.memoOpen = null; ui.memoEdit = false; }
    commit(); act('memo', '메모 삭제');
    showToast('메모를 삭제했습니다.', function () { state.memos.splice(Math.min(idx, state.memos.length), 0, m); commit(); showToast('삭제를 취소했습니다.'); });
  }
  function toggleMemoFav(id) {
    var m = findMemo(id); if (!m) return;
    m.fav = !m.fav; commit();
    showToast(m.fav ? '즐겨찾기에 추가했습니다. 목록 맨 위에 고정됩니다.' : '즐겨찾기를 해제했습니다.');
  }
  function toggleMemoLike(id) {
    var m = findMemo(id); if (!m) return;
    var me = myName(); var i = m.likes.indexOf(me);
    if (i === -1) m.likes.push(me); else m.likes.splice(i, 1);
    commit();
    if (i === -1) act('memo', '메모에 좋아요: ' + (memoLines(m)[0] || '').slice(0, 30));
  }
  function addMemoComment(id, text) {
    var m = findMemo(id); if (!m) return false;
    var t = String(text || '').replace(/\r\n?/g, '\n').trim().slice(0, COMMENT_MAX);
    if (!t) { showToast('댓글 내용을 입력하세요.'); return false; }
    if (m.comments.length >= COMMENTS_PER_MEMO) { showToast('댓글은 메모마다 ' + COMMENTS_PER_MEMO + '개까지 남길 수 있습니다.'); return false; }
    m.comments.push({ id: uid(), who: myName(), text: t, t: Date.now() });
    ui.commentDraft = '';
    commit(); act('memo', '메모에 댓글: ' + t.slice(0, 30));
    return true;
  }
  function deleteMemoComment(id, cid) {
    var m = findMemo(id); if (!m) return;
    var idx = -1; m.comments.forEach(function (c, i) { if (c.id === cid) idx = i; });
    if (idx < 0) return;
    var c = m.comments[idx];
    m.comments.splice(idx, 1); commit();
    showToast('댓글을 삭제했습니다.', function () { var mm = findMemo(id); if (!mm) return; mm.comments.splice(Math.min(idx, mm.comments.length), 0, c); commit(); showToast('삭제를 취소했습니다.'); });
  }

  /* ---------- 변경 기록(알림) ---------- */
  // 이름을 정하지 않은 기기는 기기마다 다른 자동 이름을 쓴다(둘 다 '나'면 서로의 변경을 구분할 수 없다).
  function autoName() {
    if (!ui.autoName) { ui.autoName = '가족' + Math.random().toString(36).slice(2, 5).toUpperCase(); saveUiPrefs(); }
    return ui.autoName;
  }
  function myName() { return ui.deviceName || autoName(); }
  function ensureDeviceName() {
    if (ui.deviceName) return;
    var n = window.prompt('변경 기록에 표시할 내 이름을 입력하세요 (예: 남편, 아내)', '');
    if (n && n.trim()) { ui.deviceName = n.trim().slice(0, 12); saveUiPrefs(); renderSettings(); }
    else showToast('이름을 정하지 않아 ‘' + autoName() + '’으로 표시됩니다. 설정에서 바꿀 수 있습니다.');
  }
  function act(kind, text) {
    var S = window.ChecklistSync;
    if (!S || !S.getState().roomId) return;
    try { S.logActivity({ kind: kind, text: text }); } catch (e) { /* activity is best-effort */ }
  }
  function relTime(t) {
    var d = Date.now() - t;
    if (d < 60000) return '방금';
    if (d < 3600000) return Math.floor(d / 60000) + '분 전';
    if (d < 86400000) return Math.floor(d / 3600000) + '시간 전';
    var dt = new Date(t); return (dt.getMonth() + 1) + '/' + dt.getDate() + ' ' + timeStampOf(dt);
  }
  // 가족의 변경 기록은 화면에 목록으로 보여주지 않고, 앱을 보는 중에 새로 들어온 변경만 알림 문구로 띄운다.
  var activityInitialized = false;
  function setActivity(list) {
    var prevMax = 0;
    ui.activity.forEach(function (a) { if (a.t > prevMax) prevMax = a.t; });
    ui.activity = (list || []).filter(function (a) { return a && typeof a.t === 'number'; });
    if (activityInitialized && ui.toastRemote) {
      var me = myName();
      var fresh = ui.activity.filter(function (a) { return a.t > prevMax && a.who !== me; });
      if (fresh.length && document.visibilityState === 'visible') {
        var last = fresh.sort(function (a, b) { return b.t - a.t; })[0];
        showToast((last.who || '가족') + ' · ' + last.text + (fresh.length > 1 ? ' 외 ' + (fresh.length - 1) + '건' : ''));
      }
    }
    activityInitialized = true;
  }

  /* ---------- 설정 ---------- */
  function renderSettings() {
    var dn = $('#device-name'); if (dn && document.activeElement !== dn) { dn.value = ui.deviceName; dn.placeholder = ui.deviceName ? '예: 남편, 아내' : '예: 남편, 아내 (지금은 ' + autoName() + ')'; }
    var dd = $('#due-date'); if (dd && document.activeElement !== dd) dd.value = state.dueDate || '';
    var an = $('#anniversary'); if (an && document.activeElement !== an) an.value = state.anniversary || '';
    var tr = $('#toast-remote'); if (tr) tr.checked = ui.toastRemote;
    renderArchive();
  }

  /* ---------- 정부 지원 체크리스트 ---------- */
  function findSupport(id) { for (var i = 0; i < state.supports.length; i++) if (state.supports[i].id === id) return state.supports[i]; return null; }
  function supportFormHtml(sp) {
    var isNew = !sp; var id = isNew ? 'new' : escapeHtml(sp.id);
    var v = function (k) { return isNew ? '' : escapeHtml(sp[k] || ''); };
    var h = '<form class="support-form" data-support-form="' + id + '">';
    h += '<div class="field"><label for="sp-title-' + id + '">지원 이름</label><input type="text" id="sp-title-' + id + '" name="title" data-focus-key="sp-title:' + id + '" value="' + v('title') + '" maxlength="60" placeholder="예: 첫만남이용권" required></div>';
    h += '<div class="field"><label for="sp-target-' + id + '">대상·조건</label><input type="text" id="sp-target-' + id + '" name="target" value="' + v('target') + '" maxlength="300" placeholder="누가 받을 수 있는지"></div>';
    h += '<div class="field"><label for="sp-benefit-' + id + '">지원 내용</label><textarea id="sp-benefit-' + id + '" name="benefit" rows="2" maxlength="500" placeholder="금액·바우처·기간 등">' + v('benefit') + '</textarea></div>';
    h += '<div class="field"><label for="sp-howto-' + id + '">신청 방법·유의사항</label><textarea id="sp-howto-' + id + '" name="howto" rows="2" maxlength="500" placeholder="어디서, 무엇을 준비해서, 주의할 점">' + v('howto') + '</textarea></div>';
    h += '<div class="field-row"><div class="field"><label for="sp-deadline-' + id + '">신청 기한</label><input type="date" id="sp-deadline-' + id + '" name="deadline" value="' + v('deadline') + '"></div>';
    h += '<div class="field"><label for="sp-status-' + id + '">상태</label><select id="sp-status-' + id + '" name="status">' + SUPPORT_STATUS.map(function (k) { return '<option value="' + k + '"' + (!isNew && sp.status === k ? ' selected' : '') + '>' + SUPPORT_STATUS_LABEL[k] + '</option>'; }).join('') + '</select></div></div>';
    h += '<div class="field"><label for="sp-link-' + id + '">공식 링크</label><input type="url" id="sp-link-' + id + '" name="link" value="' + v('link') + '" maxlength="300" placeholder="https://www.bokjiro.go.kr/ 등" inputmode="url"></div>';
    h += '<div class="field"><label for="sp-memo-' + id + '">메모</label><textarea id="sp-memo-' + id + '" name="memo" rows="2" maxlength="500">' + v('memo') + '</textarea></div>';
    h += '<p class="field-error" data-error hidden></p>';
    h += '<div class="note-form__actions"><button type="submit" class="btn btn--primary btn--small">' + (isNew ? '항목 저장' : '수정 저장') + '</button><button type="button" class="btn btn--small" data-action="cancel-support">취소</button></div></form>';
    return h;
  }
  function safeHref(u) {
    return /^https?:\/\//i.test(u) ? u : '';
  }
  function renderSupports() {
    var list = $('#support-list'); if (!list) return;
    var stats = $('#supports-stats');
    var counts = { todo: 0, applied: 0, received: 0, na: 0 };
    state.supports.forEach(function (x) { counts[x.status] = (counts[x.status] || 0) + 1; });
    if (stats) stats.innerHTML = state.supports.length ? SUPPORT_STATUS.map(function (k) { return '<span class="sp-stat sp-stat--' + k + '">' + SUPPORT_STATUS_LABEL[k] + ' ' + counts[k] + '</span>'; }).join('') : '';
    var cnt = $('#supports-count'); if (cnt) cnt.textContent = state.supports.length ? state.supports.length + '개' : '';
    var html = '';
    if (ui.supportEdit === 'new') html += '<li class="support support--editing">' + supportFormHtml(null) + '</li>';
    if (!state.supports.length && ui.supportEdit !== 'new') {
      html += '<li class="datecard-empty">아직 항목이 없습니다. ‘항목 추가’로 첫만남이용권, 부모급여, 출산휴가 같은 지원을 하나씩 정리해 보세요.<br><small>각 항목에 대상·지원 내용·신청 방법·기한·공식 링크·상태(확인 전→신청함→받음)를 적을 수 있습니다.</small></li>';
    }
    var order = { todo: 0, applied: 1, received: 2, na: 3 };
    state.supports.slice().sort(function (a, b) { return order[a.status] - order[b.status]; }).forEach(function (sp) {
      if (ui.supportEdit === sp.id) { html += '<li class="support support--editing" data-support-id="' + escapeHtml(sp.id) + '">' + supportFormHtml(sp) + '</li>'; return; }
      var href = safeHref(sp.link);
      html += '<li class="support support--' + sp.status + '" data-support-id="' + escapeHtml(sp.id) + '">';
      html += '<div class="support__head"><div class="support__meta"><span class="support__title">' + escapeHtml(sp.title) + '</span><span class="sp-stat sp-stat--' + sp.status + '">' + SUPPORT_STATUS_LABEL[sp.status] + '</span>';
      if (sp.deadline) html += '<span class="badge badge--label">기한 ' + escapeHtml(formatNoteDate(sp.deadline)) + '</span>';
      html += '</div><div class="support__actions"><button type="button" class="btn btn--small" data-action="edit-support" data-focus-key="sp-edit:' + escapeHtml(sp.id) + '">수정</button><button type="button" class="btn btn--small btn--danger" data-action="delete-support">삭제</button></div></div>';
      if (sp.target) html += '<p class="support__row"><b>대상</b>' + escapeHtml(sp.target) + '</p>';
      if (sp.benefit) html += '<p class="support__row"><b>내용</b>' + escapeHtml(sp.benefit) + '</p>';
      if (sp.howto) html += '<p class="support__row"><b>신청</b>' + escapeHtml(sp.howto) + '</p>';
      if (sp.memo) html += '<p class="support__row"><b>메모</b>' + escapeHtml(sp.memo) + '</p>';
      if (href) html += '<p class="support__row"><a class="support__link" href="' + escapeHtml(href) + '" target="_blank" rel="noopener noreferrer">공식 안내 열기 ↗</a></p>';
      html += '<div class="support__status"><label class="visually-hidden" for="sp-quick-' + escapeHtml(sp.id) + '">상태 바꾸기</label><select id="sp-quick-' + escapeHtml(sp.id) + '" data-action="quick-status">' + SUPPORT_STATUS.map(function (k) { return '<option value="' + k + '"' + (sp.status === k ? ' selected' : '') + '>' + SUPPORT_STATUS_LABEL[k] + '</option>'; }).join('') + '</select></div>';
      html += '</li>';
    });
    list.innerHTML = html;
    var addBtn = $('#add-support-btn'); if (addBtn) addBtn.hidden = ui.supportEdit === 'new';
  }
  function readSupportForm(form) {
    var g = function (n, max) { return (form.elements[n].value || '').replace(/\r\n?/g, '\n').trim().slice(0, max); };
    var dl = form.elements.deadline.value; if (dl && !/^\d{4}-\d{2}-\d{2}$/.test(dl)) dl = '';
    var st = form.elements.status.value; if (SUPPORT_STATUS.indexOf(st) === -1) st = 'todo';
    return { title: g('title', 60), target: g('target', 300), benefit: g('benefit', 500), howto: g('howto', 500), deadline: dl, link: g('link', 300), status: st, memo: g('memo', 500) };
  }
  function submitSupportForm(form) {
    var v = readSupportForm(form);
    var err = $('[data-error]', form);
    if (!v.title) { err.textContent = '지원 이름을 입력하세요.'; err.hidden = false; form.elements.title.focus(); return; }
    var key = form.dataset.supportForm;
    if (key === 'new') {
      state.supports.push({ id: uid(), title: v.title, target: v.target, benefit: v.benefit, howto: v.howto, deadline: v.deadline, link: v.link, status: v.status, memo: v.memo });
      ui.supportEdit = null; commit(); act('support', '지원 항목 ‘' + v.title + '’ 추가'); showToast('지원 항목을 저장했습니다.');
    } else {
      var sp = findSupport(key); if (!sp) { ui.supportEdit = null; render(); return; }
      Object.keys(v).forEach(function (k) { sp[k] = v[k]; });
      ui.supportEdit = null; commit(); act('support', '지원 항목 ‘' + v.title + '’ 수정'); showToast('지원 항목을 수정했습니다.');
    }
  }
  function deleteSupport(id) {
    var idx = -1; for (var i = 0; i < state.supports.length; i++) if (state.supports[i].id === id) idx = i;
    if (idx < 0) return;
    var sp = state.supports[idx];
    if (!window.confirm('‘' + sp.title + '’ 항목을 삭제할까요?')) return;
    state.supports.splice(idx, 1); if (ui.supportEdit === id) ui.supportEdit = null;
    commit(); act('support', '지원 항목 ‘' + sp.title + '’ 삭제');
    showToast('지원 항목을 삭제했습니다.', function () { state.supports.splice(Math.min(idx, state.supports.length), 0, sp); commit(); showToast('삭제를 취소했습니다.'); });
  }

  function renderHighlightsStrip() {
    var strip = $('#highlights-strip'), body = $('#highlights-strip-body');
    if (!strip) return;
    var lines = state.highlights ? state.highlights.split('\n') : [];
    var show = ui.view !== 'home' && spaceOf(ui.view) === 'mamibag' && lines.length > 0;
    strip.hidden = !show;
    if (!show) { body.hidden = true; return; }
    $('#highlights-strip-text').textContent = lines[0];
    $('#highlights-strip-more').textContent = lines.length > 1 ? '외 ' + (lines.length - 1) + '개' : '';
    strip.setAttribute('aria-expanded', ui.stripOpen ? 'true' : 'false');
    strip.classList.toggle('is-open', ui.stripOpen);
    body.hidden = !ui.stripOpen;
    body.innerHTML = '<ul class="highlights-list">' + lines.map(function (l) { return '<li>' + escapeHtml(l) + '</li>'; }).join('') + '</ul>';
  }

  /* ---------- 꼭 기억하기 (상단 고정) ---------- */
  function renderHighlights() {
    var box = $('#highlights-body');
    var lines = state.highlights ? state.highlights.split('\n') : [];
    var editBtn = $('#highlights-edit-btn');
    var collapsed = ui.highlightsCollapsed && !ui.highlightEdit;
    var toggle = $('#highlights-toggle');
    toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    $('#highlights-count').textContent = lines.length ? lines.length + '개' : '';
    $('#highlights-toggle-label').textContent = collapsed ? '펼치기' : '접기';
    box.hidden = collapsed;
    $('#highlights').classList.toggle('is-collapsed', collapsed);
    if (ui.highlightEdit) {
      editBtn.hidden = true;
      box.innerHTML = '<form class="highlights-form" id="highlights-form">' +
        '<label for="highlights-input" class="visually-hidden">꼭 기억할 내용 (한 줄에 하나)</label>' +
        '<textarea id="highlights-input" rows="5" maxlength="' + HIGHLIGHT_MAX + '" data-focus-key="highlights-input" placeholder="한 줄에 하나씩 적으세요.\n예: 마스크 꼭 착용\n예: 다음 진료 태동검사">' + escapeHtml(state.highlights) + '</textarea>' +
        '<div class="note-form__actions"><button type="submit" class="btn btn--primary btn--small">저장</button>' +
        '<button type="button" class="btn btn--small" data-action="cancel-highlights">취소</button></div></form>';
      return;
    }
    editBtn.hidden = false;
    editBtn.textContent = lines.length ? '수정' : '추가';
    if (!lines.length) {
      box.innerHTML = '<p class="highlights-empty">진료 메모 중 꼭 기억할 내용을 여기에 적어 두면 항상 맨 위에 보입니다.</p>';
      return;
    }
    box.innerHTML = '<ul class="highlights-list">' + lines.map(function (l) {
      return '<li>' + escapeHtml(l) + '</li>';
    }).join('') + '</ul>';
  }

  function saveHighlights(text) {
    state.highlights = cleanHighlights(text);
    ui.highlightEdit = false;
    commit();
    act('highlight', '꼭 기억하기 ' + (state.highlights ? '수정' : '비움'));
    showToast(state.highlights ? '꼭 기억하기를 저장했습니다.' : '꼭 기억하기를 비웠습니다.');
    $('#highlights-edit-btn').focus();
  }

  /* ---------- toast / undo ---------- */
  function showToast(text, undoFn) {
    var toast = $('#toast');
    var undoBtn = $('#toast-undo');
    clearTimeout(ui.undoTimer);
    ui.pendingUndo = undoFn || null;
    $('#toast-text').textContent = text;
    undoBtn.hidden = !undoFn;
    toast.hidden = false;
    ui.undoTimer = setTimeout(hideToast, undoFn ? UNDO_MS : 3500);
  }

  function hideToast() {
    clearTimeout(ui.undoTimer);
    $('#toast').hidden = true;
    ui.pendingUndo = null;
  }

  /* ---------- actions ---------- */
  function commit() {
    saveState();
    render();
  }

  function addCategory(name) {
    var n = String(name || '').trim();
    if (!n) { showToast('분류 이름을 입력하세요.'); return false; }
    var newId = uid();
    state.categories.push({ id: newId, name: n.slice(0, 40), icon: '', doneTabs: false, subs: [], group: defaultGroupFor(n) });
    ui.activeCategory = newId;
    saveUiPrefs();
    commit();
    act('category', '분류 ‘' + n.slice(0, 40) + '’ 추가');
    return true;
  }

  function renameCategory(id, name, inputEl) {
    var cat = findCategory(id);
    if (!cat) return;
    var n = String(name || '').trim();
    if (!n) {
      inputEl.value = cat.name;
      showToast('분류 이름은 비워둘 수 없습니다. 이전 이름을 유지합니다.');
      return;
    }
    if (n === cat.name) return;
    var oldName = cat.name;
    cat.name = n.slice(0, 40);
    saveState();
    act('category', '분류 ‘' + oldName + '’ → ‘' + cat.name + '’ 이름 변경');
    // Targeted DOM update so focus and tab order are preserved.
    var card = inputEl.closest('[data-category-id]');
    if (card) {
      var h2 = $('h2', card);
      if (h2) h2.textContent = cat.name;
      var del = $('[data-action="delete-category"]', card);
      if (del) del.setAttribute('aria-label', '분류 ' + cat.name + ' 삭제');
      var bar = $('.progress-bar', card);
      if (bar) bar.setAttribute('aria-label', cat.name + ' 진행률');
    }
    var opts = document.querySelectorAll('select[data-action="move-item"] option[value="' + id + '"]');
    Array.prototype.forEach.call(opts, function (opt) {
      opt.textContent = cat.name + (opt.selected ? ' (현재)' : '');
    });
    showToast('분류 이름을 ‘' + cat.name + '’(으)로 변경했습니다.');
  }

  function setCategoryIcon(id, value) {
    var cat = findCategory(id);
    if (!cat) return;
    var icon = cleanIcon(value);
    if (icon === (cat.icon || '')) return;
    cat.icon = icon;
    saveState();
    // Keep the input and preset buttons in sync without a full re-render (focus stays put).
    var card = document.querySelector('.category[data-category-id="' + id + '"]');
    if (!card) return;
    var input = $('[data-action="set-icon"]', card);
    if (input && input.value !== icon) input.value = icon;
    Array.prototype.forEach.call(card.querySelectorAll('[data-action="pick-icon"]'), function (b) {
      var active = (b.dataset.icon || '') === icon;
      b.classList.toggle('is-active', active);
      b.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  function deleteCategory(id) {
    var cat = findCategory(id);
    if (!cat) return;
    var catItems = itemsOf(id);
    var msg = catItems.length > 0
      ? '‘' + cat.name + '’ 분류를 삭제하면 안에 있는 준비물 ' + catItems.length + '개도 함께 삭제됩니다. 삭제할까요?'
      : '‘' + cat.name + '’ 분류를 삭제할까요?';
    if (!window.confirm(msg)) return;
    var index = state.categories.indexOf(cat);
    state.categories.splice(index, 1);
    state.items = state.items.filter(function (it) { return it.categoryId !== id; });
    commit();
    act('category', '분류 ‘' + cat.name + '’ 삭제' + (catItems.length ? ' (준비물 ' + catItems.length + '개 포함)' : ''));
    showToast('‘' + cat.name + '’ 분류를 삭제했습니다.' + (catItems.length ? ' (준비물 ' + catItems.length + '개 포함)' : ''), function () {
      state.categories.splice(Math.min(index, state.categories.length), 0, cat);
      state.items = state.items.concat(catItems);
      commit();
      showToast('삭제를 취소했습니다.');
    });
  }

  // "수유 패드 2팩", "물티슈 x3", "젖병 3" → { name, qty, unit }
  function parseItemLine(line) {
    var t = String(line || '').replace(/^[\s\-•·*\d]*[.)]?\s*(?=\S)/, '').trim();
    t = t.replace(/^[-•·*]\s*/, '').trim();
    if (!t) return null;
    var tp = parseTagPrefix(t); t = tp.rest; if (!t) return null;
    // 끝에 붙은 금액: "5,000", "5000원", "5천원", "1.5만원"
    var m = t.match(/^(.+?)[\s:]+((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?\s*(?:만|천)?\s*원?)$/);
    if (m && m[1].trim()) {
      var pp = parsePrice(m[2]);
      if (pp.ok) return { name: m[1].trim().slice(0, 60), price: pp.value, tags: tp.tags };
    }
    return { name: t.slice(0, 60), price: null, tags: tp.tags };
  }
  function chosenAddSub(card) {
    var c = findCategory(card.dataset.categoryId); if (!c) return '';
    var sel = card.querySelector('select[data-role="add-sub"]');
    var v = sel ? sel.value : '';
    return v && v !== '__new' && findSub(c, v) ? v : '';
  }
  function subNameOf(categoryId, subId) { var c = findCategory(categoryId), sb = c && subId && findSub(c, subId); return sb ? sb.name : ''; }
  function addItem(categoryId, text, subId) {
    var p = parseItemLine(text);
    if (!p) { showToast('준비물 이름을 입력하세요.'); return false; }
    if (!findCategory(categoryId)) return false;
    state.items.push({ id: uid(), categoryId: categoryId, name: p.name, price: p.price, tags: p.tags || [], sub: subId || '', memo: '', done: false, excluded: false });
    commit();
    act('add', '‘' + p.name + '’ 추가' + (p.tags && p.tags.length ? ' (' + p.tags.join('+') + ')' : ''));
    showToast('‘' + p.name + '’ 추가' + (subNameOf(categoryId, subId) ? ' · ' + subNameOf(categoryId, subId) : '') + (p.tags && p.tags.length ? ' · ' + p.tags.join('+') : '') + (p.price !== null ? ' · ' + formatWon(p.price) : ''));
    return true;
  }
  function addItems(categoryId, text, subId) {
    if (!findCategory(categoryId)) return 0;
    var added = [];
    String(text || '').split(/\r?\n/).forEach(function (line) {
      var p = parseItemLine(line); if (!p) return;
      state.items.push({ id: uid(), categoryId: categoryId, name: p.name, price: p.price, tags: p.tags || [], sub: subId || '', memo: '', done: false, excluded: false });
      added.push(p.name);
    });
    if (!added.length) { showToast('추가할 준비물이 없습니다. 한 줄에 하나씩 적어 주세요.'); return 0; }
    commit();
    act('add', '준비물 ' + added.length + '개 추가 (' + added.slice(0, 3).join(', ') + (added.length > 3 ? ' 외' : '') + ')');
    return added.length;
  }
  // 한 분류의 준비물만 비우기(분류는 남김). 되돌리기 가능.
  function clearCategoryItems(id) {
    var cat = findCategory(id); if (!cat) return false;
    var removed = itemsOf(id);
    if (!removed.length) { showToast('‘' + cat.name + '’에는 삭제할 준비물이 없습니다.'); return false; }
    if (!window.confirm('‘' + cat.name + '’의 준비물 ' + removed.length + '개를 모두 삭제할까요? 분류는 남습니다.' + (window.ChecklistSync && window.ChecklistSync.getState().roomId ? '\n가족 공유 중이라 다른 기기에서도 함께 삭제됩니다.' : ''))) return false;
    state.items = state.items.filter(function (it) { return it.categoryId !== id; });
    ui.itemEdit = null; ui.qtyEdit = null;
    commit();
    act('delete', '‘' + cat.name + '’ 준비물 ' + removed.length + '개 삭제');
    showToast('‘' + cat.name + '’ 준비물 ' + removed.length + '개를 삭제했습니다.', function () {
      state.items = state.items.concat(removed); commit(); showToast('삭제를 취소했습니다.');
    });
    return true;
  }
  // 준비물 전체 비우기(분류·일지·택일·이름은 유지). 되돌리기 가능.
  function clearAllItems(auto) {
    var removed = state.items.slice();
    if (!removed.length) { if (!auto) showToast('비울 준비물이 없습니다.'); return false; }
    if (!auto) {
      var shared = !!(window.ChecklistSync && window.ChecklistSync.getState().roomId);
      var msg = '준비물 ' + removed.length + '개를 모두 삭제합니다. 분류·일지·택일·이름·메모는 그대로 둡니다.';
      if (shared) msg += '\n가족 공유 중이라 연결된 다른 기기에서도 함께 삭제됩니다.';
      msg += '\n계속하기 전에 JSON 백업 파일이 자동으로 저장됩니다. 삭제할까요?';
      if (!window.confirm(msg)) return false;
      try { exportJson(); } catch (e) { /* backup best-effort */ }
    }
    state.items = [];
    ui.itemEdit = null; ui.qtyEdit = null;
    commit();
    act('delete', (auto ? '기본 예시 준비물 ' : '준비물 ') + removed.length + '개 비움');
    showToast((auto ? '기본 예시 준비물 ' : '준비물 ') + removed.length + '개를 비웠습니다. 이제 직접 추가하세요.', function () {
      state.items = removed.concat(state.items); commit(); showToast('준비물을 되돌렸습니다.');
    });
    return true;
  }
  // 예전 버전이 채워 둔 예시 준비물을 한 번도 손대지 않았으면(체크·수량·메모·제외 없음) 자동으로 비운다.
  function isPristineTemplate(items) {
    if (items.length < 20) return false;
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (!TEMPLATE_NAMES[it.name] || it.done || it.excluded || it.price !== null || it.memo) return false;
    }
    return true;
  }
  // 예전 방식("윤서 슬리퍼", "윤서, 기준 마스크")으로 적힌 준비물을 한 번 태그로 분류하고,
  // '축복이 맞이 물품' 분류에 완료/미완료 탭을 켠다. 되돌리기 가능.
  function migrateTagsOnce() {
    if (ui.tagsMigrated) return;
    ui.tagsMigrated = true; saveUiPrefs();
    var changed = [];
    state.items.forEach(function (it) {
      if (it.tags && it.tags.length) return;
      var tp = parseTagPrefix(it.name);
      if (!tp.tags.length || !tp.rest) return;
      changed.push({ it: it, name: it.name, tags: it.tags.slice() });
      it.name = tp.rest.slice(0, 60); it.tags = tp.tags;
    });
    var catChanged = [];
    if (!state.categories.some(function (c) { return c.doneTabs; })) {
      state.categories.forEach(function (c) { if (/맞이\s*물품/.test(c.name)) { catChanged.push(c); c.doneTabs = true; } });
    }
    if (!changed.length && !catChanged.length) return;
    commit();
    if (changed.length) act('edit', '이름 태그 자동 분류 ' + changed.length + '개');
    var msg = (changed.length ? '준비물 ' + changed.length + '개의 이름을 태그(기준·윤서·축복)로 분류했습니다.' : '') + (catChanged.length ? ' ‘' + catChanged[0].name + '’에 완료/미완료 탭을 켰습니다.' : '');
    showToast(msg.trim(), function () {
      changed.forEach(function (c) { c.it.name = c.name; c.it.tags = c.tags; });
      catChanged.forEach(function (c) { c.doneTabs = false; });
      commit(); showToast('자동 분류를 되돌렸습니다.');
    });
  }
  // 상세 분류 자동 구성(한 번): 분류 이름으로 규칙을 고르고, 준비물 이름·태그로 상세 분류를 정한다. 되돌리기 가능.
  var SUB_RULES = [
    { cat: /병원/, subs: [
      ['👶🏻', '아기', function (it) { return it.tags.indexOf('축복') !== -1 && it.tags.indexOf('윤서') === -1; }],
      ['🤱🏻', '수유', /수유패드|모유|양배추|얼음팩|유두|별티/],
      ['🩹', '위생/회복', /안심|오버나이트|수건|세면|스킨케어|티슈|비데|마스크|소독|튼살|수세미|베라수/],
      ['👕', '의류/보온', /슬리퍼|양말|스타킹|복대|보호대|브래지어|팬티|가디건|퇴원복|여벌|침구|머리끈/],
      ['🔌', '편의/기타', null]
    ], order: ['의류/보온', '위생/회복', '수유', '아기', '편의/기타'] },
    { cat: /조리원/, subs: [
      ['👶🏻', '아기', function (it) { return it.tags.indexOf('축복') !== -1 && it.tags.indexOf('윤서') === -1; }],
      ['🧴', '위생/케어', /마스크팩|손톱깎이|빗|흉터|세정제/],
      ['👕', '의류', /여벌|옷/],
      ['🎒', '편의/기타', null]
    ], order: ['아기', '위생/케어', '의류', '편의/기타'] },
    { cat: /맞이/, subs: [
      ['🍼', '수유', /젖병|분유/],
      ['🧺', '세탁', /옷걸이|건조대|세제|세탁/],
      ['🛏️', '가구/수면', /옷장|수납장|침대|갈이대|베개|정리함/],
      ['🌡️', '가전/환경', /가습기|온습도계|베이비캠/],
      ['🛁', '위생/목욕', null]
    ], order: ['수유', '위생/목욕', '세탁', '가구/수면', '가전/환경'] },
    { cat: /동대문/, subs: [
      ['👕', '의류', /배냇|바디수트|양말|우주복|내복|조끼|스와들/],
      ['🧷', '기저귀/손수건', /기저귀|손수건/],
      ['🛏️', '침구/패드', null]
    ], order: ['의류', '침구/패드', '기저귀/손수건'] },
    { cat: /^기타$/, subs: [
      ['🚗', '외출', /카시트|아기띠|유모차|블랭킷/],
      ['🍼', '수유/건강', /분유|콧물/],
      ['🧸', '놀이/육아템', null]
    ], order: ['외출', '놀이/육아템', '수유/건강'] }
  ];
  function migrateSubsOnce() {
    if (ui.subsMigrated) return;
    ui.subsMigrated = true; saveUiPrefs();
    if (state.categories.some(function (c) { return subsOf(c).length; })) return; // 이미 누군가 구성함
    var done = [], count = 0;
    state.categories.forEach(function (cat) {
      var rule = null;
      SUB_RULES.forEach(function (r) { if (!rule && r.cat.test(cat.name)) rule = r; });
      var catItems = itemsOf(cat.id);
      if (!rule || !catItems.length) return;
      var byName = {};
      rule.subs.forEach(function (d) { byName[d[1]] = { id: uid(), name: d[1], icon: d[0] }; });
      var assigned = [];
      catItems.forEach(function (it) {
        var pick = null;
        rule.subs.forEach(function (d) {
          if (pick) return;
          var test = d[2];
          if (test === null || (typeof test === 'function' ? test(it) : test.test(it.name))) pick = byName[d[1]];
        });
        if (pick) { assigned.push({ it: it, prev: it.sub || '' }); it.sub = pick.id; count++; }
      });
      cat.subs = rule.order.map(function (n) { return byName[n]; }).filter(function (sb) { return catItems.some(function (it) { return it.sub === sb.id; }); });
      done.push({ cat: cat, assigned: assigned });
    });
    if (!done.length) return;
    commit();
    act('category', '상세 분류 자동 구성 (분류 ' + done.length + '개, 준비물 ' + count + '개)');
    showToast('준비물 ' + count + '개를 상세 분류로 나눴습니다. 편집에서 이름을 바꾸거나 옮길 수 있어요.', function () {
      done.forEach(function (x) { x.cat.subs = []; x.assigned.forEach(function (y) { y.it.sub = y.prev; }); });
      commit(); showToast('상세 분류 자동 구성을 되돌렸습니다.');
    });
  }
  function clearTemplateItemsOnce() {
    if (ui.templateCleared) return;
    ui.templateCleared = true; saveUiPrefs();
    if (isPristineTemplate(state.items)) clearAllItems(true);
  }

  function deleteItem(id) {
    var it = findItem(id);
    if (!it) return;
    var index = state.items.indexOf(it);
    state.items.splice(index, 1);
    commit();
    act('delete', '‘' + it.name + '’ 삭제');
    showToast('‘' + it.name + '’ 항목을 삭제했습니다.', function () {
      if (!findCategory(it.categoryId)) {
        showToast('원래 분류가 없어 복구할 수 없습니다.');
        return;
      }
      state.items.splice(Math.min(index, state.items.length), 0, it);
      commit();
      act('add', '‘' + it.name + '’ 삭제 취소');
      showToast('삭제를 취소했습니다.');
    });
  }

  function toggleDone(id, checked) {
    var it = findItem(id);
    if (!it || it.excluded) return;
    it.done = !!checked;
    commit();
    act(it.done ? 'check' : 'uncheck', '‘' + it.name + '’ ' + (it.done ? '체크' : '체크 해제'));
  }

  function toggleExcluded(id) {
    var it = findItem(id);
    if (!it) return;
    it.excluded = !it.excluded;
    commit();
    act('edit', '‘' + it.name + '’ ' + (it.excluded ? '준비 대상에서 제외' : '다시 포함'));
    showToast(it.excluded ? '‘' + it.name + '’ 항목을 준비 대상에서 제외했습니다.' : '‘' + it.name + '’ 항목을 다시 포함했습니다.');
  }

  function moveCategoryDir(id, dir) {
    var i = -1; for (var k = 0; k < state.categories.length; k++) if (state.categories[k].id === id) i = k;
    var j = i + dir;
    if (i < 0 || j < 0 || j >= state.categories.length) return;
    var tmp = state.categories[i]; state.categories[i] = state.categories[j]; state.categories[j] = tmp;
    commit();
  }

  function moveItemDir(id, dir) {
    var it = findItem(id);
    if (!it) return;
    var sib = itemsOf(it.categoryId);
    var pos = sib.map(function (x) { return x.id; }).indexOf(id);
    var target = sib[pos + dir];
    if (!target) return;
    var gi = state.items.indexOf(it), gj = state.items.indexOf(target);
    var tmp = state.items[gi]; state.items[gi] = state.items[gj]; state.items[gj] = tmp;
    commit();
  }

  function resetToDefault() {
    var shared = !!(window.ChecklistSync && window.ChecklistSync.getState().roomId);
    var msg = '현재 기록(준비물·진료 메모·택일·이름 등)을 모두 지우고 기본 목록으로 초기화합니다.';
    if (shared) msg += '\n가족 공유 중이라 연결된 다른 기기에도 초기화가 반영됩니다.';
    msg += '\n계속하기 전에 JSON 백업 파일이 자동으로 저장됩니다. 초기화할까요?';
    if (!window.confirm(msg)) return;
    try { exportJson(); } catch (e) { /* backup best-effort */ }
    state = createDefaultState();
    ui.activeCategory = null; ui.search = ''; ui.view = 'checklist';
    ui.editMode = false; ui.itemEdit = null; ui.qtyEdit = null;
    var sb = $('#item-search'); if (sb) sb.value = '';
    var sc = $('#search-clear'); if (sc) sc.hidden = true;
    saveUiPrefs();
    commit();
    act('reset', '기본 목록으로 초기화함');
    showToast('기본 목록으로 초기화했습니다. 백업 파일이 저장되었습니다.');
  }

  function moveItem(id, categoryId) {
    var it = findItem(id);
    if (!it || !findCategory(categoryId) || it.categoryId === categoryId) return;
    it.categoryId = categoryId;
    it.sub = '';
    ui.itemEdit = null;
    commit();
    act('edit', '‘' + it.name + '’ → ‘' + findCategory(categoryId).name + '’ 분류로 이동');
    showToast('‘' + it.name + '’ 항목을 ‘' + findCategory(categoryId).name + '’ 분류로 이동했습니다.');
  }

  // Field edits in edit mode: update state without a full re-render so focus/tab order is preserved.
  function updateItemField(id, field, inputEl, rowEl) {
    var it = findItem(id);
    if (!it) return;
    var errEl = $('[data-error]', rowEl);
    var setError = function (msg) {
      if (msg) { errEl.textContent = msg; errEl.hidden = false; }
      else { errEl.textContent = ''; errEl.hidden = true; }
    };
    switch (field) {
      case 'name': {
        var n = inputEl.value.trim();
        if (!n) { inputEl.value = it.name; setError('이름은 비워둘 수 없습니다. 이전 이름을 유지합니다.'); return; }
        it.name = n.slice(0, 60);
        setError('');
        break;
      }
      case 'price': {
        var pp = parsePrice(inputEl.value);
        if (!pp.ok) { inputEl.value = it.price === null ? '' : formatNumber(it.price); setError('금액은 비워두거나 숫자만 입력할 수 있습니다 (예: 5,000).'); return; }
        if (pp.value === it.price) { inputEl.value = pp.value === null ? '' : formatNumber(pp.value); setError(''); return; }
        it.price = pp.value;
        inputEl.value = pp.value === null ? '' : formatNumber(pp.value);
        setError('');
        break;
      }
      case 'memo':
        it.memo = inputEl.value.trim().slice(0, 200);
        break;
      case 'sub': {
        var fCat = findCategory(it.categoryId);
        it.sub = inputEl.value && fCat && findSub(fCat, inputEl.value) ? inputEl.value : '';
        setError('');
        break;
      }
      case 'tag': {
        var tg = inputEl.dataset.tag;
        var cur = (it.tags || []).slice();
        if (inputEl.checked && cur.indexOf(tg) === -1) cur.push(tg);
        if (!inputEl.checked) cur = cur.filter(function (x) { return x !== tg; });
        it.tags = normalizeTags(cur);
        var lab = inputEl.closest('.tag-pick'); if (lab) lab.classList.toggle('is-active', inputEl.checked);
        setError('');
        break;
      }
      default:
        return;
    }
    saveState();
    refreshProgress();
    if (field === 'name') act('edit', '‘' + it.name + '’ 이름 수정');
    else if (field === 'price') act('edit', '‘' + it.name + '’ 금액 ' + (qtyLabel(it) || '미입력') + '로 변경');
    else if (field === 'memo') act('edit', '‘' + it.name + '’ 메모 수정');
    else if (field === 'sub') { var aCat = findCategory(it.categoryId), aSub = aCat && findSub(aCat, it.sub); act('edit', '‘' + it.name + '’ 상세 분류 ' + (aSub ? aSub.name : '미분류') + '(으)로 변경'); }
    else if (field === 'tag') act('edit', '‘' + it.name + '’ 태그 ' + tagLabel(it) + '(으)로 변경');
    var qtyBtn = $('.item__qty', rowEl);
    if (qtyBtn) {
      var label = qtyLabel(it);
      if (label) qtyBtn.textContent = label; else qtyBtn.innerHTML = '<span aria-hidden="true">＋</span>';
      qtyBtn.classList.toggle('item__qty--empty', !label);
      qtyBtn.setAttribute('aria-label', it.name + ' 금액 ' + (label || '미입력') + ', 누르면 수정');
    }
  }

  // 금액 칸에 커서가 있는 채로 '완료' 등을 누르면 change 이벤트보다 render()가 먼저 칸을 지워
  // 입력한 금액이 사라진다(아이폰은 버튼을 눌러도 칸에서 포커스가 빠지지 않음). 다시 그리기 전에 먼저 반영한다.
  function flushPriceInputs() {
    Array.prototype.forEach.call(document.querySelectorAll('#categories input[data-field="price"]'), function (inp) {
      var r = inp.closest('[data-item-id]');
      if (r) updateItemField(r.dataset.itemId, 'price', inp, r);
    });
  }

  /* ---------- backup ---------- */
  function backupPayload(pretty) {
    return JSON.stringify({
      version: DATA_VERSION,
      exportedAt: new Date().toISOString(),
      categories: state.categories,
      items: state.items,
      notes: state.notes,
      highlights: state.highlights,
      picks: state.picks,
      dates: state.dates,
      names: state.names,
      dueDate: state.dueDate,
      anniversary: state.anniversary,
      memo: state.memo,
      memos: state.memos,
      supports: state.supports,
      ledger: state.ledger,
      budget: state.budget
    }, null, pretty ? 2 : 0);
  }

  function copyBackupText() {
    var text = backupPayload(false);
    var done = function () { showToast('백업 텍스트를 복사했습니다. 메신저 등으로 다른 기기에 보낸 뒤 ‘텍스트 붙여넣어 불러오기’에 붙여넣으세요.'); };
    var fail = function () {
      // Fallback: show the text so it can be selected and copied by hand.
      var panel = $('#paste-import');
      panel.hidden = false;
      var ta = $('#paste-import-text');
      ta.value = text;
      ta.focus();
      ta.select();
      showToast('자동 복사가 막혀 있어 텍스트를 표시했습니다. 전체 선택 후 복사하세요.');
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, fail);
    } else {
      fail();
    }
  }

  function importJsonText(text, sourceLabel) {
    var parsed;
    try {
      parsed = JSON.parse(String(text || '').trim());
    } catch (e) {
      showToast('JSON 형식이 아닙니다. 기존 기록은 그대로 유지됩니다.');
      return false;
    }
    var result = normalizeState(parsed);
    if (!result.ok) {
      showToast('불러올 수 없는 ' + sourceLabel + '입니다: ' + result.error + ' 기존 기록은 그대로 유지됩니다.');
      return false;
    }
    var msg = '현재 목록(분류 ' + state.categories.length + '개, 준비물 ' + state.items.length + '개, 진료 메모 ' + state.notes.length + '개)을 ' + sourceLabel + ' 내용(분류 ' + result.data.categories.length + '개, 준비물 ' + result.data.items.length + '개, 진료 메모 ' + result.data.notes.length + '개)으로 교체합니다. 기존 기록은 사라집니다. 계속할까요?';
    if (!window.confirm(msg)) { showToast('불러오기를 취소했습니다.'); return false; }
    state = result.data;
    ui.itemEdit = null; ui.qtyEdit = null; ui.noteForm = null; ui.highlightEdit = false;
    hideToast();
    commit();
    act('import', sourceLabel + '을 불러와 목록을 교체함');
    showToast(sourceLabel + '을 불러왔습니다.');
    return true;
  }

  function isStandalone() {
    return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
  }
  function exportJson() {
    var payload = backupPayload(true);
    var name = '출산가방-체크리스트-' + todayStamp() + '.json';
    var download = function () {
      var blob = new Blob([payload], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      showToast('JSON 파일을 내보냈습니다.');
    };
    // 홈 화면 웹앱(특히 아이폰)은 파일 다운로드가 막히는 경우가 있어 공유 시트('파일에 저장')를 먼저 시도한다.
    if (isStandalone() && navigator.share && navigator.canShare && typeof File === 'function') {
      try {
        var file = new File([payload], name, { type: 'application/json' });
        if (navigator.canShare({ files: [file] })) {
          navigator.share({ files: [file], title: name }).then(function () { showToast('백업 파일을 내보냈습니다.'); }, function (e) {
            if (e && e.name === 'AbortError') return; // 사용자가 취소
            download();
          });
          return;
        }
      } catch (e) { /* fall back to download */ }
    }
    download();
  }

  function importJsonFile(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onerror = function () { showToast('파일을 읽지 못했습니다. 기존 기록은 그대로 유지됩니다.'); };
    reader.onload = function () { importJsonText(String(reader.result), '백업 파일'); };
    reader.readAsText(file);
  }

  /* ---------- 가족 공유 (sync.js 연동) ---------- */
  var pendingRemote = null;

  function isTyping() {
    var el = document.activeElement;
    if (!el) return false;
    var tag = el.tagName;
    if (tag !== 'INPUT' && tag !== 'TEXTAREA') return false;
    if (el.readOnly || el.disabled) return false; // readonly share-link etc. must not block sync
    if (el.type === 'checkbox' || el.type === 'radio' || el.type === 'file' || el.type === 'button') return false;
    // Only editable fields inside an item/note/highlights editor should defer a remote update.
    return !!el.closest('.item--edit, .subs-manager, .is-qty-editing, .note-form, #highlights-form, #add-category-form, .pick-form, .date-form, .name-form, .support-form, .memo-detail, .note__comments, .rx-comments, #view-settings, #ledger-form, .ledger-budget-form');
  }

  var migrationsQueued = false;
  function scheduleOneTimeMigrations() {
    if (migrationsQueued || (ui.templateCleared && ui.tagsMigrated && ui.subsMigrated && ui.portalSeeded)) return;
    migrationsQueued = true;
    // 방 참여 직후에는 구독(attach)이 applyRemote 뒤에 붙으므로 한 틱 뒤에 실행한다.
    setTimeout(function () { migrationsQueued = false; if (isTyping()) return; clearTemplateItemsOnce(); migrateTagsOnce(); migrateSubsOnce(); seedFamilyDatesOnce(); }, 0);
  }
  function applyRemote(remoteState) {
    var result = normalizeState(remoteState);
    if (!result.ok) return false;
    // 서버와 내용이 같아도(이미 동기화된 기기) 한 번짜리 자동 정리는 실행되어야 한다
    if (JSON.stringify(result.data) === JSON.stringify(state)) { scheduleOneTimeMigrations(); return false; }
    if (isTyping()) { pendingRemote = remoteState; return false; } // apply after the field is left
    pendingRemote = null;
    applyingRemote = true;
    try {
      state = result.data;
      // keep UI editors pointing at things that still exist
      if (ui.itemEdit && !findItem(ui.itemEdit)) ui.itemEdit = null;
      if (ui.qtyEdit && !findItem(ui.qtyEdit)) ui.qtyEdit = null;
      if (ui.ledgerForm && ui.ledgerForm !== 'new' && !findEntry(ui.ledgerForm)) ui.ledgerForm = null;
      if (ui.noteForm && ui.noteForm !== 'new') {
        var still = state.notes.some(function (n) { return n.id === ui.noteForm; });
        if (!still) ui.noteForm = null;
      }
      saveState({ remote: true });
      render();
    } finally {
      applyingRemote = false;
    }
    // 방 참여 직후에는 구독(attach)이 applyRemote 뒤에 붙으므로, 비우기(=변경 전파)는 한 틱 뒤에 실행한다.
    scheduleOneTimeMigrations();
    return true;
  }

  document.addEventListener('focusout', function () {
    if (!pendingRemote) return;
    setTimeout(function () { if (pendingRemote && !isTyping()) applyRemote(pendingRemote); }, 0);
  });

  window.ChecklistApp = {
    getState: function () { return JSON.parse(JSON.stringify(state)); },
    normalize: function (raw) { var r = normalizeState(raw); return r.ok ? r.data : null; },
    isPristine: function () { return !touched; },
    applyRemote: applyRemote,
    onChange: function (cb) { changeListeners.push(cb); },
    getDeviceName: myName,
    setActivity: setActivity
  };

  function syncStatusText(st) {
    switch (st.status) {
      case 'unconfigured': return '';
      case 'off': return '';
      case 'connecting': return '연결 중…';
      case 'online': return '가족 공유 중';
      case 'offline': return '오프라인 (연결되면 동기화)';
      case 'error': return '동기화 오류';
      default: return '';
    }
  }

  function renderSharePanel() {
    var panel = $('#share-panel');
    var body = $('#share-body');
    var badge = $('#sync-status');
    var S = window.ChecklistSync;
    var st = S ? S.getState() : { configured: false, status: 'unconfigured', roomId: null, link: '' };
    var pillText = syncStatusText(st);
    if (!pillText) pillText = st.configured ? '공유 연결하기' : '기기 저장';
    badge.textContent = pillText;
    badge.className = 'sync-pill' + (st.status === 'online' ? ' is-online' : st.status === 'error' ? ' is-error' : st.status === 'offline' ? ' is-offline' : st.configured ? ' is-off' : ' is-local');
    badge.hidden = false;
    var pbadge = $('#portal-sync');
    if (pbadge) { pbadge.textContent = pillText; pbadge.className = badge.className + ' portal__sync'; }
    renderHome();
    var html = '';
    if (!st.configured) {
      html += '<p class="share__text">가족 공유를 쓰려면 사이트에 Firebase 설정이 필요합니다. 아직 설정되어 있지 않아 기록은 이 기기에만 저장됩니다.</p>';
      html += '<p class="share__text">설정 방법은 README의 ‘가족 공유(동기화) 설정’을 참고하세요.</p>';
    } else if (st.roomId) {
      html += '<p class="share__text">이 기기는 아래 링크와 연결되어 있습니다. 같은 링크를 연 기기끼리 체크리스트·진료 메모·꼭 기억하기가 실시간으로 함께 바뀝니다.</p>';
      html += '<div class="share__linkrow"><label class="visually-hidden" for="share-link">공유 링크</label><input type="text" id="share-link" readonly value="' + escapeHtml(st.link) + '"><button type="button" class="btn btn--small" data-action="copy-link">링크 복사</button></div>';
      html += '<div class="share__linkrow"><label class="visually-hidden" for="share-code">공유 코드</label><input type="text" id="share-code" readonly value="' + escapeHtml(st.roomId) + '"><button type="button" class="btn btn--small" data-action="copy-code">코드 복사</button></div>';
      html += '<p class="share__text share__text--muted">📱 홈 화면에 추가한 웹앱은 카톡 링크를 눌러도 연결되지 않습니다(아이폰은 링크를 사파리에서 엽니다). 웹앱을 연 뒤 설정 → 가족 공유에 위 코드를 붙여넣고 ‘참여’를 누르세요.</p>';
      html += '<p class="share__status">상태: ' + escapeHtml(syncStatusText(st) || '대기') + (st.detail ? ' · ' + escapeHtml(st.detail) : '') + (st.lastSyncedAt ? ' · 마지막 동기화 ' + escapeHtml(timeStampOf(st.lastSyncedAt)) : '') + '</p>';
      html += '<p class="share__text share__text--muted">링크를 아는 사람은 누구나 볼 수 있으니 가족에게만 보내세요. 카카오톡 등으로 보내고 받은 기기에서 링크를 열면 바로 연결됩니다.</p>';
      html += '<div class="note-form__actions"><button type="button" class="btn btn--small btn--danger" data-action="leave-room">이 기기에서 공유 끊기</button></div>';
    } else {
      html += '<p class="share__text">공유 링크를 만들면 지금 이 기기의 목록이 서버에 올라가고, 그 링크를 연 다른 기기와 실시간으로 함께 바뀝니다. 로그인은 필요 없습니다.</p>';
      html += '<div class="note-form__actions"><button type="button" class="btn btn--primary btn--small" data-action="create-room">공유 링크 만들기</button></div>';
      html += '<p class="share__text" style="margin-top:10px">이미 받은 링크나 코드가 있다면 여기에 붙여넣으세요.</p>';
      html += '<form class="share__linkrow" data-action="join-room"><label class="visually-hidden" for="join-link">받은 공유 링크 또는 코드</label><input type="text" id="join-link" placeholder="공유 링크 또는 코드 붙여넣기" autocomplete="off" autocapitalize="off" autocorrect="off"><button type="submit" class="btn btn--small">참여</button></form>';
      html += '<p class="share__text share__text--muted">홈 화면 웹앱에서는 카톡 링크를 눌러도 연결되지 않으니, 링크(또는 코드)를 복사해 여기에 붙여넣고 참여하세요.</p>';
      if (st.status === 'error' && st.detail) html += '<p class="field-error">' + escapeHtml(st.detail) + '</p>';
      if (st.status === 'connecting') html += '<p class="share__status">연결 중…</p>';
    }
    body.innerHTML = html;
  }

  function timeStampOf(d) {
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function openSharePanel() {
    setView('settings');
    renderSharePanel();
    var panel = $('#share-panel');
    if (panel) {
      panel.scrollIntoView({ block: 'start' });
      var first = panel.querySelector('button[data-action], input');
      if (first) first.focus({ preventScroll: true });
    }
  }
  function closeMenu() { var m = $('#backup-menu'); if (m) m.open = false; }

  function bindShareEvents() {
    document.addEventListener('click', function (e) {
      var t = e.target.closest('[data-action="open-share"], [data-action="open-settings"], [data-action="open-supports"], [data-action="go-home"], [data-action="go-portal"], [data-action="go-ledger"], [data-action="space-back"]');
      if (!t) return;
      closeMenu();
      var a = t.dataset.action;
      if (a === 'open-share') openSharePanel();
      else if (a === 'open-settings') setView('settings');
      else if (a === 'open-supports') setView('supports');
      else if (a === 'go-home') setView('home');
      else if (a === 'go-portal') setView('portal');
      else if (a === 'go-ledger') setView('ledger');
      else if (a === 'space-back') setView(ui.view === 'settings' && ui.settingsFrom === 'ledger' ? 'ledger' : 'portal');
    });
    $('#share-panel').addEventListener('click', function (e) {
      var btn = e.target.closest('[data-action]');
      if (!btn || btn.tagName !== 'BUTTON') return;
      var S = window.ChecklistSync;
      switch (btn.dataset.action) {
        case 'create-room':
          ensureDeviceName();
          S.createRoom().then(function () { showToast('공유 링크를 만들었습니다. 링크를 복사해 가족에게 보내세요.'); }, function () { /* status shows the error */ });
          break;
        case 'copy-link':
        case 'copy-code': {
          var isCode = btn.dataset.action === 'copy-code';
          var linkEl = $(isCode ? '#share-code' : '#share-link');
          var text = linkEl.value;
          var done = function () { showToast(isCode ? '공유 코드를 복사했습니다. 웹앱의 설정 → 가족 공유에 붙여넣으세요.' : '공유 링크를 복사했습니다.'); };
          var fail = function () { linkEl.focus(); linkEl.select(); showToast('자동 복사가 막혀 있습니다. 직접 선택해 복사하세요.'); };
          if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fail); else fail();
          break;
        }
        case 'leave-room':
          if (window.confirm('이 기기에서 공유를 끊을까요? 서버의 목록은 그대로 남고, 이 기기는 지금 내용을 따로 저장합니다.')) {
            S.leaveRoom();
            showToast('공유를 끊었습니다. 이 기기 기록은 그대로 유지됩니다.');
          }
          break;
      }
    });
    $('#share-panel').addEventListener('submit', function (e) {
      var form = e.target.closest('form[data-action="join-room"]');
      if (!form) return;
      e.preventDefault();
      var S = window.ChecklistSync;
      var id = S.extractRoomId($('#join-link').value);
      if (!id) { showToast('올바른 공유 링크나 코드가 아닙니다.'); return; }
      ensureDeviceName();
      S.joinRoom(id).then(function (joined) {
        if (joined) showToast('공유 링크에 참여했습니다.');
      }, function () { /* status shows the error */ });
    });
    if (window.ChecklistSync) window.ChecklistSync.onStatus(function () { renderSharePanel(); });
    renderSharePanel();

    document.addEventListener('click', function (e) {
      var at = e.target.closest('[data-action="archive-tab"]');
      if (at) { ui.archiveTab = at.dataset.tab === 'like' ? 'like' : 'fav'; saveUiPrefs(); renderArchive(); return; }
      var ao = e.target.closest('[data-action="archive-open"]');
      if (ao) {
        var k = ao.dataset.kind;
        if (k === 'note') openNote(ao.dataset.id, 'archive'); else if (k === 'memo') openMemo(ao.dataset.id, 'archive'); else jumpToCard(k, ao.dataset.id);
      }
    });
    document.addEventListener('click', function (e) {
      var sw = e.target.closest('[data-action="switch-view"]');
      if (!sw) return;
      setView(sw.dataset.target);
      var again = document.querySelector('#view-' + sw.dataset.target + ' .view-switch__btn.is-active'); if (again) again.focus();
    });
    var ptabs = $('#primary-tabs');
    if (ptabs) {
      ptabs.addEventListener('click', function (e) {
        var btn = e.target.closest('.primary-tab');
        if (!btn) return;
        if (btn.dataset.group === 'record') {
          if (ui.view === 'memos' && ui.memoOpen) { closeMemo(); ui.detailFrom = null; renderMemo(); window.scrollTo(0, 0); }
          else if (ui.view === 'notes' && ui.noteOpen) { closeNote(); renderNotes(); window.scrollTo(0, 0); }
          else setView(ui.recordTab);
        }
        else if (btn.dataset.group === 'plan') setView(ui.planTab);
        else setView(btn.dataset.view);
      });
      ptabs.addEventListener('keydown', function (e) {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        e.preventDefault();
        setView(ui.view === 'checklist' ? 'notes' : 'checklist');
        var active = ptabs.querySelector('.primary-tab.is-active');
        if (active) active.focus();
      });
    }
  }

  /* ---------- event wiring ---------- */
  function goHome() {
    ui.view = 'checklist';
    if (state.categories.length) ui.activeCategory = state.categories[0].id;
    ui.filter = 'all';
    ui.editMode = false;
    ui.qtyEdit = null;
    ui.itemEdit = null;
    ui.picksEdit = null;
    ui.search = '';
    var homeSearch = $('#item-search'); if (homeSearch) homeSearch.value = '';
    var homeClear = $('#search-clear'); if (homeClear) homeClear.hidden = true;
    ui.noteForm = null;
    ui.highlightEdit = false;
    var fsel = $('#filter-select'); if (fsel) fsel.value = 'all';
    var addForm = $('#add-category-form'); if (addForm) addForm.hidden = true;
    var paste = $('#paste-import'); if (paste) paste.hidden = true;
    closeMenu();
    saveUiPrefs();
    render();
    window.scrollTo(0, 0);
  }

  function bindEvents() {
    $('#filter-group').addEventListener('change', function (e) {
      if (e.target.name === 'filter') { ui.filter = e.target.value; render(); }
    });

    Array.prototype.forEach.call(document.querySelectorAll('[data-edit-toggle]'), function (b) {
      b.addEventListener('click', function () {
        ui.editMode = !ui.editMode;
        ui.qtyEdit = null;
        ui.itemEdit = null;
        if (ui.editMode) { ui.search = ''; var si = $('#item-search'); if (si) si.value = ''; var sc = $('#search-clear'); if (sc) sc.hidden = true; }
        render();
      });
    });

    function openAddCategory(toggle) {
      var form = $('#add-category-form');
      form.hidden = toggle ? !form.hidden : false;
      if (!form.hidden) {
        $('#paste-import').hidden = true;
        $('#new-category-name').focus();
        form.scrollIntoView({ block: 'nearest' });
      }
    }
    var addCatBtn = $('#add-category-btn');
    if (addCatBtn) addCatBtn.addEventListener('click', function () { openAddCategory(true); });
    $('#category-tabs').addEventListener('click', function (e) {
      if (e.target.closest('[data-action="add-category-tab"]')) openAddCategory(false);
    });
    $('#add-category-cancel').addEventListener('click', function () {
      $('#add-category-form').hidden = true;
      $('#new-category-name').value = '';
      var back = $('#add-category-btn') || $('.category-tab--add'); if (back) back.focus();
    });
    $('#add-category-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var input = $('#new-category-name');
      if (addCategory(input.value)) {
        input.value = '';
        $('#add-category-form').hidden = true;
        var back2 = $('#add-category-btn') || $('.category-tab--add'); if (back2) back2.focus();
      }
    });

    $('#export-btn').addEventListener('click', function () { closeMenu(); exportJson(); });
    $('#import-btn').addEventListener('click', function () { closeMenu(); $('#import-file').click(); });
    var searchToggle = $('#search-toggle');
    if (searchToggle) {
      searchToggle.addEventListener('click', function () {
        ui.searchOpen = !ui.searchOpen;
        if (!ui.searchOpen) { ui.search = ''; var si0 = $('#item-search'); if (si0) si0.value = ''; var sc0 = $('#search-clear'); if (sc0) sc0.hidden = true; }
        render();
        if (ui.searchOpen) { var si1 = $('#item-search'); if (si1) si1.focus(); }
      });
    }
    var homeView = $('#view-home');
    if (homeView) {
      homeView.addEventListener('click', function (e) {
        var b = e.target.closest('[data-action]');
        if (!b) return;
        switch (b.dataset.action) {
          case 'go-checklist': setView('checklist'); break;
          case 'go-category': ui.activeCategory = b.dataset.categoryId; ui.collapsed[b.dataset.categoryId] = false; delete ui.collapsed[b.dataset.categoryId]; setView('checklist'); break;
          case 'mb-open': setView(b.dataset.target === 'plan' ? ui.planTab : b.dataset.target); break;
          case 'mb-soon': showToast('‘' + b.dataset.label + '’은(는) 준비 중이에요. 곧 열어 드릴게요.'); break;
        }
      });
    }
    var strip = $('#highlights-strip');
    if (strip) strip.addEventListener('click', function () { ui.stripOpen = !ui.stripOpen; renderHighlightsStrip(); });

    // 포털: 공간 열기
    var portalView = $('#view-portal');
    if (portalView) {
      portalView.addEventListener('click', function (e) {
        var b = e.target.closest('[data-action]');
        if (!b) return;
        if (b.dataset.action === 'open-space') setView(b.dataset.space === 'ledger' ? 'ledger' : 'home');
        else if (b.dataset.action === 'add-space') showToast('새 공간은 준비 중이에요. 필요한 공간을 알려 주시면 만들어 드릴게요.');
      });
    }

    // 가계부
    var ledgerView = $('#view-ledger');
    if (ledgerView) {
      ledgerView.addEventListener('click', function (e) {
        var b = e.target.closest('[data-action]');
        if (!b) return;
        switch (b.dataset.action) {
          case 'ledger-month': {
            var by = parseInt(b.dataset.by, 10);
            ui.ledgerMonth = by ? shiftMonth(ledgerMonth(), by) : currentMonth();
            renderLedger();
            var again = ledgerView.querySelector('[data-action="ledger-month"][data-by="' + b.dataset.by + '"]');
            if (again) again.focus({ preventScroll: true });
            break;
          }
          case 'ledger-new': openLedgerForm(null); break;
          case 'ledger-edit': openLedgerForm(b.dataset.id); break;
          case 'ledger-close': closeLedgerForm(); break;
          case 'ledger-delete': {
            var de = findEntry(ui.ledgerForm);
            if (de && window.confirm('‘' + (de.text || de.cat) + ' ' + formatWon(de.amount) + '’ 기록을 지울까요?')) deleteLedgerEntry(de.id);
            break;
          }
          case 'ledger-budget-edit': ui.budgetEdit = true; renderLedger(); var bi = $('#ledger-budget-input'); if (bi) bi.focus(); break;
          case 'ledger-budget-cancel': ui.budgetEdit = false; renderLedger(); break;
          case 'ledger-budget-clear': $('#ledger-budget-input').value = ''; saveBudget(); break;
        }
      });
      ledgerView.addEventListener('submit', function (e) {
        if (e.target.id === 'ledger-form') { e.preventDefault(); submitLedgerForm(e.target); }
        else if (e.target.dataset.action === 'ledger-budget') { e.preventDefault(); saveBudget(); }
      });
      ledgerView.addEventListener('change', function (e) {
        if (e.target.name !== 'type') return;
        ui.ledgerType = e.target.value === 'in' ? 'in' : 'out';
        var chips = $('#ledger-cat-chips');
        if (chips) chips.innerHTML = ledgerChips('cat', ui.ledgerType === 'in' ? LEDGER_IN_CATS : LEDGER_OUT_CATS, ui.ledgerType === 'in' ? '급여' : '식비');
      });
      ledgerView.addEventListener('input', function (e) {
        if (e.target.hasAttribute('data-price-input') && !e.isComposing) formatPriceInput(e.target);
      });
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && ui.ledgerForm && ui.view === 'ledger') { e.preventDefault(); closeLedgerForm(); }
      });
      // 화면 키보드가 올라오면 그 높이만큼 시트를 올린다(iOS는 화면 크기가 줄지 않음)
      if (window.visualViewport) {
        var setKb = function () {
          var vv = window.visualViewport;
          var kb = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
          document.documentElement.style.setProperty('--kb', kb + 'px');
        };
        window.visualViewport.addEventListener('resize', setKb);
        window.visualViewport.addEventListener('scroll', setKb);
      }
    }

    // 메모: 목록 → 상세(읽기/수정), 댓글·좋아요·즐겨찾기
    var memosView = $('#view-memos');
    if (memosView) {
      memosView.addEventListener('input', function (e) {
        if (e.target.id === 'memo-edit-input') ui.memoDraft = e.target.value;
        else if (e.target.id === 'memo-comment-input') ui.commentDraft = e.target.value;
      });
      memosView.addEventListener('submit', function (e) {
        var f = e.target.closest('form[data-action="memo-comment"]'); if (!f) return;
        e.preventDefault();
        if (addMemoComment(ui.memoOpen, $('#memo-comment-input').value)) { var ci = $('#memo-comment-input'); if (ci) ci.focus(); }
      });
      memosView.addEventListener('click', function (e) {
        var b = e.target.closest('button[data-action]'); if (!b) return;
        var card = b.closest('[data-memo-id]');
        var id = card ? card.dataset.memoId : ui.memoOpen;
        switch (b.dataset.action) {
          case 'new-memo': newMemo(); break;
          case 'memo-open': openMemo(id); break;
          case 'memo-back': {
            var was = ui.memoOpen, fromArchive = ui.detailFrom === 'archive';
            closeMemo(); ui.detailFrom = null;
            if (fromArchive) { setView('settings'); var ab = document.querySelector('[data-focus-key="arch:memo:' + was + '"]'); if (ab) { ab.focus(); ab.scrollIntoView({ block: 'center' }); } break; }
            renderMemo(); window.scrollTo(0, 0); var back = document.querySelector('[data-focus-key="memo-open:' + was + '"]'); if (back) back.focus(); break;
          }
          case 'memo-fav': if (id && id !== 'new') toggleMemoFav(id); break;
          case 'memo-edit': { var m = findMemo(id); if (!m) break; ui.memoEdit = true; ui.memoDraft = m.text; renderMemo(); var ta = $('#memo-edit-input'); if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); } break; }
          case 'memo-save': {
            var sm = ui.memoOpen !== 'new' ? findMemo(ui.memoOpen) : null;
            if (!String(ui.memoDraft).trim() && !(sm && sm.tables.length)) { showToast('내용을 입력하세요.'); var t2 = $('#memo-edit-input'); if (t2) t2.focus(); break; }
            if (!saveMemoEdit(false)) renderMemo();
            break;
          }
          case 'memo-cancel': {
            if (ui.memoOpen === 'new') { ui.memoOpen = null; }
            ui.memoEdit = false; ui.memoDraft = ''; renderMemo();
            break;
          }
          case 'memo-delete': deleteMemo(id); break;
          case 'memo-like': toggleMemoLike(id); break;
          case 'memo-comment-del': deleteMemoComment(ui.memoOpen, b.closest('[data-comment-id]').dataset.commentId); break;
          case 'table-add': addMemoTable(ui.memoOpen); break;
          case 'table-row-add': case 'table-col-add': case 'table-row-del': case 'table-col-del': case 'table-del':
            tableAction(ui.memoOpen, b.closest('[data-table-id]').dataset.tableId, b.dataset.action); break;
        }
      });
      // 표: 칸 선택 표시, 칸에서 나갈 때 저장, 붙여넣기는 글자만
      var cellInfo = function (el) { var t = el.closest('[data-table-id]'); return { tid: t.dataset.tableId, r: Number(el.dataset.r), c: Number(el.dataset.c) }; };
      memosView.addEventListener('focusin', function (e) {
        var cell = e.target.closest ? e.target.closest('.mtable__cell') : null; if (!cell) return;
        var ci = cellInfo(cell);
        ui.tableSel = { t: ci.tid, r: ci.r, c: ci.c };
        Array.prototype.forEach.call(memosView.querySelectorAll('.mtable td.is-sel'), function (td) { td.classList.remove('is-sel'); });
        cell.parentNode.classList.add('is-sel');
      });
      memosView.addEventListener('focusout', function (e) {
        var cell = e.target.closest ? e.target.closest('.mtable__cell') : null; if (!cell || !ui.memoOpen) return;
        var ci = cellInfo(cell);
        saveTableCell(ui.memoOpen, ci.tid, ci.r, ci.c, cell.innerText);
      });
      memosView.addEventListener('paste', function (e) {
        var cell = e.target.closest ? e.target.closest('.mtable__cell') : null; if (!cell) return;
        e.preventDefault();
        var txt = (e.clipboardData || window.clipboardData).getData('text').replace(/\r\n?/g, '\n');
        if (document.queryCommandSupported && document.queryCommandSupported('insertText')) document.execCommand('insertText', false, txt);
        else cell.textContent += txt;
      });
      // 표: 선을 끌어 열 너비 / 행 높이 조절 (마우스·터치 공통)
      var gripDrag = null;
      memosView.addEventListener('pointerdown', function (e) {
        var g = e.target.closest ? e.target.closest('[data-grip]') : null; if (!g || !ui.memoOpen) return;
        var tEl = g.closest('[data-table-id]'); var m = findMemo(ui.memoOpen); var t = m && findTable(m, tEl.dataset.tableId); if (!t) return;
        e.preventDefault();
        if (document.activeElement && document.activeElement.classList && document.activeElement.classList.contains('mtable__cell')) document.activeElement.blur();
        var isCol = g.dataset.grip === 'col', i = Number(g.dataset.i);
        gripDrag = { isCol: isCol, i: i, t: t, m: m, el: tEl, start: isCol ? e.clientX : e.clientY, size: isCol ? t.cols[i] : t.rowH[i], now: isCol ? t.cols[i] : t.rowH[i], pointerId: e.pointerId, grip: g };
        tEl.classList.add(isCol ? 'is-col-resizing' : 'is-row-resizing');
        try { g.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      });
      memosView.addEventListener('pointermove', function (e) {
        if (!gripDrag || e.pointerId !== gripDrag.pointerId) return;
        e.preventDefault();
        var d = (gripDrag.isCol ? e.clientX : e.clientY) - gripDrag.start;
        if (gripDrag.isCol) {
          var w = Math.max(COL_W_MIN, Math.min(COL_W_MAX, Math.round(gripDrag.size + d)));
          gripDrag.now = w;
          var cols = gripDrag.el.querySelectorAll('col'); if (cols[gripDrag.i]) cols[gripDrag.i].style.width = w + 'px';
          var total = gripDrag.t.cols.reduce(function (a, b, k) { return a + (k === gripDrag.i ? w : b); }, 0);
          gripDrag.el.querySelector('table').style.width = total + 'px';
        } else {
          var hgt = Math.max(ROW_H_MIN, Math.min(ROW_H_MAX, Math.round(gripDrag.size + d)));
          gripDrag.now = hgt;
          var tr = gripDrag.el.querySelectorAll('tr')[gripDrag.i];
          if (tr) Array.prototype.forEach.call(tr.querySelectorAll('.mtable__cell'), function (c) { c.style.minHeight = hgt + 'px'; });
        }
      });
      var endGrip = function (e) {
        if (!gripDrag || (e && e.pointerId !== gripDrag.pointerId)) return;
        var g = gripDrag; gripDrag = null;
        g.el.classList.remove('is-col-resizing', 'is-row-resizing');
        try { g.grip.releasePointerCapture(g.pointerId); } catch (err) { /* ignore */ }
        if (g.now === g.size) return;
        if (g.isCol) g.t.cols[g.i] = g.now; else g.t.rowH[g.i] = g.now;
        touchMemo(g.m); saveState();
      };
      memosView.addEventListener('pointerup', endGrip);
      memosView.addEventListener('pointercancel', endGrip);
      memosView.addEventListener('touchmove', function (e) { if (gripDrag) e.preventDefault(); }, { passive: false });
      // 앱 전환·화면 끔·탭 닫기: 적던 메모를 잃지 않도록 저장
      var flushMemoDraft = function () {
        var ae = document.activeElement;
        if (ae && ae.classList && ae.classList.contains('mtable__cell') && ui.memoOpen) { var fi = cellInfo(ae); saveTableCell(ui.memoOpen, fi.tid, fi.r, fi.c, ae.innerText); }
        if (ui.memoEdit && String(ui.memoDraft).trim()) saveMemoEdit(true);
      };
      document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') flushMemoDraft(); });
      window.addEventListener('pagehide', flushMemoDraft);
    }
    document.addEventListener('click', function (e) {
      var t = e.target.closest('[data-action="open-memos"], [data-action="new-memo-home"], [data-action="open-memo"]');
      if (!t) return;
      if (t.dataset.action === 'new-memo-home') { newMemo(); return; }
      if (t.dataset.action === 'open-memo') { openMemo(t.dataset.memoId); return; }
      closeMemo(); setView('memos'); renderMemo();
    });

    // 설정
    var dnInput = $('#device-name');
    if (dnInput) dnInput.addEventListener('change', function () { ui.deviceName = dnInput.value.trim().slice(0, 12); saveUiPrefs(); renderArchive(); showToast('이름을 저장했습니다.'); });
    var ddInput = $('#due-date');
    if (ddInput) ddInput.addEventListener('change', function () {
      var v = ddInput.value; if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) v = '';
      if (v === (state.dueDate || '')) return;
      state.dueDate = v; commit(); act('due', v ? '출산 예정일을 ' + formatNoteDate(v) + '로 설정' : '출산 예정일 지움');
      showToast(v ? '출산 예정일을 저장했습니다. ' + ddayText(v) : '출산 예정일을 지웠습니다.');
    });
    var anInput = $('#anniversary');
    if (anInput) anInput.addEventListener('change', function () {
      var v = anInput.value; if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) v = '';
      if (v === (state.anniversary || '')) return;
      state.anniversary = v; commit(); act('due', v ? '결혼기념일을 ' + formatNoteDate(v) + '로 설정' : '결혼기념일 지움');
      showToast(v ? '결혼기념일을 저장했습니다.' : '결혼기념일을 지웠습니다.');
    });
    var trInput = $('#toast-remote');
    if (trInput) trInput.addEventListener('change', function () { ui.toastRemote = trInput.checked; saveUiPrefs(); });

    // 정부 지원
    var supView = $('#view-supports');
    if (supView) {
      supView.addEventListener('click', function (e) {
        var add = e.target.closest('#add-support-btn');
        if (add) { ui.supportEdit = 'new'; renderSupports(); var f = document.querySelector('[data-focus-key="sp-title:new"]'); if (f) f.focus(); return; }
        var btn = e.target.closest('button[data-action]'); if (!btn) return;
        var li = btn.closest('[data-support-id]');
        switch (btn.dataset.action) {
          case 'edit-support': ui.supportEdit = li.dataset.supportId; renderSupports(); var ff = document.querySelector('[data-focus-key="sp-title:' + li.dataset.supportId + '"]'); if (ff) ff.focus(); break;
          case 'cancel-support': ui.supportEdit = null; renderSupports(); var back = li ? document.querySelector('[data-focus-key="sp-edit:' + li.dataset.supportId + '"]') : $('#add-support-btn'); if (back) back.focus(); break;
          case 'delete-support': deleteSupport(li.dataset.supportId); break;
        }
      });
      supView.addEventListener('submit', function (e) {
        var form = e.target.closest('form[data-support-form]'); if (!form) return;
        e.preventDefault(); submitSupportForm(form);
      });
      supView.addEventListener('change', function (e) {
        var sel = e.target.closest('select[data-action="quick-status"]'); if (!sel) return;
        var li = sel.closest('[data-support-id]'); var sp = findSupport(li.dataset.supportId); if (!sp) return;
        if (SUPPORT_STATUS.indexOf(sel.value) === -1) return;
        sp.status = sel.value; commit(); act('support', '지원 항목 ‘' + sp.title + '’ 상태 → ' + SUPPORT_STATUS_LABEL[sp.status]);
      });
    }
    var searchInput = $('#item-search');
    if (searchInput) {
      searchInput.addEventListener('input', function () { ui.search = searchInput.value; renderCategories(); $('#search-clear').hidden = !ui.search; });
      var clearBtn = $('#search-clear');
      if (clearBtn) clearBtn.addEventListener('click', function () { ui.search = ''; searchInput.value = ''; clearBtn.hidden = true; searchInput.focus(); renderCategories(); });
    }
    var clearItemsBtn = $('#clear-items-btn');
    if (clearItemsBtn) clearItemsBtn.addEventListener('click', function () { clearAllItems(false); });
    var clearItemsBtn2 = $('#clear-items-btn-2');
    if (clearItemsBtn2) clearItemsBtn2.addEventListener('click', function () { clearAllItems(false); });
    var clearSubsBtn = $('#clear-subs-btn');
    if (clearSubsBtn) clearSubsBtn.addEventListener('click', function () { clearSubs(null); });
    var clearCatBtn = $('#clear-category-btn');
    if (clearCatBtn) clearCatBtn.addEventListener('click', function () { var cid = activeCategoryId(); if (cid) clearCategoryItems(cid); });
    var resetBtn = $('#reset-btn');
    if (resetBtn) resetBtn.addEventListener('click', function () { closeMenu(); resetToDefault(); });
    $('#copy-text-btn').addEventListener('click', function () { closeMenu(); copyBackupText(); });
    $('#paste-text-btn').addEventListener('click', function () {
      closeMenu();
      $('#add-category-form').hidden = true;
      var panel = $('#paste-import');
      panel.hidden = false;
      $('#paste-import-text').value = '';
      $('#paste-import-text').focus();
      panel.scrollIntoView({ block: 'nearest' });
    });
    $('#paste-import-cancel').addEventListener('click', function () {
      $('#paste-import').hidden = true;
      $('#paste-import-text').value = '';
      var pb = $('#paste-text-btn'); if (pb) pb.focus();
    });
    $('#paste-import').addEventListener('submit', function (e) {
      e.preventDefault();
      var text = $('#paste-import-text').value;
      if (!text.trim()) { showToast('붙여넣은 내용이 없습니다.'); return; }
      if (importJsonText(text, '백업 텍스트')) {
        $('#paste-import').hidden = true;
        $('#paste-import-text').value = '';
      }
    });
    $('#import-file').addEventListener('change', function (e) {
      var file = e.target.files && e.target.files[0];
      importJsonFile(file);
      e.target.value = '';
    });
    document.addEventListener('click', function (e) {
      var menu = $('#backup-menu');
      if (menu && menu.open && !menu.contains(e.target)) menu.open = false;
    });

    $('#toast-undo').addEventListener('click', function () {
      var fn = ui.pendingUndo;
      hideToast();
      if (fn) fn();
    });
    $('#toast-close').addEventListener('click', hideToast);

    $('#category-tabs').addEventListener('click', function (e) {
      var tab = e.target.closest('[data-action="select-tab"]');
      if (!tab) return;
      setActiveCategory(tab.dataset.categoryId);
      var again = document.querySelector('[data-focus-key="tab:' + tab.dataset.categoryId + '"]');
      if (again) again.focus();
    });
    $('#category-tabs').addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      var tabs = Array.prototype.slice.call(document.querySelectorAll('#category-tabs [role="tab"]'));
      var idx = tabs.indexOf(document.activeElement);
      if (idx < 0) return;
      e.preventDefault();
      var next = tabs[(idx + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
      setActiveCategory(next.dataset.categoryId);
      var again = document.querySelector('[data-focus-key="tab:' + next.dataset.categoryId + '"]');
      if (again) again.focus();
    });

    $('#highlights-toggle').addEventListener('click', toggleHighlightsCollapsed);

    $('#highlights-edit-btn').addEventListener('click', function () {
      if (ui.highlightsCollapsed) { ui.highlightsCollapsed = false; saveUiPrefs(); }
      ui.highlightEdit = true;
      renderHighlights();
      var ta = $('#highlights-input');
      if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
    });
    $('#highlights').addEventListener('submit', function (e) {
      if (e.target.id !== 'highlights-form') return;
      e.preventDefault();
      saveHighlights($('#highlights-input').value);
    });
    $('#highlights').addEventListener('click', function (e) {
      var btn = e.target.closest('[data-action="cancel-highlights"]');
      if (!btn) return;
      ui.highlightEdit = false;
      renderHighlights();
      $('#highlights-edit-btn').focus();
    });
    $('#highlights').addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && e.target.id === 'highlights-input') {
        ui.highlightEdit = false;
        renderHighlights();
        $('#highlights-edit-btn').focus();
      }
    });

    var notesRoot = $('#view-notes');
    $('#add-note-btn').addEventListener('click', function () {
      ui.noteForm = 'new';
      renderNotes();
      var ta = document.querySelector('[data-focus-key="note-body:new"]');
      if (ta) ta.focus();
    });
    notesRoot.addEventListener('submit', function (e) {
      var cform = e.target.closest('form[data-action="note-comment"]');
      if (cform) {
        e.preventDefault();
        var cid = cform.closest('[data-note-id]').dataset.noteId;
        if (addNoteComment(cid, $('input', cform).value)) { var again = document.querySelector('[data-focus-key="note-comment:' + cid + '"]'); if (again) again.focus(); }
        return;
      }
      var form = e.target.closest('form[data-note-form]');
      if (!form) return;
      e.preventDefault();
      submitNoteForm(form);
    });
    notesRoot.addEventListener('input', function (e) {
      if (e.target.dataset.role !== 'note-comment-input') return;
      ui.noteCommentDraft[e.target.closest('[data-note-id]').dataset.noteId] = e.target.value;
    });
    notesRoot.addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-action]');
      if (!btn) return;
      var li = btn.closest('[data-note-id]');
      switch (btn.dataset.action) {
        case 'cancel-note':
          ui.noteForm = null;
          renderNotes();
          var back = li ? document.querySelector('[data-focus-key="note-edit:' + li.dataset.noteId + '"]') : $('#add-note-btn');
          if (back) back.focus();
          break;
        case 'edit-note': ui.noteForm = li.dataset.noteId; renderNotes(); var ta = document.querySelector('[data-focus-key="note-body:' + li.dataset.noteId + '"]'); if (ta) ta.focus(); break;
        case 'delete-note': deleteNote(li.dataset.noteId); break;
        case 'note-open': openNote(li.dataset.noteId); break;
        case 'note-back': {
          var nwas = ui.noteOpen, nFromArchive = ui.detailFrom === 'archive';
          closeNote();
          if (nFromArchive) { setView('settings'); var nab = document.querySelector('[data-focus-key="arch:note:' + nwas + '"]'); if (nab) { nab.focus(); nab.scrollIntoView({ block: 'center' }); } break; }
          renderNotes(); window.scrollTo(0, 0);
          var nback = document.querySelector('[data-focus-key="note-open:' + nwas + '"]'); if (nback) nback.focus();
          break;
        }
        case 'note-fav': toggleNoteFav(li.dataset.noteId); break;
        case 'note-like': toggleNoteLike(li.dataset.noteId); break;
        case 'note-comments': {
          var nid = li.dataset.noteId;
          if (ui.noteComments[nid]) delete ui.noteComments[nid]; else ui.noteComments[nid] = true;
          renderNotes();
          var f = document.querySelector('[data-focus-key="' + (ui.noteComments[nid] ? 'note-comment:' : 'note-cbtn:') + nid + '"]'); if (f) f.focus();
          break;
        }
        case 'note-comment-del': deleteNoteComment(li.dataset.noteId, btn.closest('[data-comment-id]').dataset.commentId); break;
      }
    });

    var picksRoot = $('#view-picks');
    if (picksRoot) {
      picksRoot.addEventListener('keydown', function (e) {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        if (!e.target.closest('[data-action="pick-subtab"]')) return;
        e.preventDefault();
        setActivePick(activePickKey() === 'gpt' ? 'claude' : 'gpt');
        var again = document.querySelector('[data-focus-key="picktab:' + activePickKey() + '"]');
        if (again) again.focus();
      });
      picksRoot.addEventListener('click', function (e) {
        var subtab = e.target.closest('[data-action="pick-subtab"]');
        if (subtab) {
          setActivePick(subtab.dataset.pickKey);
          var again = document.querySelector('[data-focus-key="picktab:' + subtab.dataset.pickKey + '"]');
          if (again) again.focus();
          return;
        }
        var btn = e.target.closest('button[data-action]');
        if (!btn) return;
        var card = btn.closest('[data-pick]');
        var key = card && card.dataset.pick;
        if (btn.dataset.action === 'edit-pick') {
          ui.picksActive = key;
          ui.picksEdit = key;
          renderPicks();
          var ta = document.querySelector('[data-focus-key="pick-input:' + key + '"]');
          if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
        } else if (btn.dataset.action === 'cancel-pick') {
          ui.picksEdit = null;
          renderPicks();
          var eb = document.querySelector('[data-pick="' + key + '"] [data-action="edit-pick"]');
          if (eb) eb.focus();
        }
      });
      picksRoot.addEventListener('submit', function (e) {
        var form = e.target.closest('form[data-pick-form]');
        if (!form) return;
        e.preventDefault();
        savePick(form.dataset.pickForm, form.querySelector('textarea').value);
      });
    }

    // 택일 후보 (view-picks) events
    var picksView = $('#view-picks');
    if (picksView) {
      bindRx(picksView, 'date');
      picksView.addEventListener('click', function (e) {
        var add = e.target.closest('#add-date-btn');
        if (add) { ui.dateEdit = 'new'; renderDates(); var f = document.querySelector('[data-focus-key="date-d:new"]'); if (f) f.focus(); return; }
        var btn = e.target.closest('button[data-action]');
        if (!btn) return;
        var li = btn.closest('[data-date-id]');
        switch (btn.dataset.action) {
          case 'edit-date': ui.dateEdit = li.dataset.dateId; renderDates(); var ff = document.querySelector('[data-focus-key="date-d:' + li.dataset.dateId + '"]'); if (ff) ff.focus(); break;
          case 'cancel-date': var wasNew = !li; ui.dateEdit = null; renderDates(); var back = wasNew ? $('#add-date-btn') : document.querySelector('[data-focus-key="date-edit:' + li.dataset.dateId + '"]'); if (back) back.focus(); break;
          case 'delete-date': deleteDate(li.dataset.dateId); break;
          case 'date-fav': toggleDateFav(li.dataset.dateId); break;
        }
      });
      picksView.addEventListener('submit', function (e) {
        var form = e.target.closest('form[data-date-form]');
        if (!form) return;
        e.preventDefault();
        submitDateForm(form);
      });
    }

    // 작명 노트 (view-names) events
    var namesView = $('#view-names');
    if (namesView) {
      bindRx(namesView, 'name');
      namesView.addEventListener('click', function (e) {
        var add = e.target.closest('#add-name-btn');
        if (add) { ui.nameEdit = 'new'; renderNames(); var f = document.querySelector('[data-focus-key="name-n:new"]'); if (f) f.focus(); return; }
        var addHanja = e.target.closest('[data-action="add-hanja"]');
        if (addHanja) {
          var rows = addHanja.closest('.name-form').querySelector('[data-hanja-rows]');
          var div = document.createElement('div');
          div.innerHTML = hanjaRowHtml(null);
          rows.appendChild(div.firstChild);
          var last = rows.querySelector('.hanja-row:last-child .hanja-row__chars');
          if (last) last.focus();
          return;
        }
        var rm = e.target.closest('[data-action="remove-hanja"]');
        if (rm) {
          var row = rm.closest('.hanja-row');
          var cont = row.parentNode;
          if (cont.querySelectorAll('.hanja-row').length > 1) row.remove();
          else { row.querySelector('.hanja-row__chars').value = ''; row.querySelector('.hanja-row__meaning').value = ''; }
          return;
        }
        var btn = e.target.closest('button[data-action]');
        if (!btn) return;
        var li = btn.closest('[data-name-id]');
        switch (btn.dataset.action) {
          case 'toggle-fav': toggleNameFav(li.dataset.nameId); break;
          case 'edit-name': ui.nameEdit = li.dataset.nameId; renderNames(); var nf = document.querySelector('[data-focus-key="name-n:' + li.dataset.nameId + '"]'); if (nf) nf.focus(); break;
          case 'cancel-name': var wasNew2 = !li; ui.nameEdit = null; renderNames(); var back2 = wasNew2 ? $('#add-name-btn') : document.querySelector('[data-focus-key="name-edit:' + li.dataset.nameId + '"]'); if (back2) back2.focus(); break;
          case 'delete-name': deleteName(li.dataset.nameId); break;
        }
      });
      namesView.addEventListener('submit', function (e) {
        var form = e.target.closest('form[data-name-form]');
        if (!form) return;
        e.preventDefault();
        submitNameForm(form);
      });
    }

    var root = $('#categories');

    root.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-action]');
      if (!btn || btn.tagName !== 'BUTTON') return;
      var card = btn.closest('[data-category-id]');
      var row = btn.closest('[data-item-id]');
      flushPriceInputs();
      switch (btn.dataset.action) {
        case 'delete-category': deleteCategory(card.dataset.categoryId); break;
        case 'sub-tab': {
          var scid2 = card.dataset.categoryId;
          ui.subTab[scid2] = btn.dataset.sub || ''; ui.tagFilter[scid2] = ''; delete ui.addSubPick[scid2]; saveUiPrefs();
          renderCategories();
          var sbtn = document.querySelector('[data-focus-key="st:' + scid2 + ':' + (btn.dataset.sub || '') + '"]'); if (sbtn) { sbtn.focus(); if (sbtn.scrollIntoView) sbtn.scrollIntoView({ block: 'nearest', inline: 'center' }); }
          break;
        }
        case 'delete-sub': deleteSub(card.dataset.categoryId, btn.closest('[data-sub-id]').dataset.subId); break;
        case 'done-tab': {
          var dcid = card.dataset.categoryId;
          ui.doneTab[dcid] = btn.dataset.tab; saveUiPrefs();
          renderCategories();
          var db = document.querySelector('[data-focus-key="dt:' + dcid + ':' + btn.dataset.tab + '"]'); if (db) db.focus();
          break;
        }
        case 'tag-filter': {
          var tcid = card.dataset.categoryId;
          ui.tagFilter[tcid] = btn.dataset.tag || ''; saveUiPrefs();
          renderCategories();
          var tb = document.querySelector('[data-focus-key="tf:' + tcid + ':' + (btn.dataset.tag || '') + '"]'); if (tb) tb.focus();
          break;
        }
        case 'bulk-toggle': {
          var bcid = card.dataset.categoryId;
          ui.bulkOpen = ui.bulkOpen === bcid ? null : bcid;
          render();
          var bt = document.querySelector('[data-focus-key="' + (ui.bulkOpen ? 'bulk-text:' : 'bulk-toggle:') + bcid + '"]');
          if (bt) bt.focus();
          break;
        }
        case 'cat-up': moveCategoryDir(card.dataset.categoryId, -1); break;
        case 'cat-down': moveCategoryDir(card.dataset.categoryId, 1); break;
        case 'toggle-collapse': toggleCollapsed(card.dataset.categoryId); break;
        case 'pick-icon': setCategoryIcon(card.dataset.categoryId, btn.dataset.icon || ''); break;
        case 'delete-item': deleteItem(row.dataset.itemId); break;
        case 'item-up': { var uid_ = row.dataset.itemId; moveItemDir(uid_, -1); var fu = document.querySelector('[data-focus-key="iup:' + uid_ + '"]'); if (fu && !fu.disabled) fu.focus(); else { var du = document.querySelector('[data-focus-key="idown:' + uid_ + '"]'); if (du) du.focus(); } break; }
        case 'item-down': { var did_ = row.dataset.itemId; moveItemDir(did_, 1); var fd = document.querySelector('[data-focus-key="idown:' + did_ + '"]'); if (fd && !fd.disabled) fd.focus(); else { var uu = document.querySelector('[data-focus-key="iup:' + did_ + '"]'); if (uu) uu.focus(); } break; }
        case 'toggle-excluded': toggleExcluded(row.dataset.itemId); break;
        case 'open-item-edit': {
          var oid = row.dataset.itemId;
          ui.itemEdit = oid;
          render();
          var nameInput = document.querySelector('[data-focus-key="name:' + oid + '"]');
          if (nameInput) nameInput.focus();
          break;
        }
        case 'close-item-edit': {
          var ccid = row.dataset.itemId;
          ui.itemEdit = null;
          render();
          var editBtn = document.querySelector('[data-focus-key="iedit:' + ccid + '"]');
          if (editBtn) editBtn.focus();
          break;
        }
        case 'edit-qty': {
          var iid = row.dataset.itemId;
          ui.qtyEdit = ui.qtyEdit === iid ? null : iid;
          render();
          var target = document.querySelector('[data-focus-key="' + (ui.qtyEdit ? 'q-qty:' : 'qty-btn:') + iid + '"]');
          if (target) { target.focus(); if (ui.qtyEdit && target.select) target.select(); }
          break;
        }
        case 'close-qty': {
          var cid2 = row.dataset.itemId;
          ui.qtyEdit = null;
          render();
          var back = document.querySelector('[data-focus-key="qty-btn:' + cid2 + '"]');
          if (back) back.focus();
          break;
        }
      }
    });

    root.addEventListener('submit', function (e) {
      var subForm = e.target.closest('form[data-action="add-sub"]');
      if (subForm) {
        e.preventDefault();
        var scard = subForm.closest('[data-category-id]');
        if (addSub(scard.dataset.categoryId, $('input[type="text"]', subForm).value)) {
          var ns = document.querySelector('[data-focus-key="new-sub:' + scard.dataset.categoryId + '"]'); if (ns) ns.focus();
        }
        return;
      }
      var bulk = e.target.closest('form[data-action="bulk-add"]');
      if (bulk) {
        e.preventDefault();
        var bcard = bulk.closest('[data-category-id]');
        var bsub = chosenAddSub(bcard);
        var n = addItems(bcard.dataset.categoryId, $('textarea', bulk).value, bsub);
        if (n) {
          ui.bulkOpen = null; render();
          showToast('준비물 ' + n + '개를 추가했습니다.' + (subNameOf(bcard.dataset.categoryId, bsub) ? ' (' + subNameOf(bcard.dataset.categoryId, bsub) + ')' : ''));
          var qi = document.querySelector('[data-focus-key="new-item:' + bcard.dataset.categoryId + '"]');
          if (qi) qi.focus();
        }
        return;
      }
      var form = e.target.closest('form[data-action="add-item"]');
      if (!form) return;
      e.preventDefault();
      var card = form.closest('[data-category-id]');
      var input = $('input[type="text"]', form);
      if (addItem(card.dataset.categoryId, input.value, chosenAddSub(card))) {
        var again = document.querySelector('[data-focus-key="new-item:' + card.dataset.categoryId + '"]');
        if (again) { again.value = ''; again.focus(); }
      }
    });
    // 여러 개 입력칸: Ctrl/⌘+Enter 로 바로 추가
    root.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && e.target.closest('form[data-action="bulk-add"]')) {
        e.preventDefault();
        e.target.closest('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      }
    });

    root.addEventListener('change', function (e) {
      var el = e.target;
      var row = el.closest('[data-item-id]');
      var card = el.closest('[data-category-id]');
      if (el.dataset.action === 'toggle-done') { toggleDone(row.dataset.itemId, el.checked); return; }
      if (el.dataset.action === 'move-item') { moveItem(row.dataset.itemId, el.value); return; }
      if (el.dataset.action === 'rename-category') { renameCategory(card.dataset.categoryId, el.value, el); return; }
      if (el.dataset.action === 'set-icon') { setCategoryIcon(card.dataset.categoryId, el.value); return; }
      if (el.dataset.action === 'rename-sub' || el.dataset.action === 'set-sub-icon') {
        var rCat = findCategory(card.dataset.categoryId), rSub = rCat && findSub(rCat, el.closest('[data-sub-id]').dataset.subId);
        if (!rSub) return;
        if (el.dataset.action === 'rename-sub') {
          var nn = el.value.trim().slice(0, SUB_NAME_MAX);
          if (!nn) { el.value = rSub.name; showToast('상세 분류 이름은 비워둘 수 없습니다.'); return; }
          if (nn === rSub.name) return;
          act('category', '상세 분류 ‘' + rSub.name + '’ → ‘' + nn + '’'); rSub.name = nn;
        } else {
          var ni = cleanIcon(el.value); if (ni === (rSub.icon || '')) return; rSub.icon = ni; el.value = ni;
        }
        saveState(); return;
      }
      if (el.dataset.role === 'add-sub') {
        var acid = card.dataset.categoryId;
        if (el.value === '__new') {
          // 목록에 없는 상세 분류를 그 자리에서 만든다
          var typed = $('input[type="text"]', el.closest('form')).value;
          var nm = window.prompt('새 상세 분류 이름을 입력하세요.\n앞에 이모지를 붙이면 아이콘이 됩니다 (예: 🍼 수유)', '');
          var made = nm && nm.trim() ? addSub(acid, nm) : '';
          if (made) { ui.addSub[acid] = made; ui.addSubPick[acid] = made; saveUiPrefs(); showToast('상세 분류를 만들었습니다: ' + subNameOf(acid, made) + '. 이어서 준비물을 추가하세요.'); }
          renderCategories();
          var ni2 = document.querySelector('[data-focus-key="new-item:' + acid + '"]');
          if (ni2) { ni2.value = typed; ni2.focus(); }
          return;
        }
        ui.addSub[acid] = el.value || ''; ui.addSubPick[acid] = el.value || ''; saveUiPrefs();
        var ni = $('input[type="text"]', el.closest('form')); if (ni) ni.focus();
        return;
      }
      if (el.dataset.action === 'set-group') { var gcat = findCategory(card.dataset.categoryId); if (gcat && GROUPS.indexOf(el.value) !== -1) { gcat.group = el.value; saveState(); act('category', '분류 ‘' + gcat.name + '’을 ' + (gcat.group === 'baby' ? '육아' : '출산') + ' 묶음으로'); } return; }
      if (el.dataset.action === 'toggle-done-tabs') { var dcat = findCategory(card.dataset.categoryId); if (dcat) { dcat.doneTabs = !!el.checked; saveState(); act('category', '분류 ‘' + dcat.name + '’ 완료 탭 ' + (dcat.doneTabs ? '켬' : '끔')); } return; }
      if (el.dataset.field && row) { updateItemField(row.dataset.itemId, el.dataset.field, el, row); }
    });

    // 금액 칸: 입력하는 대로 쉼표를 넣는다 (5000 → 5,000)
    // 키보드가 글자를 조합 중일 때(삼성 키보드 등) 값을 바꾸면 입력이 꼬이므로 조합이 끝난 뒤에 넣는다.
    root.addEventListener('input', function (e) {
      if (e.isComposing) return;
      if (e.target.matches('input[data-field="price"]')) formatPriceInput(e.target);
    });
    root.addEventListener('compositionend', function (e) {
      if (e.target.matches('input[data-field="price"]')) formatPriceInput(e.target);
    });

    // Enter in an edit field should commit and not submit anything.
    root.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && e.target.matches('input[data-field], input[data-action="rename-category"], input[data-action="set-icon"], input[data-action="rename-sub"], input[data-action="set-sub-icon"]')) {
        e.preventDefault();
        e.target.blur();
        var qrow = e.target.closest('.is-qty-editing');
        if (qrow) {
          var doneBtn = $('[data-action="close-qty"]', qrow);
          if (doneBtn) doneBtn.click();
        }
      }
      if (e.key === 'Escape' && e.target.closest('.is-qty-editing')) {
        var esc = $('[data-action="close-qty"]', e.target.closest('.is-qty-editing'));
        if (esc) esc.click();
      }
    });
  }

  /* ---------- init ---------- */
  function init() {
    var loaded = loadState();
    state = loaded.state;
    loadUiPrefs();
    // 앱을 새로 열면 포털에서 시작하고, 같은 탭에서 새로고침하면 보던 화면을 이어서 보여준다
    var sessionView = null;
    try { sessionView = window.sessionStorage.getItem(SESSION_VIEW_KEY); } catch (e) { /* ignore */ }
    ui.view = VIEWS.indexOf(sessionView) !== -1 ? sessionView : 'portal';
    if (ui.view === 'settings') ui.settingsFrom = 'portal';
    bindEvents();
    if (loaded.fresh && storageOk) {
      saveState({ initial: true });
    } else if (!loaded.fresh) {
      touched = true;
      $('#save-status').textContent = '저장된 기록을 불러왔습니다';
    }
    render();
    var storedRoom = null;
    try { storedRoom = window.localStorage.getItem('birth-bag-checklist:room'); } catch (e) { /* ignore */ }
    if (!storedRoom && !/[?&]room=/.test(window.location.search)) { clearTemplateItemsOnce(); migrateTagsOnce(); migrateSubsOnce(); if (!loaded.fresh) seedFamilyDatesOnce(); }
    try { window.history.replaceState({ view: ui.view }, ''); } catch (e) { /* ignore */ }
    window.addEventListener('popstate', function (e) {
      if (sheetPopSilently) { sheetPopSilently = false; return; }
      if (ui.ledgerForm) { closeLedgerForm(true); return; }
      var v = e.state && VIEWS.indexOf(e.state.view) !== -1 ? e.state.view : 'portal';
      setView(v, v === 'settings' ? ui.settingsFrom : undefined, true);
    });
    // 앱을 켜 둔 채 날짜가 바뀌면(밤새 백그라운드) 다시 열 때 디데이를 새로 계산한다
    var shownDay = todayStamp();
    var refreshDay = function () { if (document.visibilityState === 'visible' && todayStamp() !== shownDay) { shownDay = todayStamp(); render(); } };
    document.addEventListener('visibilitychange', refreshDay);
    window.addEventListener('pageshow', refreshDay);
    // sync.js is loaded after app.js; bind once it has had a chance to run.
    window.addEventListener('load', bindShareEvents);
  }

  /* ---------- 분류 탭 드래그로 순서 변경 (PC: 바로 끌기, 터치: 길게 누른 뒤 끌기) ---------- */
  function setupCategoryDrag() {
    var bar = $('#category-tabs');
    if (!bar) return;
    var LONG = 350, THRESH = 8;
    var drag = null, suppressClick = false;
    function tabs() { return Array.prototype.filter.call(bar.querySelectorAll('.category-tab'), function (t) { return !t.classList.contains('category-tab--add'); }); }
    function setTx(tx) { drag.tx = tx; drag.el.style.transform = tx ? 'translateX(' + tx + 'px)' : ''; }
    function naturalLeft() { return drag.el.getBoundingClientRect().left - drag.tx; }
    function activate(e) {
      drag.active = true;
      drag.grabOffset = e.clientX - drag.el.getBoundingClientRect().left;
      drag.el.classList.add('is-dragging');
      bar.classList.add('is-reordering');
      try { drag.el.setPointerCapture(drag.pointerId); } catch (err) { /* ignore */ }
    }
    function cleanup() {
      if (!drag) return;
      clearTimeout(drag.timer);
      drag.el.classList.remove('is-dragging');
      drag.el.style.transform = '';
      bar.classList.remove('is-reordering');
      try { drag.el.releasePointerCapture(drag.pointerId); } catch (err) { /* ignore */ }
      drag = null;
    }
    function commitOrder() {
      var ids = tabs().map(function (t) { return t.dataset.categoryId; });
      var before = state.categories.map(function (c) { return c.id; }).join('|');
      if (ids.join('|') === before) return false;
      var byId = {}; state.categories.forEach(function (c) { byId[c.id] = c; });
      var next = []; ids.forEach(function (id) { if (byId[id]) next.push(byId[id]); });
      state.categories.forEach(function (c) { if (next.indexOf(c) === -1) next.push(c); });
      state.categories = next;
      commit();
      act('category', '분류 순서 변경 (' + next.map(function (c) { return c.name; }).join(' › ') + ')');
      showToast('분류 순서를 바꿨습니다.');
      return true;
    }
    bar.addEventListener('pointerdown', function (e) {
      var el = e.target.closest('.category-tab');
      if (!el || el.classList.contains('category-tab--add') || !bar.contains(el)) return;
      if (typeof e.button === 'number' && e.button !== 0) return;
      if (tabs().length < 2) return;
      cleanup();
      drag = { el: el, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, active: false, tx: 0, grabOffset: 0, touch: e.pointerType !== 'mouse', timer: null };
      if (drag.touch) drag.timer = setTimeout(function () { if (drag && !drag.active) activate(e); }, LONG);
    });
    bar.addEventListener('pointermove', function (e) {
      if (!drag || e.pointerId !== drag.pointerId) return;
      var dx = e.clientX - drag.startX, dy = e.clientY - drag.startY;
      if (!drag.active) {
        if (Math.abs(dx) <= THRESH && Math.abs(dy) <= THRESH) return;
        if (drag.touch) { cleanup(); return; } // 길게 누르기 전에 움직이면 스크롤로 취급
        activate(e);
      }
      e.preventDefault();
      var desiredLeft = e.clientX - drag.grabOffset;
      setTx(desiredLeft - naturalLeft());
      var center = desiredLeft + drag.el.offsetWidth / 2;
      var others = tabs().filter(function (t) { return t !== drag.el; });
      var target = 0;
      others.forEach(function (t) { var r = t.getBoundingClientRect(); if (center > r.left + r.width / 2) target++; });
      var current = tabs().indexOf(drag.el);
      if (target !== current) {
        var ref = others[target] || bar.querySelector('.category-tab--add');
        bar.insertBefore(drag.el, ref || null);
        setTx(desiredLeft - naturalLeft());
      }
    });
    function finish(e, cancelled) {
      if (!drag || (e && e.pointerId !== drag.pointerId)) return;
      var wasActive = drag.active;
      cleanup();
      if (!wasActive) return;
      suppressClick = true;
      setTimeout(function () { suppressClick = false; }, 80);
      if (cancelled) { renderTabs(); return; }
      if (!commitOrder()) renderTabs();
    }
    bar.addEventListener('pointerup', function (e) { finish(e, false); });
    bar.addEventListener('pointercancel', function (e) { finish(e, true); });
    bar.addEventListener('lostpointercapture', function (e) { if (drag && drag.active && e.pointerId === drag.pointerId) finish(e, false); });
    // 드래그 중에는 탭 줄 가로 스크롤·페이지 스크롤을 막는다 (터치)
    bar.addEventListener('touchmove', function (e) { if (drag && drag.active) e.preventDefault(); }, { passive: false });
    bar.addEventListener('contextmenu', function (e) { if (drag) e.preventDefault(); });
    bar.addEventListener('click', function (e) { if (suppressClick) { e.stopPropagation(); e.preventDefault(); } }, true);
  }

  /* ---------- 당겨서 새로고침 (홈 화면 웹앱 전용) ---------- */
  function setupPullToRefresh() {
    var standalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
    var forced = /[?&]ptr=1/.test(window.location.search);
    if (!standalone && !forced) return;
    var el = document.createElement('div');
    el.id = 'ptr'; el.className = 'ptr'; el.setAttribute('aria-hidden', 'true');
    el.innerHTML = '<span class="ptr__icon">↓</span><span class="ptr__text">당겨서 새로고침</span>';
    document.body.appendChild(el);
    var startY = null, dist = 0, active = false, THRESH = 72;
    function reset() { active = false; dist = 0; startY = null; el.classList.remove('is-ready', 'is-visible', 'is-loading'); el.style.transform = ''; }
    document.addEventListener('touchstart', function (e) {
      if (e.touches.length !== 1 || window.scrollY > 0 || isTyping()) return;
      if (document.body.classList.contains('has-sheet') || (e.target.closest && e.target.closest('.sheet, textarea'))) return;
      startY = e.touches[0].clientY; active = true; dist = 0;
    }, { passive: true });
    document.addEventListener('touchmove', function (e) {
      if (!active) return;
      dist = e.touches[0].clientY - startY;
      if (dist <= 0 || window.scrollY > 0) { el.classList.remove('is-visible', 'is-ready'); return; }
      var d = Math.min(dist, 120);
      el.classList.add('is-visible');
      el.classList.toggle('is-ready', dist > THRESH);
      el.querySelector('.ptr__text').textContent = dist > THRESH ? '놓으면 새로고침' : '당겨서 새로고침';
      el.style.transform = 'translate(-50%, ' + (d * 0.5) + 'px)';
    }, { passive: true });
    document.addEventListener('touchend', function () {
      if (!active) return;
      if (dist > THRESH) {
        el.classList.add('is-loading'); el.querySelector('.ptr__text').textContent = '새로고침 중…';
        window.__ptrTriggered = true;
        if (!window.__ptrTest) setTimeout(function () { window.location.reload(); }, 150);
        else setTimeout(reset, 300);
        return;
      }
      reset();
    }, { passive: true });
    document.addEventListener('touchcancel', reset, { passive: true });
  }

  function watchDayChange() {
    var day = todayStamp();
    var check = function () { var t = todayStamp(); if (t !== day) { day = t; render(); } };
    setInterval(check, 60000);
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') check(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { init(); setupCategoryDrag(); setupPullToRefresh(); watchDayChange(); });
  else { init(); setupCategoryDrag(); setupPullToRefresh(); watchDayChange(); }
})();
