// POST /api/create-deposit   body: { method, amount, clientRef, userId? }
// Header: Authorization: Bearer <Firebase ID token>
// يُنشئ طلب إيداع "معلّق" لطرق الدفع اليدوية (Binance Pay / Crypto USDT / CIH Bank - Cash Plus) ويرجع تعليمات الدفع + رمز مرجعي.
// المعرّف الحقيقي للمستخدم يؤخذ من الـ token فقط؛ أي userId يرسله المتصفح يُتجاهل (يمكن تعديله من localStorage).
// الرصيد لا يُضاف هنا: يُضاف يدوياً بعد تأكيدك استلام المبلغ (أو لاحقاً عبر webhook/لوحة إدارة).
//
// متغيرات البيئة (Vercel) — نص حر يظهر للعميل كما هو، مثال:
//   PAY_BINANCE_INFO = "Binance Pay ID: 123456789"
//   PAY_USDT_INFO    = "USDT (TRC20)\nAddress: T...."
//   PAY_MOROCCO_INFO = "CIH Bank — RIB: ....\nCash Plus — الاسم: .... / الهاتف: ...."
// طريقة بلا متغير تعتبر غير متاحة (503).

const errText = (e) => String((e && (e.message || e.code)) || e).slice(0, 300);

const METHODS = {
  binance: { env: "PAY_BINANCE_INFO", name: "Binance Pay" },
  usdt: { env: "PAY_USDT_INFO", name: "Crypto USDT" },
  morocco: { env: "PAY_MOROCCO_INFO", name: "CIH Bank / Cash Plus" },
};
const MAX_PENDING = 20;

async function handle(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed", detail: "Use POST" });

  let admin, db, auth;
  try {
    if (!process.env.FIREBASE_SERVICE_ACCOUNT) throw new Error("Missing env FIREBASE_SERVICE_ACCOUNT");
    ({ admin, db, auth } = require("../lib/firebase"));
  } catch (e) {
    console.error("init_failed", e);
    return res.status(500).json({ error: "init_failed", detail: errText(e) });
  }
  const FV = admin.firestore.FieldValue;

  // 1) المستخدم (من الـ token فقط)
  let uid;
  try {
    const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    if (!token) return res.status(401).json({ error: "unauthorized", detail: "Missing Authorization header" });
    uid = (await auth.verifyIdToken(token)).uid;
  } catch (e) {
    return res.status(401).json({ error: "unauthorized", detail: errText(e) });
  }

  // 2) التحقق من المدخلات
  const body = req.body || {};
  const method = String(body.method || "");
  const m = METHODS[method];
  if (!m) return res.status(400).json({ error: "unknown_method", detail: "Allowed: " + Object.keys(METHODS).join(", ") });
  const amount = Math.round(Number(body.amount) * 100) / 100;
  if (!(amount >= 1 && amount <= 500)) return res.status(400).json({ error: "invalid_amount", detail: "Allowed 1–500" });
  const clientRef = String(body.clientRef || "");
  if (!/^[A-Za-z0-9-]{8,64}$/.test(clientRef)) return res.status(400).json({ error: "invalid_client_ref", detail: "8–64 chars: letters, digits, dash" });
  const instructions = process.env[m.env];
  if (!instructions) return res.status(503).json({ error: "method_unavailable", detail: "Missing env " + m.env });

  try {
    const ref = db.collection("deposits").doc(clientRef);          // المعرّف = clientRef لمنع التكرار عند إعادة الإرسال
    const existing = await ref.get();
    if (existing.exists) {
      const x = existing.data();
      if (x.uid !== uid) return res.status(409).json({ error: "conflict", detail: "clientRef already used" });
      return res.status(200).json({ id: ref.id, reference: x.reference, method: x.method, amount: x.amount, accountId: x.userId ?? null, instructions, status: x.status, duplicate: true });
    }

    // حد للطلبات المعلّقة لكل مستخدم
    const mine = await db.collection("deposits").where("uid", "==", uid).get();
    if (mine.docs.filter((d) => d.data().status === "pending").length >= MAX_PENDING)
      return res.status(429).json({ error: "too_many_pending", detail: "Max " + MAX_PENDING + " pending deposits" });

    const u = await db.collection("users").doc(uid).get();
    const numeric = u.exists && u.data().userId != null ? String(u.data().userId) : uid.slice(0, 5).toUpperCase();
    const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
    const reference = `LF${numeric}-${rand}`;

    await ref.set({
      uid, userId: u.exists ? u.data().userId ?? null : null,
      method, amount, currency: "USD", reference, status: "pending",
      createdAt: FV.serverTimestamp(),
    });
    return res.status(200).json({ id: ref.id, reference, method, amount, accountId: u.exists ? u.data().userId ?? null : null, instructions, status: "pending" });
  } catch (e) {
    console.error("create-deposit failed", e);
    return res.status(500).json({ error: "server_error", detail: "Firestore: " + errText(e) });
  }
}

module.exports = async (req, res) => {
  try { return await handle(req, res); }
  catch (e) {
    console.error("unhandled", e);
    if (!res.headersSent) return res.status(500).json({ error: "server_error", detail: errText(e) });
  }
};
