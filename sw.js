// Homie 作業通 — Service Worker
// 策略：網頁本體 network-first（避免舊版卡住）；靜態資源 cache-first；AI API 一律走網路不快取。
const CACHE = 'homie-v0.5.0';
const SHELL = [
  './',
  './index.html',
  './logo.png',
  './icon-192.png',
  './icon-512.png',
  'https://cdnjs.cloudflare.com/ajax/libs/marked/9.1.6/marked.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/dompurify/3.0.8/purify.min.js'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  // AI API 請求（含串流）不經過快取
  if (/googleapis\.com|anthropic\.com|openai\.com/.test(url.hostname)) return;

  if (e.request.mode === 'navigate') {
    // network-first：拿得到新版就用新版並更新快取，離線時退回快取
    e.respondWith(
      fetch(e.request)
        .then(r => { const cp = r.clone(); caches.open(CACHE).then(c => c.put(e.request, cp)); return r; })
        .catch(() => caches.match('./index.html'))
    );
  } else {
    // cache-first：靜態資源
    e.respondWith(
      caches.match(e.request).then(hit => hit || fetch(e.request).then(r => {
        const cp = r.clone();
        caches.open(CACHE).then(c => c.put(e.request, cp));
        return r;
      }))
    );
  }
});
