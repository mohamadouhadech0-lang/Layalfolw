const crypto = require("crypto");

module.exports = async (req, res) => {
  // السماح فقط بطلبات POST
  if (req.method !== "POST") {
    return res.status(405).json({ error: "method_not_allowed", detail: "Use POST method" });
  }

  try {
    // 1. استدعاء مكتبة Firebase المتصلة بمشروعك
    const { admin, db, auth } = require("../lib/firebase");
    
    // 2. التحقق من هوية المستخدم عبر Firebase Token
    const authHeader = req.headers.authorization || "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) {
      return res.status(401).json({ error: "unauthorized", detail: "Missing Authorization header" });
    }
    
    const decodedToken = await auth.verifyIdToken(token);
    const uid = decodedToken.uid;

    // 3. التحقق من وجود مفاتيح YouCan Pay في متغيرات البيئة بـ Vercel
    const privateKey = process.env.YOUCAN_PRIVATE_KEY;
    const publicKey = process.env.YOUCAN_PUBLIC_KEY;
    if (!privateKey || !publicKey) {
      return res.status(500).json({ 
        error: "config_error", 
        detail: "المفاتيح السرية غير موجودة في متغيرات البيئة على Vercel" 
      });
    }

    // 4. تحديد المبلغ (مثلاً 5 دولار)
    const usd = Number((req.body || {}).amount) || 5;
    const minor = Math.round(usd * 10 * 100); // تحويل المبلغ للوحدة الصغرى
    const orderId = "YC" + crypto.randomBytes(6).toString("hex").toUpperCase();

    // 5. إرسال الطلب إلى بوابة YouCan Pay Sandbox API
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

    // 6. إذا رفضت البوابة الطلب، نرسل الخطأ الحقيقي للمستخدم على الشاشة
    if (!response.ok || !data.token) {
      const errorMsg = data.message || data.error || data.raw_response || "رفضت بوابة YouCan Pay المعاملة";
      return res.status(502).json({ 
        error: "youcan_rejected", 
        detail: "خطأ من YouCan Pay: " + errorMsg 
      });
    }

    // استخراج الرمز (Token ID) بنجاح
    const tokenId = typeof data.token === "string" ? data.token : data.token.id;

    return res.status(200).json({
      tokenId: tokenId,
      sandbox: true
    });

  } catch (err) {
    // إظهار أي خطأ مفاجئ في السيرفر
    return res.status(500).json({ 
      error: "server_crash", 
      detail: "خطأ في السيرفر: " + err.message 
    });
  }
};
