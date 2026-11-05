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

        const publicKey = "pub_sandbox_ee76a43c-4dda-43d5-b6ea-1db36";

        if (payMsg) payMsg.innerText = "جاري الاتصال ببوابة الدفع...";

        try {
            // إرسال الطلب المباشر للـ tokenize باستخدام المفتاح العام والعملة المناسبة
            const response = await fetch('https://youcanpay.com/sandbox/api/tokenize', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify({
                    pub_key: publicKey,
                    amount: Math.round(parseFloat(amountInput) * 100),
                    currency: 'MAD',
                    order_id: 'ORDER_' + Date.now()
                })
            });

            const textResponse = await response.text();
            let data;
            try {
                data = JSON.parse(textResponse);
            } catch (err) {
                throw new Error("استجابة غير صالحة من البوابة");
            }

            const tokenId = typeof data.token === "string" ? data.token : (data.token && data.token.id);

            if (tokenId) {
                if (payMsg) payMsg.innerText = "جاري تحويلك لبوابة الدفع...";
                window.location.href = `https://youcanpay.com/sandbox/api/payment-form/${tokenId}`;
            } else {
                const errorMsg = data.message || data.error || "فشل في إنشاء رمز الدفع";
                if (payMsg) payMsg.innerText = "خطأ: " + errorMsg;
            }

        } catch (error) {
            console.error("Payment Error:", error);
            if (payMsg) payMsg.innerText = "حدث خطأ في الاتصال ببوابة الدفع.";
        }
    });
});
