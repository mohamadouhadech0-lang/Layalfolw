// POST /api/sync-orders
// Header: Authorization: Bearer <Firebase ID token>
// 1) يجلب حالة طلبات المستخدم غير المنتهية من JAP (action=status) ويحدّثها في Firestore.
// 2) للطلبات الملغاة/الجزئية: يخزّن السبب (cancel_reason بالعربية + cancel_reason_en + cancel_reason_raw)
//    ويُرجع المبلغ للرصيد مرة واحدة فقط (يُسجَّل في refunded / refundAmount).
// الواجهة تقرأ orders عبر onSnapshot، فيظهر كل تغيير فوراً.
//
// ملاحظة: رد JAP على status لا يحتوي سبب إلغاء رسمياً (الحقول المعتادة: charge, start_count, status, remains, currency).
// لذلك نقرأ أي حقل نصي إضافي إن أرسله المزوّد، وإلا نعرض رسالة عامة صادقة.
// لإيقاف الاسترجاع التلقائي: أضف في Vercel المتغير AUTO_REFUND=off

const errText = (e) => String((e && (e.message || e.code)) || e).slice(0, 300);

const ACTIVE = new Set(["pending", "processing", "inprogress"]);   // ما زال يحتاج متابعة
const REFUNDABLE = new Set(["canceled", "partial"]);               // يُرجَع مبلغه
const REFUND_ON = String(process.env.AUTO_REFUND || "").toLowerCase() !== "off";

const norm = (t) => {
  const k = String(t || "").toLowerCase().replace(/[^a-z]/g, "");
  return k === "cancelled" ? "canceled" : k;   // Canceled/Cancelled → canceled
};

// مبلغ الاسترجاع = التكلفة × (المتبقي ÷ الكمية). الملغي بلا remains يُرجَع كاملاً؛ الجزئي بلا remains لا يُرجَع شيء.
function calcRefund(order, status, remains) {
  const cost = Number(order.cost) || 0;
  const qty = Number(order.quantity) || 0;
  if (!(cost > 0) || !(qty > 0)) return 0;
  let rem = remains;
  if (rem == null || Number.isNaN(rem)) {
    if (status === "canceled") rem = qty; else return 0;
  }
  rem = Math.min(Math.max(rem, 0), qty);
  return Math.round(((cost * rem) / qty) * 10000) / 10000;
}

const MIN_GAP_MS = Number(process.env.SYNC_GAP_MS ?? 10000);
const lastRun = new Map();                      // حماية بسيطة من كثرة الطلبات لكل مستخدم

