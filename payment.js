async function initiateYouCanPayment(amountUsd) {
  const payButton = document.querySelector('#pay-button');
  const errorElement = document.querySelector('#payment-error'); // مكان ظهور الخطأ تحت الزر

  try {
    const user = firebase.auth().currentUser;
    if (!user) {
      alert("يرجى تسجيل الدخول أولاً");
      return;
    }

    if (payButton) payButton.disabled = true;
    if (errorElement) errorElement.textContent = "";

    const idToken = await user.getIdToken(true);
    const finalAmount = amountUsd || parseFloat(document.querySelector('#amount-input')?.value || 5);

    const response = await fetch('/api/youcan-token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${idToken}`
      },
      body: JSON.stringify({ amount: finalAmount })
    });

    const textRes = await response.text();
    let data;
    try {
      data = JSON.parse(textRes);
    } catch (e) {
      throw new Error(textRes || "خطأ غير متوقع من الخادم");
    }

    if (!response.ok) {
      // هنا يظهر الخطأ الحقيقي والدقيق قادماً من السيرفر مباشرة
      throw new Error(data.detail || data.error || "حدث خطأ في الاتصال ببوابة الدفع.");
    }

    const payUrl = `https://paylink.youcanpay.com/sandbox/${data.tokenId}`;
    window.location.href = payUrl;

  } catch (error) {
    console.error("Payment Error:", error);
    if (errorElement) {
      errorElement.textContent = error.message; // عرض السبب الحقيقي تحت الزر مباشرة
    } else {
      alert(error.message);
    }
  } finally {
    if (payButton) payButton.disabled = false;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const payBtn = document.querySelector('#pay-button');
  if (payBtn) {
    payBtn.addEventListener('click', (e) => {
      e.preventDefault();
      initiateYouCanPayment();
    });
  }
});
