// Vercel Serverless Function: /api/create-checkout-session
// المتغير السري STRIPE_SECRET_KEY يُضاف في Vercel > Settings > Environment Variables (لا تضعه في الكود)
const FIREBASE_API_KEY = "AIzaSyD38HBchSLBCdSqjnZPL_8MnsOMSuYVQ4Y";   // مفتاح الويب العام لمشروعك
const BASE_URL = "https://layalfolw.vercel.app";

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });
  try {
    // 1) التحقق من المستخدم عبر رمز Firebase
    const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    if (!token) return res.status(401).json({ error: "unauthorized" });
    const lk = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${FIREBASE_API_KEY}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idToken: token })
    });
    const user = ((await lk.json()).users || [])[0];
    if (!user) return res.status(401).json({ error: "unauthorized" });

    // 2) التحقق من المبلغ (يُحسب في الخادم فقط)
    const amount = Number((req.body || {}).amount);
    if (!(amount >= 1 && amount <= 500)) return res.status(400).json({ error: "invalid_amount" });
    const cents = Math.round(amount * 100);

    // 3) إنشاء جلسة Stripe Checkout (البطاقات + Google Pay تظهر تلقائياً)
    const p = new URLSearchParams({
      mode: "payment",
      "payment_method_types[0]": "card",
      "line_items[0][quantity]": "1",
      "line_items[0][price_data][currency]": "usd",
      "line_items[0][price_data][unit_amount]": String(cents),
      "line_items[0][price_data][product_data][name]": "layal folw - Account balance",
      client_reference_id: user.localId,
      "metadata[uid]": user.localId,
      "metadata[amount_usd]": String(amount),
      success_url: `${BASE_URL}/dashboard.html?paid=success`,
      cancel_url: `${BASE_URL}/dashboard.html?paid=cancel`
    });
    if (user.email) p.set("customer_email", user.email);

    const s = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: { Authorization: "Bearer " + process.env.STRIPE_SECRET_KEY, "Content-Type": "application/x-www-form-urlencoded" },
      body: p
    });
    const session = await s.json();
    if (!s.ok) return res.status(502).json({ error: "stripe_error" });
    return res.status(200).json({ id: session.id, url: session.url });
  } catch (e) {
    return res.status(500).json({ error: "server_error" });
  }
};
