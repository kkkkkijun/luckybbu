/* 가족 공유 동기화 (Firebase Realtime Database)
   - app.js 가 window.ChecklistApp 을 노출하고, 이 모듈은 window.ChecklistSync 를 노출한다.
   - 설정(window.FIREBASE_CONFIG)이 없으면 아무것도 하지 않는다.
   - 로컬 테스트: localhost 에서 ?sync=mock 을 붙이면 브라우저 저장소를 가짜 서버로 사용한다.
*/
(function () {
  'use strict';

  var app = window.ChecklistApp;
  if (!app) return;

  var ROOM_KEY = 'birth-bag-checklist:room';
  var MOCK_KEY = 'birth-bag-checklist:mock-remote';
  var SDK_VERSION = '12.2.1';
  var params = new URLSearchParams(window.location.search);
  var useMock = params.get('sync') === 'mock' && /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname);
  var config = window.FIREBASE_CONFIG;
  var configured = useMock || !!(config && config.apiKey && config.databaseURL);

  var sync = {
    roomId: null,
    status: configured ? 'off' : 'unconfigured', // unconfigured | off | connecting | online | offline | error
    detail: '',
    lastDoc: null,
    adapter: null,
    unsubscribe: null,
    listeners: [],
    lastSyncedAt: null,
    errorCode: ''
  };

  /* ---------- helpers ---------- */
  function randomId(len) {
    var chars = 'abcdefghijkmnpqrstuvwxyz23456789';
    var out = '';
    var buf = new Uint8Array(len);
    if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(buf);
    else for (var i = 0; i < len; i++) buf[i] = Math.floor(Math.random() * 256);
    for (var j = 0; j < len; j++) out += chars[buf[j] % chars.length];
    return out;
  }

  function validRoomId(id) { return typeof id === 'string' && /^[a-z0-9]{20,40}$/.test(id); }
  function asArr(v) { if (Array.isArray(v)) return v; if (v && typeof v === 'object') return Object.keys(v).map(function (k) { return v[k]; }); return []; }

  function emit() {
    sync.listeners.forEach(function (cb) { try { cb(publicState()); } catch (e) { /* ignore */ } });
  }

  function setStatus(status, detail, code) {
    sync.status = status;
    sync.detail = detail || '';
    sync.errorCode = status === 'error' ? (code || '') : '';
    emit();
  }

  // 사용자에게 보여줄 오류 문구(영문 원문 대신)
  function errText(err, prefix) {
    if (err && err.code === 'PERMISSION_DENIED') return '접근이 거부되었습니다. Firebase 보안 규칙을 확인하세요.';
    if (err && err.code === 'SDK_LOAD') return err.message;
    var m = err && err.message ? err.message : String(err);
    if (/fetch|network|import|load|offline|timeout/i.test(m)) return '네트워크 문제로 가족 공유 서버에 연결하지 못했습니다. 기록은 이 기기에 저장되며, 인터넷이 연결되면 다시 시도합니다.';
    return prefix + m;
  }
  function errCode(err) { return err && err.code ? String(err.code) : ''; }

  /* ---------- 서버에 아직 못 올린 변경(오프라인 대기) ---------- */
  var PENDING_KEY = 'birth-bag-checklist:pending';
  function readPending() {
    try { var p = JSON.parse(window.localStorage.getItem(PENDING_KEY) || 'null'); return p && p.roomId && p.updates ? p : null; } catch (e) { return null; }
  }
  function writePending(p) {
    try { if (p && Object.keys(p.updates).length) window.localStorage.setItem(PENDING_KEY, JSON.stringify(p)); else window.localStorage.removeItem(PENDING_KEY); } catch (e) { /* ignore */ }
  }
  var pending = readPending();
  function addPending(roomId, updates) {
    if (!pending || pending.roomId !== roomId) pending = { roomId: roomId, updates: {} };
    Object.keys(updates).forEach(function (k) { pending.updates[k] = updates[k]; });
    writePending(pending);
  }
  function clearPending(roomId, updates) {
    if (!pending || pending.roomId !== roomId) return;
    Object.keys(updates).forEach(function (k) {
      if (JSON.stringify(pending.updates[k]) === JSON.stringify(updates[k])) delete pending.updates[k];
    });
    if (!Object.keys(pending.updates).length) pending = null;
    writePending(pending);
  }
  function pendingFor(roomId) { return pending && pending.roomId === roomId && Object.keys(pending.updates).length ? pending.updates : null; }

  function publicState() {
    return { configured: configured, roomId: sync.roomId, status: sync.status, detail: sync.detail, link: link(), lastSyncedAt: sync.lastSyncedAt, mock: useMock };
  }

  function link() {
    if (!sync.roomId) return '';
    var url = new URL(window.location.href);
    url.search = '';
    url.hash = '';
    url.searchParams.set('room', sync.roomId);
    if (useMock) url.searchParams.set('sync', 'mock');
    return url.toString();
  }

  function readStoredRoom() {
    try { var v = window.localStorage.getItem(ROOM_KEY); return validRoomId(v) ? v : null; } catch (e) { return null; }
  }
  function storeRoom(id) {
    try { if (id) window.localStorage.setItem(ROOM_KEY, id); else window.localStorage.removeItem(ROOM_KEY); } catch (e) { /* ignore */ }
  }

  function setUrlRoom(id) {
    try {
      var url = new URL(window.location.href);
      if (id) url.searchParams.set('room', id); else url.searchParams.delete('room');
      window.history.replaceState(null, '', url.toString());
    } catch (e) { /* ignore */ }
  }

  /* ---------- state <-> remote document ---------- */
  // Remote layout: { version, categories:{id:{name,icon,group,order}}, items:{id:{...,order}}, notes:{id:{...}}, ledger:{id:{...}}, highlights, dueDate, anniversary, budget }
  function docFromState(s) {
    var doc = { version: s.version || 1, categories: {}, items: {}, notes: {}, highlights: s.highlights || '', picks: { gpt: (s.picks && s.picks.gpt) || '', claude: (s.picks && s.picks.claude) || '' } };
    s.categories.forEach(function (c, i) { doc.categories[c.id] = { name: c.name, icon: c.icon || '', doneTabs: !!c.doneTabs, group: c.group || '', subs: (c.subs && c.subs.length) ? c.subs.map(function (sb) { return { id: sb.id, name: sb.name, icon: sb.icon || '' }; }) : null, order: i }; });
    s.items.forEach(function (it, i) {
      doc.items[it.id] = { categoryId: it.categoryId, name: it.name, price: typeof it.price === 'number' ? it.price : null, tags: Array.isArray(it.tags) && it.tags.length ? it.tags.slice() : null, sub: it.sub || '', memo: it.memo || '', done: !!it.done, excluded: !!it.excluded, order: i };
    });
    s.notes.forEach(function (n) { doc.notes[n.id] = { date: n.date || '', title: n.title || '', body: n.body || '', fav: !!n.fav, likes: (n.likes && n.likes.length) ? n.likes.slice() : null, comments: (n.comments && n.comments.length) ? n.comments.map(function (c) { return { id: c.id, who: c.who || '', text: c.text || '', t: c.t || 0 }; }) : null }; });
    doc.dates = {};
    (s.dates || []).forEach(function (d, i) { doc.dates[d.id] = { date: d.date || '', time: d.time || '', label: d.label || '', memo: d.memo || '', fav: !!d.fav, likes: (d.likes && d.likes.length) ? d.likes.slice() : null, comments: (d.comments && d.comments.length) ? d.comments.map(function (c) { return { id: c.id, who: c.who || '', text: c.text || '', t: c.t || 0 }; }) : null, order: i }; });
    doc.dueDate = s.dueDate || '';
    doc.anniversary = s.anniversary || '';
    doc.budget = typeof s.budget === 'number' ? s.budget : 0;
    doc.ledger = {};
    (s.ledger || []).forEach(function (e) { doc.ledger[e.id] = { date: e.date, type: e.type, amount: e.amount, cat: e.cat || '', text: e.text || '', who: e.who || '', pay: e.pay || '', t: e.t || 0 }; });
    doc.memo = s.memo || '';
    doc.memos = {};
    (s.memos || []).forEach(function (m, i) { doc.memos[m.id] = { text: m.text || '', updated: m.updated || 0, who: m.who || '', fav: !!m.fav, likes: (m.likes && m.likes.length) ? m.likes.slice() : null, comments: (m.comments && m.comments.length) ? m.comments.map(function (c) { return { id: c.id, who: c.who || '', text: c.text || '', t: c.t || 0 }; }) : null, tables: (m.tables && m.tables.length) ? m.tables.map(function (t) { return { id: t.id, cols: t.cols.slice(), rowH: t.rowH.slice(), rows: t.rows.map(function (r) { return r.slice(); }) }; }) : null, order: i }; });
    doc.supports = {};
    (s.supports || []).forEach(function (x, i) { doc.supports[x.id] = { title: x.title || '', target: x.target || '', benefit: x.benefit || '', howto: x.howto || '', deadline: x.deadline || '', link: x.link || '', status: x.status || 'todo', memo: x.memo || '', stage: x.stage || 'birth', amount: x.amount || '', amountWon: typeof x.amountWon === 'number' ? x.amountWon : null, where: x.where || '', dueText: x.dueText || '', dueBase: x.dueBase || '', dueDays: typeof x.dueDays === 'number' ? x.dueDays : null, order: i }; });
    doc.birthTasks = {};
    (s.birthTasks || []).forEach(function (t, i) { doc.birthTasks[t.id] = { stage: t.stage || 'prep', text: t.text || '', note: t.note || '', done: !!t.done, link: t.link || '', csec: !!t.csec, order: i }; });
    doc.fairStops = {};
    (s.fairStops || []).forEach(function (t, i) { doc.fairStops[t.id] = { code: t.code || '', name: t.name || '', note: t.note || '', keys: (t.keys && t.keys.length) ? t.keys.slice() : null, done: !!t.done, memo: t.memo || '', order: i }; });
    doc.names = {};
    (s.names || []).forEach(function (n, i) { doc.names[n.id] = { name: n.name || '', favorite: !!n.favorite, memo: n.memo || '', hanja: (n.hanja || []).map(function (h) { return { id: h.id || '', chars: h.chars || '', meaning: h.meaning || '' }; }), dateIds: (n.dateIds || []).slice(), likes: (n.likes && n.likes.length) ? n.likes.slice() : null, comments: (n.comments && n.comments.length) ? n.comments.map(function (c) { return { id: c.id, who: c.who || '', text: c.text || '', t: c.t || 0 }; }) : null, order: i }; });
    return doc;
  }

  function sortedEntries(map) {
    var arr = Object.keys(map || {}).map(function (id) { var v = map[id] || {}; v.id = id; return v; });
    arr.sort(function (a, b) {
      var ao = typeof a.order === 'number' ? a.order : 1e9, bo = typeof b.order === 'number' ? b.order : 1e9;
      if (ao !== bo) return ao - bo;
      return String(a.id) < String(b.id) ? -1 : 1;
    });
    return arr;
  }

  function stateFromDoc(doc) {
    doc = doc || {};
    return {
      version: typeof doc.version === 'number' ? doc.version : 1,
      categories: sortedEntries(doc.categories).map(function (c) { return { id: c.id, name: c.name, icon: c.icon || '', doneTabs: c.doneTabs === true, subs: c.subs || [], group: c.group || undefined }; }),
      items: sortedEntries(doc.items).map(function (it) {
        return { id: it.id, categoryId: it.categoryId, name: it.name, price: typeof it.price === 'number' ? it.price : null, tags: Array.isArray(it.tags) ? it.tags : (it.tags && typeof it.tags === 'object' ? Object.keys(it.tags).map(function (k) { return it.tags[k]; }) : []), sub: typeof it.sub === 'string' ? it.sub : '', memo: it.memo || '', done: it.done === true, excluded: it.excluded === true };
      }),
      notes: Object.keys(doc.notes || {}).map(function (id) { var n = doc.notes[id] || {}; return { id: id, date: n.date || '', title: n.title || '', body: n.body || '', fav: n.fav === true, likes: n.likes || [], comments: n.comments || [] }; }),
      dates: sortedEntries(doc.dates).map(function (d) { return { id: d.id, date: d.date || '', time: d.time || '', label: d.label || '', memo: d.memo || '', fav: d.fav === true, likes: d.likes || [], comments: d.comments || [] }; }),
      names: sortedEntries(doc.names).map(function (n) { return { id: n.id, name: n.name || '', favorite: n.favorite === true, likes: n.likes || [], comments: n.comments || [], memo: n.memo || '', hanja: asArr(n.hanja).map(function (h) { return { id: (h && h.id) || '', chars: (h && h.chars) || '', meaning: (h && h.meaning) || '' }; }), dateIds: asArr(n.dateIds).filter(function (x) { return typeof x === 'string'; }) }; }),
      highlights: typeof doc.highlights === 'string' ? doc.highlights : '',
      dueDate: typeof doc.dueDate === 'string' ? doc.dueDate : '',
      anniversary: typeof doc.anniversary === 'string' ? doc.anniversary : '',
      budget: typeof doc.budget === 'number' ? doc.budget : 0,
      ledger: Object.keys(doc.ledger || {}).map(function (id) { var e = doc.ledger[id] || {}; return { id: id, date: e.date, type: e.type, amount: e.amount, cat: e.cat, text: e.text || '', who: e.who || '', pay: e.pay || '', t: typeof e.t === 'number' ? e.t : 0 }; }),
      memo: typeof doc.memo === 'string' ? doc.memo : '',
      memos: sortedEntries(doc.memos).map(function (m) { return { id: m.id, text: m.text || '', updated: typeof m.updated === 'number' ? m.updated : 0, who: m.who || '', fav: m.fav === true, likes: m.likes || [], comments: m.comments || [], tables: m.tables || [] }; }),
      supports: sortedEntries(doc.supports).map(function (x) { return { id: x.id, title: x.title || '', target: x.target || '', benefit: x.benefit || '', howto: x.howto || '', deadline: x.deadline || '', link: x.link || '', status: x.status || 'todo', memo: x.memo || '', stage: x.stage || 'birth', amount: x.amount || '', amountWon: typeof x.amountWon === 'number' ? x.amountWon : null, where: x.where || '', dueText: x.dueText || '', dueBase: x.dueBase || '', dueDays: typeof x.dueDays === 'number' ? x.dueDays : null }; }),
      birthTasks: sortedEntries(doc.birthTasks).map(function (t) { return { id: t.id, stage: t.stage || 'prep', text: t.text || '', note: t.note || '', done: t.done === true, link: t.link || '', csec: t.csec === true }; }),
      fairStops: sortedEntries(doc.fairStops).map(function (t) { return { id: t.id, code: t.code || '', name: t.name || '', note: t.note || '', keys: asArr(t.keys).filter(function (k) { return typeof k === 'string'; }), done: t.done === true, memo: t.memo || '' }; }),
      picks: { gpt: (doc.picks && typeof doc.picks.gpt === 'string') ? doc.picks.gpt : '', claude: (doc.picks && typeof doc.picks.claude === 'string') ? doc.picks.claude : '' }
    };
  }

  function isEmptyDoc(doc) {
    return !doc || (!Object.keys(doc.categories || {}).length && !Object.keys(doc.items || {}).length && !Object.keys(doc.notes || {}).length && !Object.keys(doc.dates || {}).length && !Object.keys(doc.names || {}).length && !Object.keys(doc.supports || {}).length && !Object.keys(doc.memos || {}).length && !Object.keys(doc.ledger || {}).length && !Object.keys(doc.birthTasks || {}).length && !Object.keys(doc.fairStops || {}).length && !doc.highlights && !doc.memo && !doc.dueDate && !doc.anniversary && !(doc.picks && (doc.picks.gpt || doc.picks.claude)));
  }

  // Multi-path update: only entities that changed, null for removed ones.
  function diff(prev, next) {
    var updates = {};
    prev = prev || { categories: {}, items: {}, notes: {}, highlights: '' };
    ['categories', 'items', 'notes', 'dates', 'names', 'supports', 'memos', 'ledger', 'birthTasks', 'fairStops'].forEach(function (group) {
      var a = prev[group] || {}, b = next[group] || {};
      Object.keys(b).forEach(function (id) {
        if (!a[id] || JSON.stringify(a[id]) !== JSON.stringify(b[id])) updates[group + '/' + id] = b[id];
      });
      Object.keys(a).forEach(function (id) { if (!b[id]) updates[group + '/' + id] = null; });
    });
    if ((prev.highlights || '') !== (next.highlights || '')) updates.highlights = next.highlights || '';
    if ((prev.dueDate || '') !== (next.dueDate || '')) updates.dueDate = next.dueDate || '';
    if ((prev.anniversary || '') !== (next.anniversary || '')) updates.anniversary = next.anniversary || '';
    if ((prev.budget || 0) !== (next.budget || 0)) updates.budget = next.budget || 0;
    if ((prev.memo || '') !== (next.memo || '')) updates.memo = next.memo || '';
    if (JSON.stringify(prev.picks || {}) !== JSON.stringify(next.picks || {})) updates.picks = next.picks || { gpt: '', claude: '' };
    if (prev.version !== next.version) updates.version = next.version;
    return updates;
  }

  /* ---------- adapters ---------- */
  function mockAdapter() {
    var channel = ('BroadcastChannel' in window) ? new BroadcastChannel('birth-bag-checklist-mock') : null;
    function readAll() { try { return JSON.parse(window.localStorage.getItem(MOCK_KEY) || '{}'); } catch (e) { return {}; } }
    function writeAll(all) { window.localStorage.setItem(MOCK_KEY, JSON.stringify(all)); }
    function applyUpdates(doc, updates) {
      doc = doc || { version: 1, categories: {}, items: {}, notes: {}, highlights: '' };
      Object.keys(updates).forEach(function (path) {
        var parts = path.split('/');
        if (parts.length === 1) { if (updates[path] === null) delete doc[parts[0]]; else doc[parts[0]] = updates[path]; return; }
        doc[parts[0]] = doc[parts[0]] || {};
        if (updates[path] === null) delete doc[parts[0]][parts[1]]; else doc[parts[0]][parts[1]] = updates[path];
      });
      return doc;
    }
    return {
      get: function (roomId) { return Promise.resolve(readAll()[roomId] || null); },
      update: function (roomId, updates) {
        var all = readAll();
        all[roomId] = applyUpdates(all[roomId], updates);
        writeAll(all);
        if (channel) channel.postMessage({ roomId: roomId });
        if (this._cb && this._room === roomId) this._cb(all[roomId]);
        return Promise.resolve();
      },
      subscribe: function (roomId, cb) {
        var self = this;
        self._cb = cb; self._room = roomId;
        var fire = function () { cb(readAll()[roomId] || null); };
        var bcHandler = function (e) { if (e.data && e.data.roomId === roomId) fire(); };
        var storageHandler = function (e) { if (e.key === MOCK_KEY) fire(); };
        if (channel) channel.addEventListener('message', bcHandler);
        window.addEventListener('storage', storageHandler); // fires in OTHER tabs on localStorage change
        fire();
        return function () {
          if (channel) channel.removeEventListener('message', bcHandler);
          window.removeEventListener('storage', storageHandler);
          self._cb = null;
        };
      },
      onConnection: function (cb) { cb(true); return function () {}; },
      pushActivity: function (roomId, entry) {
        var all = readAll();
        var doc = all[roomId] || (all[roomId] = { version: 1, categories: {}, items: {}, notes: {}, highlights: '' });
        doc.activity = doc.activity || {};
        doc.activity['a' + entry.t + Math.random().toString(36).slice(2, 6)] = entry;
        var keys = Object.keys(doc.activity).sort();
        while (keys.length > 120) delete doc.activity[keys.shift()];
        writeAll(all);
        if (channel) channel.postMessage({ roomId: roomId, activity: true });
        if (this._acb && this._aroom === roomId) this._acb(activityList(doc.activity));
        return Promise.resolve();
      },
      subscribeActivity: function (roomId, cb) {
        var self = this; self._acb = cb; self._aroom = roomId;
        var fire = function () { var d = readAll()[roomId]; cb(activityList(d && d.activity)); };
        var bc = function (e) { if (e.data && e.data.roomId === roomId) fire(); };
        var sh = function (e) { if (e.key === MOCK_KEY) fire(); };
        if (channel) channel.addEventListener('message', bc);
        window.addEventListener('storage', sh);
        fire();
        return function () { if (channel) channel.removeEventListener('message', bc); window.removeEventListener('storage', sh); self._acb = null; };
      }
    };
  }

  function activityList(map) {
    return Object.keys(map || {}).map(function (k) { return map[k]; }).filter(function (a) { return a && typeof a.t === 'number'; }).sort(function (a, b) { return a.t - b.t; }).slice(-100);
  }

  function firebaseAdapter() {
    var base = 'https://www.gstatic.com/firebasejs/' + SDK_VERSION + '/';
    var ready = Promise.all([import(base + 'firebase-app.js'), import(base + 'firebase-database.js')]).then(function (mods) {
      var appMod = mods[0], dbMod = mods[1];
      var fbApp = appMod.initializeApp(config);
      var db = dbMod.getDatabase(fbApp);
      return { db: db, m: dbMod };
    }, function (err) {
      var e = new Error('네트워크 문제로 가족 공유 서버에 연결하지 못했습니다. 기록은 이 기기에 저장되며, 인터넷이 연결되면 자동으로 다시 시도합니다.');
      e.code = 'SDK_LOAD'; e.cause = err;
      throw e;
    });
    function roomRef(fb, roomId) { return fb.m.ref(fb.db, 'rooms/' + roomId); }
    return {
      get: function (roomId) {
        return ready.then(function (fb) { return fb.m.get(roomRef(fb, roomId)); }).then(function (snap) { return snap.exists() ? snap.val() : null; });
      },
      update: function (roomId, updates) {
        return ready.then(function (fb) { return fb.m.update(roomRef(fb, roomId), updates); });
      },
      subscribe: function (roomId, cb, onError) {
        var off = null, cancelled = false;
        ready.then(function (fb) {
          if (cancelled) return;
          off = fb.m.onValue(roomRef(fb, roomId), function (snap) { cb(snap.exists() ? snap.val() : null); }, function (err) { if (onError) onError(err); });
        }, function (err) { if (onError) onError(err); });
        return function () { cancelled = true; if (off) off(); };
      },
      onConnection: function (cb) {
        var off = null, cancelled = false;
        ready.then(function (fb) {
          if (cancelled) return;
          off = fb.m.onValue(fb.m.ref(fb.db, '.info/connected'), function (snap) { cb(snap.val() === true); });
        }, function () { cb(false); });
        return function () { cancelled = true; if (off) off(); };
      },
      pushActivity: function (roomId, entry) {
        return ready.then(function (fb) {
          var aref = fb.m.ref(fb.db, 'rooms/' + roomId + '/activity');
          return fb.m.push(aref, entry).then(function () {
            // keep the log bounded: drop oldest beyond 120
            return fb.m.get(fb.m.query(aref, fb.m.orderByKey())).then(function (snap) {
              var keys = []; snap.forEach(function (c) { keys.push(c.key); });
              if (keys.length <= 120) return;
              var upd = {}; keys.slice(0, keys.length - 100).forEach(function (k) { upd[k] = null; });
              return fb.m.update(aref, upd);
            });
          });
        });
      },
      subscribeActivity: function (roomId, cb) {
        var off = null, cancelled = false;
        ready.then(function (fb) {
          if (cancelled) return;
          var q = fb.m.query(fb.m.ref(fb.db, 'rooms/' + roomId + '/activity'), fb.m.limitToLast(100));
          off = fb.m.onValue(q, function (snap) { cb(activityList(snap.exists() ? snap.val() : {})); }, function () { cb([]); });
        }, function () { cb([]); });
        return function () { cancelled = true; if (off) off(); };
      },
      ready: ready
    };
  }

  /* ---------- room lifecycle ---------- */
  var offConnection = null;
  var offActivity = null;
  var wasOnline = null;

  function attach(roomId) {
    detach();
    sync.roomId = roomId;
    storeRoom(roomId);
    setUrlRoom(roomId);
    setStatus('connecting');
    sync.unsubscribe = sync.adapter.subscribe(roomId, function (doc) {
      sync.lastDoc = doc ? JSON.parse(JSON.stringify(doc)) : null;
      sync.lastSyncedAt = new Date();
      if (doc && !isEmptyDoc(doc)) app.applyRemote(stateFromDoc(doc));
      if (sync.status !== 'offline') setStatus('online');
      else emit();
    }, function (err) {
      setStatus('error', errText(err, '연결 오류: '), errCode(err));
    });
    if (app.setActivity && sync.adapter.subscribeActivity) {
      offActivity = sync.adapter.subscribeActivity(roomId, function (list) { app.setActivity(list); });
    }
    clearOldActivityOnce(roomId);
    offConnection = sync.adapter.onConnection(function (online) {
      if (wasOnline === online) return;
      wasOnline = online;
      if (!online) setStatus('offline', '오프라인입니다. 변경은 기기에 저장되고 연결되면 자동으로 올라갑니다.');
      else if (sync.status === 'offline') setStatus('online');
    });
  }

  // 홈의 '최근 변경' 칸을 없애면서 그동안 쌓인 변경 기록을 방마다 한 번 비운다.
  // (새 변경은 계속 기록된다: 앱을 보는 중에 가족의 변경을 알림 문구로 띄우는 데 쓴다)
  var ACTIVITY_CLEARED_KEY = 'birth-bag-checklist:activity-cleared';
  function clearOldActivityOnce(roomId) {
    var done = {};
    try { done = JSON.parse(window.localStorage.getItem(ACTIVITY_CLEARED_KEY) || '{}') || {}; } catch (e) { done = {}; }
    if (done[roomId]) return;
    sync.adapter.update(roomId, { activity: null }).then(function () {
      done[roomId] = true;
      try { window.localStorage.setItem(ACTIVITY_CLEARED_KEY, JSON.stringify(done)); } catch (e) { /* ignore */ }
    }, function () { /* 다음에 연결될 때 다시 시도 */ });
  }

  function detach() {
    if (sync.unsubscribe) { sync.unsubscribe(); sync.unsubscribe = null; }
    if (offActivity) { offActivity(); offActivity = null; if (app.setActivity) app.setActivity([]); }
    if (offConnection) { offConnection(); offConnection = null; }
    wasOnline = null;
  }

  function pushFull(roomId) {
    var next = docFromState(app.getState());
    sync.lastDoc = next;
    return sync.adapter.update(roomId, diff(null, next));
  }

  function createRoom() {
    if (!configured) return Promise.reject(new Error('unconfigured'));
    var id = randomId(24);
    setStatus('connecting');
    return pushFull(id).then(function () {
      attach(id);
      return id;
    }, function (err) {
      setStatus('error', errText(err, '공유 링크를 만들지 못했습니다: '), errCode(err));
      throw err;
    });
  }

  // Joins an existing room. Remote wins when it has data; an empty room receives this device's list.
  function joinRoom(id, opts) {
    opts = opts || {};
    var roomId = extractRoomId(id);
    if (!roomId) return Promise.reject(new Error('invalid'));
    if (!configured) return Promise.reject(new Error('unconfigured'));
    setStatus('connecting');
    // 지난번에 서버에 못 올린 변경(오프라인 중 종료 등)이 있으면 먼저 올린 뒤 받는다 → 서버 내용이 로컬 변경을 덮어쓰지 않는다.
    var queued = pendingFor(roomId);
    var pre = queued ? sync.adapter.update(roomId, queued).then(function () { clearPending(roomId, queued); }) : Promise.resolve();
    return pre.then(function () { return sync.adapter.get(roomId); }).then(function (doc) {
      if (isEmptyDoc(doc)) {
        if (opts.silent && !app.isPristine()) {
          // 이 기기가 쓰던 방인데 서버에 내용이 없다 = 방이 지워졌을 가능성. 조용히 재생성하지 않고 묻는다.
          var go = window.confirm('공유 방에 저장된 목록이 없습니다. 방이 지워졌거나 비워졌을 수 있어요.\n이 기기의 현재 목록으로 이 방을 다시 시작할까요?\n(취소하면 공유를 끊고 이 기기 기록만 유지합니다.)');
          if (!go) { storeRoom(null); setUrlRoom(null); setStatus('off'); return null; }
        }
        return pushFull(roomId).then(function () { attach(roomId); return roomId; });
      }
      var remoteState = stateFromDoc(doc);
      var local = app.getState();
      var same = JSON.stringify(app.normalize(remoteState)) === JSON.stringify(local);
      if (!same && !opts.silent && !app.isPristine()) {
        var ok = window.confirm('이 공유 링크에는 이미 목록(분류 ' + remoteState.categories.length + '개, 준비물 ' + remoteState.items.length + '개, 진료 메모 ' + remoteState.notes.length + '개' + (remoteState.ledger && remoteState.ledger.length ? ', 가계부 ' + remoteState.ledger.length + '건' : '') + ')이 있습니다.\n이 기기의 현재 목록' + (local.ledger && local.ledger.length ? '(가계부 ' + local.ledger.length + '건 포함)' : '') + '을 그 목록으로 교체하고 함께 사용할까요?\n(취소하면 참여하지 않습니다. 현재 목록은 백업 메뉴에서 먼저 내보낼 수 있습니다.)');
        if (!ok) { setStatus('off'); return null; }
      }
      sync.lastDoc = JSON.parse(JSON.stringify(doc));
      app.applyRemote(remoteState);
      attach(roomId);
      return roomId;
    }, function (err) {
      setStatus('error', errText(err, '연결 오류: '), errCode(err));
      throw err;
    });
  }

  function leaveRoom() {
    detach();
    sync.roomId = null;
    sync.lastDoc = null;
    storeRoom(null);
    setUrlRoom(null);
    setStatus('off');
  }

  function extractRoomId(input) {
    var s = String(input || '').trim();
    if (validRoomId(s)) return s;
    try { var u = new URL(s); var r = u.searchParams.get('room'); if (validRoomId(r)) return r; } catch (e) { /* not a url */ }
    var m = s.match(/room=([a-z0-9]{20,40})/);
    return m ? m[1] : null;
  }

  /* ---------- local change -> remote ---------- */
  app.onChange(function (state) {
    if (!sync.roomId || !sync.adapter) return;
    var next = docFromState(state);
    var updates = diff(sync.lastDoc, next);
    if (!Object.keys(updates).length) return;
    sync.lastDoc = next;
    var room = sync.roomId;
    addPending(room, updates);
    sync.adapter.update(room, updates).then(function () {
      clearPending(room, updates);
      sync.lastSyncedAt = new Date();
      emit();
    }, function (err) {
      setStatus('error', errText(err, '저장을 서버에 올리지 못했습니다: '), errCode(err));
    });
  });

  /* ---------- public API ---------- */
  window.ChecklistSync = {
    getState: publicState,
    onStatus: function (cb) { sync.listeners.push(cb); },
    createRoom: createRoom,
    joinRoom: joinRoom,
    leaveRoom: leaveRoom,
    extractRoomId: extractRoomId,
    logActivity: function (entry) {
      if (!sync.roomId || !sync.adapter || !sync.adapter.pushActivity) return;
      var who = (app.getDeviceName ? app.getDeviceName() : '') || '나';
      var e = { t: Date.now(), who: String(who).slice(0, 12), kind: String(entry.kind || '').slice(0, 20), text: String(entry.text || '').slice(0, 120) };
      sync.adapter.pushActivity(sync.roomId, e).catch(function () { /* best-effort */ });
    }
  };

  /* ---------- init ---------- */
  if (configured) {
    sync.adapter = useMock ? mockAdapter() : firebaseAdapter();
    var fromUrl = extractRoomId(params.get('room') || '');
    var stored = readStoredRoom();
    var roomId = fromUrl || stored;
    if (roomId) {
      // A room this device already joined reconnects silently; a new link asks before replacing local data.
      // 앱 상태(app.js init)가 준비된 뒤에 참여한다(즉시 응답하는 어댑터에서도 안전).
      var startJoin = function () { joinRoom(roomId, { silent: roomId === stored }).catch(function (err) {
        // 상태가 아직 '연결 중'이면 처리 도중 예외가 난 것 → 사용자에게 오류로 보여준다
        if (sync.status === 'connecting') setStatus('error', errText(err, '연결 오류: '), errCode(err));
        window.__syncInitError = err;
      }); };
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startJoin); else startJoin();
    }
  } else if (params.get('room')) {
    setStatus('unconfigured', '공유 링크가 있지만 이 사이트에 Firebase 설정이 없습니다.');
  }
  // 오프라인으로 시작해 Firebase 스크립트를 못 받은 경우: 인터넷이 돌아오면 자동으로 다시 연결
  window.addEventListener('online', function () {
    if (!configured || useMock) return;
    if (sync.status === 'error' && sync.errorCode === 'SDK_LOAD') {
      sync.adapter = firebaseAdapter();
      var r = sync.roomId || readStoredRoom();
      if (r) joinRoom(r, { silent: true }).catch(function () { /* status already set */ });
    }
  });
  emit();
})();
