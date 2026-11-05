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

        if (payMsg) payMsg.innerText = "جاري تحويلك إلى بوابة الدفع...";

        // رابط دفع تجريبي مباشر وآمن لضمان عدم حدوث أي خطأ في الاتصال
        setTimeout(function() {
            // يمكنك توجيه العميل مباشرة لرابط الدفع التجريبي أو صفحة الدفع الخاصة بك
            window.location.href = "https://checkout.youcanpay.com/"; 
        }, 1000);
    });
});
