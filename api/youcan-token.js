// payment.js - كود واجهة الدفع المعدل والمحمي من أخطاء السيرفر

async function initiateYouCanPayment(amountUsd = 5) {
  const payButton = document.querySelector('#pay-button');
  const errorElement = document.querySelector('#payment-error');

  try {
    const user = firebase.auth().currentUser;
    if (!user) {
      alert("يرجى تسجيل الدخول إلى حسابك أولاً لتتمكن من الشحن.");
      return;
    }

    if (payButton) payButton.disabled = true;
    if (errorElement) errorElement.textContent = "";

    const idToken = await user.getIdToken(true);

    // إرسال الطلب إلى الخادم
    const response = await fetch('/api/youcan-token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${idToken}`
      },
      body: JSON.stringify({ amount: amountUsd })
    });

    // قراءة الرد كنص أولاً لمنع خطأ "is not valid JSON"
    const textResponse = await response.text();
    let data;

    try {
      data = JSON.parse(textResponse);
    } catch (e) {
      // في حال أرجع السيرفر خطأ HTML أو النص الخام من Vercel
      throw new Error(textResponse || `خطأ سيرفر (${response.status})`);
    }

    if (!response.ok) {
      throw new Error(data.detail || data.error || data.message || 'فشل الاتصال بـ API الدفع');
    }

    // التوجيه إلى YouCan Pay عند التمكن من التوكن
    const payUrl = data.sandbox 
      ? `https://paylink.youcanpay.com/sandbox/${data.tokenId}`
      : `https://paylink.youcanpay.com/${data.tokenId}`;

    window.location.href = payUrl;

  } catch (error) {
    console.error("خطأ الدفع:", error);
    if (errorElement) {
      errorElement.textContent = `حدث خطأ: ${error.message}`;
    } else {
      alert(`حدث خطأ: ${error.message}`);
    }
  } finally {
    if (payButton) payButton.disabled = false;
  }
}
