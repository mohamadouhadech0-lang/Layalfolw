async function initiateYouCanPayment(amountUsd) {
  const payButton = document.querySelector('#pay-button');
  const errorElement = document.querySelector('#payment-error');

  try {
   // تجاوز التحقق المحلي المؤقت لتجنب خطأ تسجيل الدخول
    const user = firebase.auth().currentUser || { uid: "guest-user" }; 

    if (payButton) payButton.disabled = true;
    if (errorElement) errorElement.textContent = "";

    const finalAmount = amountUsd || parseFloat(document.querySelector('#amount-input')?.value || 5);
    const minor = Math.round(finalAmount * 10 * 100);
    const orderId = "YC" + Math.random().toString(36).substring(2, 8).toUpperCase();

    // المفتاح العام الخاص بك
    const publicKey = "Pub_sandbox_ee76a43c-4dda-43d5-b6ea-1db36";
    const privateKey = "Pri_sandbox_3d6c46c7-f00b-4169-9af2-e6a9b"; 
    const response = await fetch("https://youcanpay.com/sandbox/api/tokenize", {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json"
      },
    body: JSON.stringify({
            public_key : publicKey,
            pri_key: privateKey,
            order_id: orderId,
            amount: minor,
            currency: "MAD",
            metadata: { uid: user.uid }
        }) 
    });

    const data = await response.json();
    
    if (!response.ok || !data.token) {
      throw new Error(data.message || "فشل الاتصال ببوابة الدفع، تأكد من المفتاح العام");
    }

    const tokenId = typeof data.token === "string" ? data.token : data.token.id;
    
    // التوجيه المحلي الصحيح لصفحة الدفع
    window.location.href = `https://paylink.youcanpay.com/sandbox/${tokenId}`;
  } catch (error) {
    console.error("Payment Error:", error);
    if (errorElement) {
      errorElement.textContent = error.message;
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
