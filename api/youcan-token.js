// POST /api/youcan-token   body: { amount }   (المبلغ بالدولار USD)
// Header: Authorization: Bearer <Firebase ID token>
// ينشئ طلب شحن + رمز دفع (token) من YouCan Pay من جهة الخادم فقط (المفتاح الخاص لا يصل للمتصفح).
// الرصيد لا يُضاف هنا؛ يُضاف في /api/youcan-webhook بعد تأكيد الدفع من YouCan Pay.
//
// متغيرات البيئة (Vercel):
//   YOUCAN_PRIVATE_KEY  = pri_sandbox_...   (سري — لا تضعه في أي ملف)
//   YOUCAN_PUBLIC_KEY   = pub_sandbox_...
//   YOUCAN_SANDBOX      = 1  (اتركه 1 للتجريب؛ ضع 0 عند الانتقال للإنتاج بمفاتيح الإنتاج)
//   YOUCAN_CURRENCY     = MAD (افتراضي)
//   MAD_PER_USD         = 10  (سعر التحويل من دولار إلى درهم؛ يُستخدم فقط إذا كانت العملة MAD)
const crypto = require("crypto");
const errText = (e) => String((e && (e.message || e.code)) || e).slice(0, 300);

async function handle(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed", detail: "Use POST" });

  let admin, db, auth;
  try {
    for (const k of ["FIREBASE_SERVICE_ACCOUNT", "YOUCAN_PRIVATE_KEY", "YOUCAN_PUBLIC_KEY"]) if (!process.env[k]) throw new Error("Missing env " + k);
    ({ admin, db, auth } = require("../lib/firebase"));
  } catch (e) {
    console.error("init_failed", e);
    return res.status(500).json({ error: "init_failed", detail: errText(e) });
  }
  const FV = admin.firestore.FieldValue;

  // 1) المستخدم من الـ token فقط
  let uid;
  try {
    const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    if (!token) return res.status(401).json({ error: "unauthorized", detail: "Missing Authorization header" });
    uid = (await auth.verifyIdToken(token)).uid;
  } catch (e) {
    return res.status(401).json({ error: "unauthorized", detail: errText(e) });
  }

  // 2) المبلغ والعملة (يُحسبان في الخادم)
  const usd = Math.round(Number((req.body || {}).amount) * 100) / 100;
  if (!(usd >= 1 && usd <= 500)) return res.status(400).json({ error: "invalid_amount", detail: "Allowed 1–500 USD" });
  const currency = String(process.env.YOUCAN_CURRENCY || "MAD").toUpperCase();
  const rate = currency === "MAD" ? Number(process.env.MAD_PER_USD || 10) : 1;
  if (!(rate > 0)) return res.status(500).json({ error: "init_failed", detail: "Bad MAD_PER_USD" });
  const minor = Math.round(usd * rate * 100);                 // 2500 = 25.00 (أصغر وحدة)
  const sandbox = String(process.env.YOUCAN_SANDBOX ?? "1") !== "0";
  const orderId = "YC" + crypto.randomBytes(8).toString("hex");

  try {
    // 3) سجل الطلب قبل الاتصال بالبوابة (يستخدمه الـ webhook للتحقق من المبلغ والمستخدم)
    const ref = db.collection("youcan_orders").doc(orderId);
    await ref.set({ uid, usd, currency, minor, sandbox, status: "created", createdAt: FV.serverTimestamp() });

    // 4) Tokenize — الرابط الصحيح: https://youcanpay.com/sandbox/api/tokenize (وللإنتاج https://youcanpay.com/api/tokenize)
    const base = sandbox ? "https://youcanpay.com/sandbox/api" : "https://youcanpay.com/api";
    const form = new FormData();
    form.append("pri_key", process.env.YOUCAN_PRIVATE_KEY);
    form.append("order_id", orderId);
    form.append("amount", String(minor));
    form.append("currency", currency);
    form.append("metadata[type]", "topup");
    form.append("metadata[uid]", uid);
    let j, status;
    try {
      const r = await fetch(base + "/tokenize", { method: "POST", headers: { Accept: "application/json" }, body: form, signal: AbortSignal.timeout(15000) });
      status = r.status;
      const txt = await r.text();
      try { j = JSON.parse(txt); } catch { j = { message: txt.slice(0, 200) }; }
    } catch (e) {
      await ref.update({ status: "failed", error: errText(e) }).catch(() => {});
      return res.status(502).json({ error: "provider_unreachable", detail: errText(e) });
    }
    const tokenId = typeof j.token === "string" ? j.token : j.token && j.token.id;   // الشكلان موثّقان
    if (!tokenId) {
      const why = String(j.message || (j.errors && JSON.stringify(j.errors)) || j.error || "no token in response").slice(0, 300);
      console.error("youcan tokenize failed", status, j);
      await ref.update({ status: "failed", error: why }).catch(() => {});
      return res.status(502).json({ error: "provider_error", detail: "YouCan Pay " + status + ": " + why });
    }
    await ref.update({ status: "pending", tokenId, transactionId: j.transaction_id || null });
    return res.status(200).json({ orderId, tokenId, publicKey: process.env.YOUCAN_PUBLIC_KEY, sandbox, currency, amountUsd: usd, amountMinor: minor });
  } catch (e) {
    console.error("youcan-token failed", e);
    return res.status(500).json({ error: "server_error", detail: errText(e) });
  }
}

module.exports = async (req, res) => {
  try { return await handle(req, res); }
  catch (e) {
    console.error("unhandled", e);
    if (!res.headersSent) return res.status(500).json({ error: "server_error", detail: errText(e) });
  }
};
