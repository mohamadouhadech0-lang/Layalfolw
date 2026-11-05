// ==========================================
// ملف واحد متكامل لمعالجة الدفع عبر YouCan Pay
// ==========================================

async function initiateYouCanPayment(amountUsd) {
  const payButton = document.querySelector('#pay-button');
  const errorElement = document.querySelector('#payment-error');

  try {
    // 1. التحقق من تسجيل دخول المستخدم عبر Firebase
    const user = firebase.auth().currentUser;
    if (!user) {
      alert("يرجى تسجيل الدخول إلى حسابك أولاً لتتمكن من الشحن.");
      return;
    }

    // تعطيل الزر مؤقتاً لمنع الضغط المتكرر
    if (payButton) payButton.disabled = true;
    if (errorElement) errorElement.textContent = "";

    // 2. جلب Firebase ID Token الخاص بالمستخدم
    const idToken = await user.getIdToken(true);

    // تحديد المبلغ (إما المُمرر أو المقروء من الحقل)
    const finalAmount = amountUsd || parseFloat(document.querySelector('#amount-input')?.value || 5);

    // 3. إرسال الطلب إلى السيرفر الخاص بك على Vercel
    const response = await fetch('/api/youcan-token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${idToken}`
      },
      body: JSON.stringify({ amount: finalAmount })
    });

    // قراءة الاستجابة كنص أولاً لتفادي أخطاء تنسيق JSON
    const textResponse = await response.text();
    let data;

    try {
      data = JSON.parse(textResponse);
    } catch (e) {
      throw new Error(textResponse || `خطأ في استجابة الخادم (${response.status})`);
    }

    // التحقق من نجاح الرد
    if (!response.ok) {
      throw new Error(data.detail || data.error || data.message || 'فشل الاتصال بـ API الدفع');
    }

    // 4. التوجيه التلقائي إلى بوابة YouCan Pay (سواء Sandbox أو Production)
    const payUrl = data.sandbox 
      ? `https://paylink.youcanpay.com/sandbox/${data.tokenId}`
      : `https://paylink.youcanpay.com/${data.tokenId}`;

    window.location.href = payUrl;

  } catch (error) {
    console.error("خطأ أثناء عملية الدفع:", error);
    if (errorElement) {
      errorElement.textContent = `حدث خطأ: ${error.message}`;
    } else {
      alert(`حدث خطأ: ${error.message}`);
    }
  } finally {
    if (payButton) payButton.disabled = false;
  }
}

// 5. ربط الحدث بزر الدفع تلقائياً بمجرد تحميل الصفحة
document.addEventListener('DOMContentLoaded', () => {
  const payBtn = document.querySelector('#pay-button');
  if (payBtn) {
    payBtn.addEventListener('click', (e) => {
      e.preventDefault();
      initiateYouCanPayment();
    });
  }
});
