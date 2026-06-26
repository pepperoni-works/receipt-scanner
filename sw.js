const CACHE_NAME = 'receipt-scanner-v5';

// 手動更新トリガー（クライアント側からpostMessage）
self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js',
  'https://cdn.jsdelivr.net/npm/heic-to@1.4.2/dist/iife/heic-to.js',
  'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.min.js'
];

self.addEventListener('install', (e) => {
  // skipWaiting はしない（ユーザーが更新ボタン押すまで待機）
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  // API calls: network only
  if (e.request.url.includes('api.anthropic.com') || e.request.url.includes('script.google.com')) {
    return;
  }
  // HTML / app.js / style.css: network-first (常に最新を取得、オフライン時のみキャッシュ)
  const url = e.request.url;
  if (url.includes('/index.html') || url.endsWith('/') || url.includes('app.js') || url.includes('style.css')) {
    e.respondWith(
      fetch(e.request).then(res => {
        const clone = res.clone();
        caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
        return res;
      }).catch(() => caches.match(e.request))
    );
    return;
  }
  // その他（CDN libs, icons）: cache-first
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
