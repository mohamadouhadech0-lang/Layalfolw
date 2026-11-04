document.getElementById('payBtn').addEventListener('click', async function() {
    const amountInput = document.getElementById('fund').value;
    const payMsg = document.getElementById('payMsg');

    if (!amountInput || amountInput <= 0) {
        if (payMsg) payMsg.innerText = "الرجاء إدخال مبلغ صحيح";
        return;
    }

    // المفاتيح الخاصة ببوابة YouCan Pay
    const publicKey = "pub_sandbox_ee76a43c-4dda-43d5-b6ea-1db36";
    const privateKey = "pri_sandbox_3d6c46c7-f00b-4169-9af2-e6a9b";

    try {
        if (payMsg) payMsg.innerText = "جاري الاتصال ببوابة الدفع...";

        const response = await fetch('https://api.youcanpay.com/sandbox/v1/tokenize', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify({
                pri_key: privateKey,
                pub_key: publicKey,
                amount: Math.round(parseFloat(amountInput) * 100), // تحويل المبلغ للسنتيم
                currency: 'USD',
                order_id: 'ORDER_' + Date.now(),
                customer: {
                    name: "Customer",
                    email: "customer@example.com"
                }
            })
        });

        const data = await response.json();

        if (data.token) {
            // التوجيه إلى صفحة أداء YouCan Pay عبر الـ Token المولد
            window.location.href = `https://api.youcanpay.com/sandbox/v1/payment-form/${data.token}`;
        } else if (data.payment_link) {
            window.location.href = data.payment_link;
        } else {
            console.error("YouCan Pay Error Response:", data);
            if (payMsg) payMsg.innerText = "حدث خطأ أثناء إنشاء رابط الدفع.";
        }
    } catch (error) {
        console.error("Payment Request Failed:", error);
        if (payMsg) payMsg.innerText = "حدث خطأ في الاتصال ببوابة الدفع.";
    }
});