async function handle(req, res) {
  if (req.method !== "POST" && req.method !== "GET")
    return res.status(405).json({ error: "method_not_allowed", detail: "Use POST" });

  let admin, db, auth, jap, pickRaw, translate;
  try {
    if (!process.env.FIREBASE_SERVICE_ACCOUNT) throw new Error("Missing env FIREBASE_SERVICE_ACCOUNT");
    if (!process.env.JAP_API_KEY) throw new Error("Missing env JAP_API_KEY");
    ({ admin, db, auth } = require("../lib/firebase"));
    ({ jap } = require("../lib/jap"));
    ({ pickRaw, translate } = require("../lib/reasons"));
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
    return res.status(401).json({ error: "unauthorized", detail: errText(e) });
  }

  const now = Date.now();
  if (now - (lastRun.get(uid) || 0) < MIN_GAP_MS) return res.status(200).json({ skipped: true, checked: 0, updated: 0 });
  lastRun.set(uid, now);

  // 2) الطلبات: النشطة + (ملغاة/جزئية لم تُعالَج بعد: لا يوجد حقل refunded)
  let docs;
  try {
    const snap = await db.collection("orders").where("uid", "==", uid).get();
    docs = snap.docs.filter((d) => {
      const x = d.data();
      if (!x.japOrder) return false;
      const st = norm(x.status);
      return ACTIVE.has(st) || (REFUNDABLE.has(st) && x.refunded === undefined);
    }).slice(0, 100);                            // JAP يقبل حتى 100 رقم في الطلب الواحد
  } catch (e) {
    console.error("orders query failed", e);
    return res.status(500).json({ error: "server_error", detail: "Firestore: " + errText(e) });
  }
  if (!docs.length) return res.status(200).json({ checked: 0, updated: 0, changes: [] });

  // 3) حالات حديثة من JAP:  action=status & orders=1,2,3
  const byJap = new Map(docs.map((d) => [String(d.data().japOrder), d]));
  let result;
  try {
    result = await jap({ action: "status", orders: [...byJap.keys()].join(",") });
  } catch (e) {
    console.error("jap status failed", e);
    return res.status(502).json({ error: "provider_error", detail: "JAP status: " + errText(e) });
  }
  if (!result || typeof result !== "object" || result.error) {
    return res.status(502).json({ error: "provider_error", detail: "JAP: " + String((result && result.error) || "bad response").slice(0, 300) });
  }

  // 4) الإلغاء/الجزئي: سبب + استرجاع في معاملة واحدة لكل طلب (آمنة من التكرار)
  async function finalize(doc, f) {
    return db.runTransaction(async (tx) => {
      const o = await tx.get(doc.ref);
      const x = o.data() || {};
      const userRef = db.collection("users").doc(x.uid);
      const u = await tx.get(userRef);              // كل القراءات قبل أي كتابة
      const t = translate(f.raw, f.status);
      const upd = {
        status: f.status,
        cancel_reason: t.ar, cancel_reason_en: t.en, cancel_reason_raw: t.raw,
        updatedAt: FV.serverTimestamp(),
      };
      if (f.remains !== null) upd.remains = f.remains;
      if (f.startCount !== null) upd.startCount = f.startCount;

      let refund = 0;
      if (x.refunded === undefined) {               // لم تُعالَج من قبل
        refund = REFUND_ON ? calcRefund(x, f.status, f.remains) : 0;
        if (refund > 0 && u.exists) {
          tx.update(userRef, { balance: FV.increment(refund), spent: FV.increment(-refund) });
          upd.refunded = true; upd.refundAmount = refund; upd.refundedAt = FV.serverTimestamp();
        } else {
          refund = 0; upd.refunded = false; upd.refundAmount = 0;
        }
      }
      tx.update(doc.ref, upd);
      return refund;
    });
  }

  const batch = db.batch();
  let batched = 0;
  const changes = [];
  const problems = [];
  for (const [japId, doc] of byJap) {
    const r = result[japId];
    if (!r || r.error) { problems.push({ id: doc.id, detail: r ? String(r.error) : "missing in response" }); continue; }
    const status = norm(r.status);
    if (!status) continue;
    const old = doc.data();
    const remains = r.remains != null && r.remains !== "" && !Number.isNaN(Number(r.remains)) ? Number(r.remains) : null;
    const startCount = r.start_count != null && r.start_count !== "" && !Number.isNaN(Number(r.start_count)) ? Number(r.start_count) : null;

    if (REFUNDABLE.has(status)) {
      try {
        const refund = await finalize(doc, { status, remains, startCount, raw: pickRaw(r) });
        changes.push({ id: doc.id, from: norm(old.status), to: status, refund });
      } catch (e) {
        console.error("finalize failed", doc.id, e);
        problems.push({ id: doc.id, detail: "finalize: " + errText(e) });
      }
      continue;
    }
    if (norm(old.status) === status && (old.remains ?? null) === remains) continue;   // لا تغيير
    const upd = { status, updatedAt: FV.serverTimestamp() };
    if (remains !== null) upd.remains = remains;
    if (startCount !== null) upd.startCount = startCount;
    batch.update(doc.ref, upd);
    batched++;
    changes.push({ id: doc.id, from: norm(old.status), to: status });
  }
  if (batched) {
    try { await batch.commit(); }
    catch (e) {
      console.error("batch commit failed", e);
      return res.status(500).json({ error: "server_error", detail: "Firestore write: " + errText(e) });
    }
  }
  return res.status(200).json({ checked: docs.length, updated: changes.length, changes, problems });
}

module.exports = async (req, res) => {
  try { return await handle(req, res); }
  catch (e) {
    console.error("unhandled", e);
    if (!res.headersSent) return res.status(500).json({ error: "server_error", detail: errText(e) });
  }
};
module.exports._calcRefund = calcRefund;   // للاختبار فقط
