/**
 * payment.js — ملف واحد يجمع: السيرفر الوسيط + صفحة الدفع
 * التشغيل:
 *   npm i express
 *   node payment.js
 * ثم افتح: http://localhost:3000
 * يتطلب Node.js 18 أو أحدث (fetch و FormData مدمجان).
 */

const express = require("express");

// ===== الإعدادات (يفضّل وضعها في متغيرات البيئة) =====
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.APP_BASE_URL || `http://localhost:${PORT}`;
const PRIVATE_KEY =
  process.env.YCP_PRIVATE_KEY || "pri_sandbox_3d6c46c7-f00b-4169-9af2-e6a9b";
const PUBLIC_KEY =
  process.env.YCP_PUBLIC_KEY || "pub_sandbox_ee76a43c-4dda-43d5-b6ea-1db36";
const TOKENIZE_URL = "https://youcanpay.com/sandbox/api/tokenize";

const app = express();
app.use(express.json());

// ===== 1) نقطة الوسيط: تولّد التوكن من السيرفر =====
app.post("/api/payment/create-token", async (req, res) => {
  try {
    const { orderId } = req.body || {};
    if (!orderId) return res.status(400).json({ error: "orderId is required" });

    // مهم: احسب المبلغ من قاعدة بياناتك وليس من المتصفح
    const amount = 2500; // 25.00 MAD بأصغر وحدة

    const form = new FormData();
    form.append("pri_key", PRIVATE_KEY);
    form.append("order_id", String(orderId));
    form.append("amount", String(amount));
    form.append("currency", "MAD");
    form.append("success_url", `${BASE_URL}/payment/success`);
    form.append("error_url", `${BASE_URL}/payment/error`);

    const response = await fetch(TOKENIZE_URL, {
      method: "POST",
      headers: { Accept: "application/json" },
      body: form,
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      console.error("YouCan Pay error:", response.status, data);
      return res.status(502).json({ error: "Payment provider error" });
    }

    // التوثيق يعرض شكلين للرد: token كنص أو token.id
    const tokenId = typeof data.token === "string" ? data.token : data.token?.id;
    if (!tokenId) {
      console.error("Unexpected response:", data);
      return res.status(502).json({ error: "Invalid response from provider" });
    }

    res.json({ tokenId, publicKey: PUBLIC_KEY });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ===== 2) صفحات النتيجة =====
app.get("/payment/success", (req, res) =>
  res.send("<h2 style='font-family:sans-serif'>✅ تمت عملية الدفع بنجاح</h2>")
);
app.get("/payment/error", (req, res) =>
  res.send("<h2 style='font-family:sans-serif'>❌ فشلت عملية الدفع</h2>")
);

// ===== 3) صفحة الدفع (HTML + كود الواجهة داخل نفس الملف) =====
const PAGE = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>الدفع — YouCan Pay Sandbox</title>
  <style>
    body{font-family:sans-serif;max-width:420px;margin:40px auto;padding:0 16px}
    #payment-error{color:#c00;margin:10px 0;min-height:20px}
    button{width:100%;padding:12px;font-size:16px;cursor:pointer}
    button:disabled{opacity:.6;cursor:not-allowed}
  </style>
</head>
<body>
  <h2>إتمام الدفع</h2>
  <div id="payment-container"></div>
  <div id="payment-error"></div>
  <button id="pay-btn" disabled>ادفع الآن</button>

  <script src="https://youcanpay.com/js/ycpay.js"></script>
  <script>
    async function startPayment(orderId) {
      var payBtn = document.getElementById("pay-btn");
      var errorBox = document.getElementById("payment-error");
      try {
        var res = await fetch("/api/payment/create-token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderId: orderId })
        });
        if (!res.ok) throw new Error("تعذر بدء عملية الدفع");
        var data = await res.json();

        var ycPay = new YCPay(data.publicKey, {
          formContainer: "#payment-container",
          locale: "ar",
          isSandbox: true,
          errorContainer: "#payment-error"
        });
        ycPay.renderCreditCardForm();

        payBtn.disabled = false;
        payBtn.onclick = async function () {
          payBtn.disabled = true;
          try {
            await ycPay.pay(data.tokenId);
          } catch (e) {
            errorBox.textContent = (e && e.message) || "فشلت عملية الدفع";
            payBtn.disabled = false;
          }
        };
      } catch (e) {
        errorBox.textContent = e.message;
      }
    }
    startPayment("ORDER-" + Date.now());
  </script>
</body>
</html>`;

app.get("/", (req, res) => res.send(PAGE));

app.listen(PORT, () => console.log("Server running on " + BASE_URL));
