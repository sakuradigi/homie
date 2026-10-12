// Homie 作業通 — Service Worker
// 策略：網頁本體 network-first（避免舊版卡住）；靜態資源 cache-first；AI API 一律走網路不快取。
const CACHE = 'homie-v0.13.0';
const SHELL = [
  './',
  './index.html',
  './about.html',
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
      .then(keys => Promise.all(keys.filter(k => k !== CACHE && k !== 'homie-share').map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// 從相簿「分享」到 Homie（manifest 的 share_target）：收下照片暫存到 homie-share，再導回首頁讓頁面讀取
async function handleShare(request) {
  const form = await request.formData();
  const files = form.getAll('photos').filter(f => f && f.size);
  await caches.delete('homie-share');
  const cache = await caches.open('homie-share');
  await Promise.all(files.map((f, i) =>
    cache.put(new URL('shared/' + i, self.registration.scope).href, new Response(f, { headers: { 'Content-Type': f.type || 'image/jpeg' } }))));
  return Response.redirect(new URL('index.html?shared=' + files.length, self.registration.scope).href, 303);
}

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method === 'POST' && url.pathname.endsWith('/share-target')) {
    e.respondWith(handleShare(e.request));
    return;
  }
  if (e.request.method !== 'GET') return;
  // AI API 請求（含串流）不經過快取
  if (/googleapis\.com|anthropic\.com|openai\.com/.test(url.hostname)) return;

  if (e.request.mode === 'navigate') {
    // network-first：拿得到新版就用新版並更新快取，離線時退回快取
    e.respondWith(
      fetch(e.request)
        .then(r => { const cp = r.clone(); caches.open(CACHE).then(c => c.put(e.request, cp)); return r; })
        .catch(() => caches.match(e.request).then(hit => hit || caches.match('./index.html')))
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
