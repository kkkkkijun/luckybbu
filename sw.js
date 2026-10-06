/* 서비스 워커 — 앱 셸 오프라인 지원 (네트워크 우선, 실패 시 캐시)
   온라인이면 항상 최신 파일을 받고, 오프라인이면 마지막으로 받은 화면을 보여준다.
   같은 출처(same-origin)만 처리하고, Firebase 등 외부 요청은 건드리지 않는다. */
var CACHE = 'birth-bag-checklist-20261006f'; // 배포마다 index.html의 ?v= 와 함께 올린다 → 옛 캐시 자동 삭제
var CORE = [
  './',
  './index.html',
  './style.css?v=20261006f',
  './app.js?v=20261006f',
  './sync.js?v=20261006f',
  './firebase-config.js?v=20261006f',
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
        // 화면 주소(?room= 등)마다 따로 쌓이지 않게 페이지는 index.html 하나로 보관한다
        var key = req.mode === 'navigate' ? './index.html' : req;
        caches.open(CACHE).then(function (c) { c.put(key, copy); });
      }
      return res;
    }).catch(function () {
      return caches.match(req.mode === 'navigate' ? './index.html' : req).then(function (hit) {
        return hit || caches.match('./index.html');
      });
    })
  );
});
