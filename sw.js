// Service Worker — Layal Folw
// القاعدة: لا نخزّن أي شيء يخص الـ API أو Firebase أو بيانات المستخدم.
// الصفحات: الشبكة أولاً (حتى لا تظهر نسخة قديمة)، ونسخة احتياطية عند انقطاع الاتصال.
// الأيقونات والـ manifest: من الذاكرة أولاً.
const V = "lf-v1";
const SHELL = ["/manifest.json", "/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(V).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== V).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

const offlinePage = () =>
  new Response(
    '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Offline</title><body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#070b14;color:#e5ecff;font-family:system-ui,sans-serif;text-align:center;padding:24px">' +
    '<div><h2 style="color:#22e0f0">لا يوجد اتصال بالإنترنت</h2><p>No internet connection</p>' +
    '<button onclick="location.reload()" style="margin-top:12px;padding:10px 22px;border:0;border-radius:12px;background:#22e0f0;color:#04202a;font-weight:700">Retry / إعادة المحاولة</button></div></body>',
    { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } }
  );

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin) return;          // لا نتدخل في Firebase/Stripe/الخارج
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/__/")) return;

  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) { const copy = res.clone(); caches.open(V).then((c) => c.put(req, copy)); }
          return res;
        })
        .catch(async () => (await caches.match(req)) || (await caches.match("/")) || offlinePage())
    );
    return;
  }

  if (url.pathname.startsWith("/icons/") || url.pathname === "/manifest.json") {
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(V).then((c) => c.put(req, copy)); }
        return res;
      }))
    );
  }
});
