// POST /api/create-order   body: { service, link, quantity }
// Header: Authorization: Bearer <Firebase ID token>
// الخصم والتحقق والسعر كلها في الخادم؛ المتصفح لا يحدد السعر أبداً.
const { admin, db, auth } = require("../lib/firebase");
const { jap, getServices } = require("../lib/jap");

const FV = admin.firestore.FieldValue;

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  // 1) المستخدم
  let uid;
  try {
    const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    if (!token) return res.status(401).json({ error: "unauthorized" });
    uid = (await auth.verifyIdToken(token)).uid;
  } catch {
    return res.status(401).json({ error: "unauthorized" });
  }

  // 2) التحقق من المدخلات + السعر من قائمة المزوّد
  const body = req.body || {};
  const serviceId = Number(body.service);
  const quantity = Number(body.quantity);
  const link = String(body.link || "").trim();

  try {
    const u = new URL(link);
    if (!/^https?:$/.test(u.protocol) || link.length > 500) throw 0;
  } catch {
    return res.status(400).json({ error: "invalid_link" });
  }

  let svc;
  try {
    svc = (await getServices()).map.get(serviceId);
  } catch (e) {
    console.error(e);
    return res.status(502).json({ error: "services_unavailable" });
  }
  if (!svc) return res.status(400).json({ error: "unknown_service" });
  if (!Number.isInteger(quantity) || quantity < svc.min || quantity > svc.max)
    return res.status(400).json({ error: "invalid_quantity", min: svc.min, max: svc.max });

  const cost = Math.round(((quantity * svc.rate) / 1000) * 10000) / 10000;
  if (!(cost > 0)) return res.status(400).json({ error: "invalid_quantity" });

  // 3) خصم الرصيد وإنشاء الطلب (pending) في معاملة واحدة
  const userRef = db.collection("users").doc(uid);
  const orderRef = db.collection("orders").doc();
  try {
    await db.runTransaction(async (tx) => {
      const u = await tx.get(userRef);
      if (!u.exists) throw new Error("user_not_found");
      if ((Number(u.data().balance) || 0) < cost) throw new Error("insufficient_balance");
      tx.update(userRef, { balance: FV.increment(-cost), spent: FV.increment(cost) });
      tx.set(orderRef, {
        uid, service: serviceId, serviceName: svc.name, link, quantity, cost,
        status: "pending", createdAt: FV.serverTimestamp(),
      });
    });
  } catch (e) {
    if (e.message === "insufficient_balance") return res.status(402).json({ error: "insufficient_balance" });
    console.error(e);
    return res.status(500).json({ error: "server_error" });
  }

  // 4) إرسال الطلب للمزوّد
  let r;
  try {
    r = await jap({ action: "add", service: serviceId, link, quantity });
  } catch (e) {
    // مهلة/رد غير مفهوم: قد يكون الطلب وصل للمزوّد، فلا نُرجع الرصيد تلقائياً — يُراجع يدوياً
    console.error("jap add unknown result", orderRef.id, e);
    await orderRef.update({ status: "review" });
    return res.status(202).json({ id: orderRef.id, status: "review" });
  }

  if (r && r.order) {
    await orderRef.update({ status: "processing", japOrder: String(r.order) });
    return res.status(200).json({ id: orderRef.id, status: "processing" });
  }

  // 5) رفض صريح من المزوّد: نُرجع الرصيد ونُعلّم الطلب failed
  console.error("jap add rejected", orderRef.id, r);
  await db.runTransaction(async (tx) => {
    tx.update(userRef, { balance: FV.increment(cost), spent: FV.increment(-cost) });
    tx.update(orderRef, { status: "failed", error: String((r && r.error) || "unknown").slice(0, 200) });
  });
  return res.status(502).json({ error: "provider_error", id: orderRef.id });
};
