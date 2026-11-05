const crypto = require("crypto");
const admin = require("firebase-admin");

if (!admin.apps.length) {
  try {
    admin.initializeApp({
      credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT))
    });
  } catch (e) {
    console.error("Firebase init error:", e);
  }
}

const db = admin.firestore();
const auth = admin.auth();

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "method_not_allowed" });
  }

  try {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) {
      return res.status(401).json({ error: "unauthorized", detail: "Missing token" });
    }

    const decodedToken = await auth.verifyIdToken(token);
    const uid = decodedToken.uid;

    const privateKey = process.env.YOUCAN_PRIVATE_KEY;
    const publicKey = process.env.YOUCAN_PUBLIC_KEY;
    if (!privateKey || !publicKey) {
      return res.status(500).json({ error: "config_error", detail: "Missing YouCan Keys" });
    }

    const usd = Number((req.body || {}).amount) || 5;
    const minor = Math.round(usd * 10 * 100);
    const orderId = "YC" + crypto.randomBytes(6).toString("hex").toUpperCase();

    // الاتصال ببوابة YouCan Pay Sandbox
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

    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      data = { message: text };
    }

    if (!response.ok || !data.token) {
      const errorDetail = data.message || data.error || JSON.stringify(data);
      return res.status(502).json({ error: "youcan_error", detail: errorDetail });
    }

    const tokenId = typeof data.token === "string" ? data.token : data.token.id;

    return res.status(200).json({
      tokenId: tokenId,
      sandbox: true
    });

  } catch (err) {
    return res.status(500).json({ error: "server_error", detail: err.message });
  }
};
