// POST /api/create-order   body: { service, link, quantity }
// Header: Authorization: Bearer <Firebase ID token>
// الخصم والتحقق والسعر كلها في الخادم؛ المتصفح لا يحدد السعر أبداً.
//
// وضع التشخيص: كل رد خطأ يحتوي { error: "<رمز>", detail: "<السبب الحقيقي>" }.
// بعد حل المشكلة يُفضّل حذف حقل detail من الردود لأسباب أمنية.

const errText = (e) => String((e && (e.message || e.code)) || e).slice(0, 300);

async function handle(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed", detail: "Use POST" });

  // تحميل الاعتمادات هنا (وليس أعلى الملف) كي يظهر أي خطأ تهيئة داخل الرد
  // مثل: Cannot find module / FIREBASE_SERVICE_ACCOUNT غير صالح / JAP_API_KEY ناقص
  let admin, db, auth, jap, getServices, translate;
  try {
    if (!process.env.FIREBASE_SERVICE_ACCOUNT) throw new Error("Missing env FIREBASE_SERVICE_ACCOUNT");
    if (!process.env.JAP_API_KEY) throw new Error("Missing env JAP_API_KEY");
    ({ admin, db, auth } = require("../lib/firebase"));
    ({ jap, getServices } = require("../lib/jap"));
    ({ translate } = require("../lib/reasons"));
  } catch (e) {
    console.error("init_failed", e);
    return res.status(500).json({ error: "init_failed", detail: errText(e) });
  }
  const FV = admin.firestore.FieldValue;

  // 1) المستخدم
  let uid;
  try {
    const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    if (!token) return res.status(401).json({ error: "unauthorized", detail: "Missing Authorization header" });
    uid = (await auth.verifyIdToken(token)).uid;
  } catch (e) {
    console.error("auth failed", e);
    return res.status(401).json({ error: "unauthorized", detail: errText(e) });
  }

  // 2) التحقق من المدخلات + السعر من قائمة المزوّد
  const body = req.body || {};
  const serviceId = Number(body.service);
  const quantity = Number(body.quantity);
  const link = String(body.link || "").trim();

  try {
    const u = new URL(link);
    if (!/^https?:$/.test(u.protocol) || link.length > 500) throw new Error("bad protocol or too long");
  } catch (e) {
    return res.status(400).json({ error: "invalid_link", detail: errText(e) });
  }

  let svc;
  try {
    svc = (await getServices()).map.get(serviceId);
  } catch (e) {
    console.error("services failed", e);
    return res.status(502).json({ error: "services_unavailable", detail: errText(e) });
  }
  if (!svc) return res.status(400).json({ error: "unknown_service", detail: "Service id " + serviceId + " not found in provider list" });
  if (!Number.isInteger(quantity) || quantity < svc.min || quantity > svc.max)
    return res.status(400).json({ error: "invalid_quantity", detail: `Allowed ${svc.min}–${svc.max}`, min: svc.min, max: svc.max });

  const cost = Math.round(((quantity * svc.rate) / 1000) * 10000) / 10000;
  if (!(cost > 0)) return res.status(400).json({ error: "invalid_quantity", detail: "Computed cost is 0" });

  // 3) خصم الرصيد وإنشاء الطلب (pending) في معاملة واحدة
  const userRef = db.collection("users").doc(uid);
  const orderRef = db.collection("orders").doc();
  let newBalance = 0;
  let seenBalance = 0;
  try {
    await db.runTransaction(async (tx) => {
      const u = await tx.get(userRef);
      if (!u.exists) throw new Error("user_not_found");
      const bal = Number(u.data().balance) || 0;
      seenBalance = bal;
      if (bal < cost) throw new Error("insufficient_balance");
      newBalance = Math.round((bal - cost) * 10000) / 10000;
      tx.update(userRef, { balance: FV.increment(-cost), spent: FV.increment(cost) });
      tx.set(orderRef, {
        uid, service: serviceId, serviceName: svc.name, link, quantity, cost,
        status: "pending", createdAt: FV.serverTimestamp(),
      });
    });
  } catch (e) {
    if (e.message === "insufficient_balance")
      return res.status(402).json({ error: "insufficient_balance", detail: `Balance $${seenBalance} < cost $${cost}` });
    if (e.message === "user_not_found")
      return res.status(404).json({ error: "user_not_found", detail: "Document users/" + uid + " does not exist" });
    console.error("transaction failed", e);
    return res.status(500).json({ error: "server_error", detail: "Firestore: " + errText(e) });
  }

  // 4) إرسال الطلب للمزوّد
  let r;
  try {
    r = await jap({ action: "add", service: serviceId, link, quantity });
  } catch (e) {
    // مهلة/رد غير مفهوم: قد يكون الطلب وصل للمزوّد، فلا نُرجع الرصيد تلقائياً — يُراجع يدوياً
    console.error("jap add unknown result", orderRef.id, e);
    await orderRef.update({ status: "review" }).catch(() => {});
    return res.status(202).json({
      id: orderRef.id, status: "review", cost, balance: newBalance,
      detail: "Provider response unclear: " + errText(e),
    });
  }

  if (r && r.order) {
    await orderRef.update({ status: "processing", japOrder: String(r.order) }).catch((e) => console.error(e));
    return res.status(200).json({ id: orderRef.id, status: "processing", cost, balance: newBalance });
  }

  // 5) رفض صريح من المزوّد: نُرجع الرصيد ونُعلّم الطلب failed
  const providerMsg = String((r && (r.error || JSON.stringify(r))) || "empty response").slice(0, 300);
  console.error("jap add rejected", orderRef.id, r);
  try {
    await db.runTransaction(async (tx) => {
      tx.update(userRef, { balance: FV.increment(cost), spent: FV.increment(-cost) });
      const t = translate(providerMsg, "failed");
      tx.update(orderRef, {
        status: "failed", error: providerMsg,
        cancel_reason: t.ar, cancel_reason_en: t.en, cancel_reason_raw: providerMsg,
        refunded: true, refundAmount: cost, refundedAt: FV.serverTimestamp(),
      });
    });
  } catch (e) {
    console.error("REFUND FAILED", orderRef.id, uid, cost, e);
    return res.status(502).json({
      error: "provider_error", id: orderRef.id,
      detail: "Provider: " + providerMsg + " | REFUND FAILED: " + errText(e),
    });
  }
  return res.status(502).json({ error: "provider_error", id: orderRef.id, detail: "Provider: " + providerMsg });
}

module.exports = async (req, res) => {
  try {
    return await handle(req, res);
  } catch (e) {
    console.error("unhandled", e);
    if (!res.headersSent) return res.status(500).json({ error: "server_error", detail: errText(e) });
  }
};
