/* 서비스 워커 — 앱 셸 오프라인 지원 (네트워크 우선, 실패 시 캐시)
   온라인이면 항상 최신 파일을 받고, 오프라인이면 마지막으로 받은 화면을 보여준다.
   같은 출처(same-origin)만 처리하고, Firebase 등 외부 요청은 건드리지 않는다. */
var CACHE = 'birth-bag-checklist-20261126a'; // 배포마다 index.html의 ?v= 와 함께 올린다 → 옛 캐시 자동 삭제
var CORE = [
  './',
  './index.html',
  './style.css?v=20261126a',
  './app.js?v=20261126a',
  './sync.js?v=20261126a',
  './firebase-config.js?v=20261126a',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png',
  './favicon.ico',
  './favicon-48.png',
  './favicon-32.png',
  './icon-maskable-512.png'
];

self.addEventListener('install', function (e) {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(function (c) {
    // best-effort: don't fail install if one asset is momentarily unavailable
    return Promise.allSettled(CORE.map(function (u) { return c.add(u); }));
  }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) { return k === CACHE ? null : caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // let cross-origin (Firebase/gstatic) pass through

  e.respondWith(
    fetch(req).then(function (res) {
      if (res && res.status === 200 && res.type === 'basic') {
        var copy = res.clone();
        // 화면 주소(?room= 등)마다 따로 쌓이지 않게 페이지는 index.html 하나로 보관한다.
        // 앱 화면(폴더 주소·index.html)만 보관 — README 같은 다른 문서가 오프라인 화면을 덮어쓰지 않게
        var isShell = /\/(index\.html)?$/.test(url.pathname);
        if (req.mode !== 'navigate' || isShell) caches.open(CACHE).then(function (c) { c.put(req.mode === 'navigate' ? './index.html' : req, copy); });
      }
      return res;
    }).catch(function () {
      return caches.match(req.mode === 'navigate' ? './index.html' : req).then(function (hit) {
        return hit || caches.match('./index.html');
      });
    })
  );
});

// 웹 푸시: GitHub Actions(scripts/push_send.py)가 보낸 알림을 띄우고, 누르면 그 화면을 연다
self.addEventListener('push', function (e) {
  var d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { body: e.data ? e.data.text() : '' }; }
  var url = new URL(d.url || './', self.registration.scope).href;
  e.waitUntil(self.registration.showNotification(d.title || 'luckybbu', {
    body: d.body || '', icon: './icon-192.png', badge: './favicon-48.png', tag: d.tag || 'luckybbu', data: { url: url }
  }));
});
self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  var url = (e.notification.data && e.notification.data.url) || self.registration.scope;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      if (c.url.indexOf(self.registration.scope) === 0 && 'navigate' in c) return c.navigate(url).then(function (w) { return (w || c).focus(); });
    }
    return self.clients.openWindow(url);
  }));
});
