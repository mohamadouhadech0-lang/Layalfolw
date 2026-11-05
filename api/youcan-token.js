// payment.js - كود واجهة الدفع المكتمل

async function initiateYouCanPayment(amountUsd = 5) {
  const payButton = document.querySelector('#pay-button'); // زر الدفع في واجهتك
  const errorElement = document.querySelector('#payment-error'); // مكان عرض الخطأ إن وجد

  try {
    // 1. التأكد من أن المستخدم مسجل الدخول في Firebase
    const user = firebase.auth().currentUser;
    if (!user) {
      alert("يرجى تسجيل الدخول إلى حسابك أولاً لتتمكن من الشحن.");
      return;
    }

    // تعطيل الزر أثناء المعالجة لمنع الضغط المزدوج
    if (payButton) payButton.disabled = true;
    if (errorElement) errorElement.textContent = "";

    // 2. الحصول على Firebase ID Token الخاص بالمستخدم
    const idToken = await user.getIdToken(true);

    // 3. إرسال طلب إنشاء التوكن إلى سيرفر Vercel الخاص بك
    const response = await fetch('/api/youcan-token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${idToken}` // الترويسة المطلوبة لتأكيد الهوية
      },
      body: JSON.stringify({
        amount: amountUsd
      })
    });

    const data = await response.json();

    // 4. التحقق من رد السيرفر
    if (!response.ok) {
      throw new Error(data.detail || data.error || 'فشل الاتصال بـ API الدفع');
    }

    // 5. بناء رابط التوجيه إلى YouCan Pay
    // إذا كان حسابك في وضع Sandbox سينقلك لبيئة التجريب، وإلا فالبيئة الحقيقية
    const payUrl = data.sandbox 
      ? `https://paylink.youcanpay.com/sandbox/${data.tokenId}`
      : `https://paylink.youcanpay.com/${data.tokenId}`;

    // 6. التحويل التلقائي لصفحة الدفع
    window.location.href = payUrl;

  } catch (error) {
    console.error("خطأ أثناء إعداد عملية الدفع:", error);
    if (errorElement) {
      errorElement.textContent = `حدث خطأ: ${error.message}`;
    } else {
      alert(`حدث خطأ: ${error.message}`);
    }
  } finally {
    if (payButton) payButton.disabled = false;
  }
}

// ربط الدالة بزر "متابعة الدفع الإلكتروني" عند النقر عليه
document.addEventListener('DOMContentLoaded', () => {
  const btn = document.querySelector('#pay-button'); // ضع ID الخاص بزر الدفع في صفحتك
  if (btn) {
    btn.addEventListener('click', () => {
      // يمكنك قراءة قيمة المبلغ المحددة من الواجهة (مثل 5 أو 10 أو 25)
      const selectedAmount = parseFloat(document.querySelector('#amount-input')?.value || 5);
      initiateYouCanPayment(selectedAmount);
    });
  }
});
