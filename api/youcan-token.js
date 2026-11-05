const crypto = require("crypto");
const admin = require("firebase-admin");

// تهيئة Firebase Admin مرة واحدة تفادياً لتكرار الاتصال
if (!admin.apps.length) {
  try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
  } catch (e) {
    console.error("Firebase init error:", e.message);
  }
}

const db = admin.firestore();
const auth = admin.auth();

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "method_not_allowed" });
  }

  try {
    // 1. التحقق من التوكن القادم من المتصفح
    const authHeader = req.headers.authorization || "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) {
      return res.status(401).json({ error: "unauthorized", detail: "Missing Authorization header" });
    }

    const decodedToken = await auth.verifyIdToken(token);
    const uid = decodedToken.uid;

    // 2. التحقق من مفاتيح YouCan Pay
    const privateKey = process.env.YOUCAN_PRIVATE_KEY;
    const publicKey = process.env.YOUCAN_PUBLIC_KEY;
    if (!privateKey || !publicKey) {
      return res.status(500).json({ error: "config_error", detail: "Missing YouCan keys in environment variables" });
    }

    const usd = Number((req.body || {}).amount) || 5;
    const minor = Math.round(usd * 10 * 100);
    const orderId = "YC" + crypto.randomBytes(6).toString("hex").toUpperCase();

    // 3. الاتصال المباشر بـ YouCan Pay Sandbox API
    const response = await fetch("https://youcanpay.com/sandbox/api/tokenize", {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        pri_key: privateKey.trim(),
        pub_key: publicKey.trim(),
        order_id: orderId,
        amount: minor,
        currency: "MAD",
        "metadata[type]": "topup",
        "metadata[uid]": uid
      })
    });

    const responseText = await response.text();
    let data;
    try {
      data = JSON.parse(responseText);
    } catch (e) {
      data = { raw_response: responseText };
    }

    if (!response.ok || !data.token) {
      const errorMsg = data.message || data.error || data.raw_response || "YouCan Pay rejected the request";
      return res.status(502).json({ error: "youcan_rejected", detail: errorMsg });
    }

    const tokenId = typeof data.token === "string" ? data.token : data.token.id;

    return res.status(200).json({
      tokenId: tokenId,
      sandbox: true
    });

  }ج catch (err) {
    return res.status(500).json({ error: "server_crash", detail: err.message });
  }
};
