/* 离线缓存
   策略：network-first —— 有网络时始终取最新文件，保证更新能立刻生效；
        断网时回落到缓存，保证添加到主屏后离线也能打开。
   （之前用 cache-first 会导致改动被旧缓存长期屏蔽，已修正） */

const CACHE = 'timetrack-v2';
const ASSETS = [
  './index.html',
  './styles.css',
  './js/store.js',
  './js/charts.js',
  './js/app.js',
  './manifest.webmanifest'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      // 逐个添加，单个失败不影响整体安装
      .then(c => Promise.all(ASSETS.map(u => c.add(u).catch(() => null))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== location.origin) return;

  e.respondWith(
    fetch(req)
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
        return res;
      })
      .catch(() =>
        caches.match(req).then(hit => hit || caches.match('./index.html'))
      )
  );
});