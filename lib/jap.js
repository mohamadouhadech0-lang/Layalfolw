// الاتصال بـ JustAnotherPanel من الخادم فقط (المفتاح لا يظهر للمتصفح)
const JAP_URL = "https://justanotherpanel.com/api/v2";
const MARKUP = Number(process.env.PRICE_MARKUP || 1); // 1.3 = ربح 30% فوق سعر المزوّد

async function jap(params) {
  const r = await fetch(JAP_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ key: process.env.JAP_API_KEY, ...params }),
    signal: AbortSignal.timeout(15000),
  });
  return r.json();
}

let cache = { t: 0, list: null, map: null };

async function getServices() {
  if (cache.list && Date.now() - cache.t < 5 * 60 * 1000) return cache;
  const raw = await jap({ action: "services" });
  if (!Array.isArray(raw)) throw new Error("jap_services_failed");
  const list = raw.map((s) => ({
    id: Number(s.service),
    name: s.name,
    category: s.category,
    rate: Math.round(Number(s.rate) * MARKUP * 10000) / 10000, // سعر البيع لكل 1000
    min: Number(s.min),
    max: Number(s.max),
  }));
  cache = { t: Date.now(), list, map: new Map(list.map((s) => [s.id, s])) };
  return cache;
}

module.exports = { jap, getServices };
