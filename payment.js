document.addEventListener("DOMContentLoaded", function() {
    const payBtn = document.getElementById('payBtn');
    if (!payBtn) return;

    payBtn.addEventListener('click', async function() {
        const amountInput = document.getElementById('fund').value;
        const payMsg = document.getElementById('payMsg');

        if (!amountInput || amountInput <= 0) {
            if (payMsg) payMsg.innerText = "الرجاء إدخال مبلغ صحيح";
            return;
        }

        if (payMsg) payMsg.innerText = "جاري إنشاء طلب الدفع...";

        try {
            const response = await fetch('/api/youcan-token', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ amount: parseFloat(amountInput) })
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.detail || data.error || "خطأ في إنشاء الطلب");
            }

            if (data.tokenId) {
                if (payMsg) payMsg.innerText = "جاري تحويلك لبوابة الدفع...";
                window.location.href = `https://youcanpay.com/sandbox/api/payment-form/${data.tokenId}`;
            } else {
                if (payMsg) payMsg.innerText = "فشل في الحصول على رمز الدفع.";
            }

        } catch (error) {
            console.error("Payment Error:", error);
            if (payMsg) payMsg.innerText = "حدث خطأ: " + (error.message || "تعذر الاتصال");
        }
    });
});
