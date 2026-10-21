// POST /api/sync-orders
// Header: Authorization: Bearer <Firebase ID token>
// يجلب حالة طلبات المستخدم غير المنتهية من JAP ويحدّثها في Firestore.
// الواجهة تقرأ orders عبر onSnapshot، فيظهر التغيير فوراً بعد الكتابة.

const errText = (e) => String((e && (e.message || e.code)) || e).slice(0, 300);

// حالات الطلب التي ما زالت تحتاج متابعة من المزوّد
const ACTIVE = new Set(["pending", "processing", "inprogress"]);
const norm = (t) => {
  const k = String(t || "").toLowerCase().replace(/[^a-z]/g, "");
  return k === "cancelled" ? "canceled" : k;   // Canceled/Cancelled → canceled
};

const lastRun = new Map();                      // حماية بسيطة من كثرة الطلبات لكل مستخدم
const MIN_GAP_MS = 10 * 1000;

async function handle(req, res) {
  if (req.method !== "POST" && req.method !== "GET")
    return res.status(405).json({ error: "method_not_allowed", detail: "Use POST" });

  let admin, db, auth, jap;
  try {
    if (!process.env.FIREBASE_SERVICE_ACCOUNT) throw new Error("Missing env FIREBASE_SERVICE_ACCOUNT");
    if (!process.env.JAP_API_KEY) throw new Error("Missing env JAP_API_KEY");
    ({ admin, db, auth } = require("../lib/firebase"));
    ({ jap } = require("../lib/jap"));
  } catch (e) {
    console.error("init_failed", e);
    return res.status(500).json({ error: "init_failed", detail: errText(e) });
  }

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

  // 2) طلبات المستخدم التي لها رقم عند المزوّد وحالتها غير نهائية
  let docs;
  try {
    const snap = await db.collection("orders").where("uid", "==", uid).get();
    docs = snap.docs.filter((d) => {
      const x = d.data();
      return x.japOrder && ACTIVE.has(norm(x.status));
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

  // 4) تحديث Firestore عند تغيّر الحالة أو المتبقي
  const batch = db.batch();
  const changes = [];
  const problems = [];
  for (const [japId, doc] of byJap) {
    const r = result[japId];
    if (!r || r.error) { problems.push({ id: doc.id, detail: r ? String(r.error) : "missing in response" }); continue; }
    const status = norm(r.status);
    if (!status) continue;
    const old = doc.data();
    const remains = r.remains != null && r.remains !== "" ? Number(r.remains) : null;
    if (norm(old.status) === status && (old.remains ?? null) === remains) continue;
    const upd = { status, updatedAt: admin.firestore.FieldValue.serverTimestamp() };
    if (remains !== null && !Number.isNaN(remains)) upd.remains = remains;
    if (r.start_count != null && r.start_count !== "" && !Number.isNaN(Number(r.start_count))) upd.startCount = Number(r.start_count);
    batch.update(doc.ref, upd);
    changes.push({ id: doc.id, from: norm(old.status), to: status });
  }
  if (changes.length) {
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
