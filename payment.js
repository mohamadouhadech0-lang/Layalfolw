document.addEventListener("DOMContentLoaded", function() {
    const payBtn = document.getElementById('payBtn');
    if (!payBtn) return;

    payBtn.addEventListener('click', function() {
        const amountInput = document.getElementById('fund').value;
        const payMsg = document.getElementById('payMsg');

        if (!amountInput || amountInput <= 0) {
            if (payMsg) payMsg.innerText = "الرجاء إدخال مبلغ صحيح";
            return;
        }

        if (payMsg) payMsg.innerText = "جاري فتح بوابة الدفع...";

        // التأكد من تحميل مكتبة YouCan Pay وإنشاء الجلسة
        if (typeof YouCanPay === 'undefined') {
            if (payMsg) payMsg.innerText = "مكتبة الدفع غير متوفرة، تحقق من الاتصال.";
            return;
        }

        // إعداد الاتصال ببوابة YouCan Pay التجريبية
        const youcanPay = YouCanPay.init({
            pub_key: "pub_sandbox_ee76a43c-4dda-43d5-b6ea-1db36",
            sandbox: true
        });

        youcanPay.tokenize({
            amount: Math.round(parseFloat(amountInput) * 100),
            currency: 'USD',
            order_id: 'ORDER_' + Date.now(),
        }).then(result => {
            if (result.token) {
                // الانتقال المباشر لصفحة الدفع الخاصة بـ YouCan Pay
                window.location.href = `https://api.youcanpay.com/sandbox/v1/payment-form/${result.token}`;
            } else {
                if (payMsg) payMsg.innerText = "فشل في إنشاء رمز الدفع.";
            }
        }).catch(error => {
            console.error("YouCan Pay SDK Error:", error);
            if (payMsg) payMsg.innerText = "حدث خطأ في الاتصال ببوابة الدفع.";
        });
    });
});
