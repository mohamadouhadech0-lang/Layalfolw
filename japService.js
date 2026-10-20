import { db, auth } from './firebaseConfig.js'; // تأكد من مسار ملف Firebase الخاص بك
import { doc, getDoc, updateDoc, collection, addDoc, serverTimestamp } from 'firebase/firestore';
const API_URL = "https://corsproxy.io/?" + encodeURIComponent("https://justanotherpanel.com/api/v2");


// ضع مفتاح الـ API الخاص بك هنا من حسابك في JAP
const API_KEY = "feaa69096d501c6ccfc39634a59e2cc8"; 

/**
 * 1. جلب جميع الخدمات المتاحة
 */
export async function getJapServices() {
  try {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ key: API_KEY, action: "services" })
    });
    return await response.json();
  } catch (error) {
    console.error("خطأ في جلب الخدمات:", error);
    return [];
  }
}

/**
 * 2. إرسال الطلب للمزود وخصم الرصيد من Firebase
 */
export async function processUserOrder(serviceId, serviceRatePer1K, link, quantity) {
  try {
    const user = auth.currentUser;
    if (!user) return { success: false, error: "يرجى تسجيل الدخول أولاً" };

    // حساب التكلفة الإجمالية للطلب (السعر لكل 1000 * الكمية / 1000)
    const totalCost = (parseFloat(serviceRatePer1K) * parseInt(quantity)) / 1000;

    // جلب رصيد المستخدم الحالي من Firestore
    const userRef = doc(db, "users", user.uid);
    const userSnap = await getDoc(userRef);

    if (!userSnap.exists()) {
      return { success: false, error: "حساب المستخدم غير موجود" };
    }

    const currentBalance = userSnap.data().balance || 0;

    // التحقق من كفاية الرصيد
    if (currentBalance < totalCost) {
      return { success: false, error: "رصيدك غير كافٍ لتنفيذ هذا الطلب" };
    }

    // إرسال الطلب إلى المزود (JAP)
    const response = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        key: API_KEY,
        action: "add",
        service: serviceId,
        link: link,
        quantity: quantity
      })
    });

    const data = await response.json();

    // إذا تم قبول الطلب لدى المزود
    if (data.order) {
      // 1. خصم التكلفة من رصيد المستخدم
      const newBalance = currentBalance - totalCost;
      await updateDoc(userRef, { balance: newBalance });

      // 2. حرق وتسجيل الطلب في Firestore
      await addDoc(collection(db, "orders"), {
        userId: user.uid,
        providerOrderId: data.order,
        serviceId: serviceId,
        link: link,
        quantity: quantity,
        cost: totalCost,
        status: "In progress",
        createdAt: serverTimestamp()
      });

      return { success: true, orderId: data.order, newBalance: newBalance };
    } else {
      return { success: false, error: data.error || "فشل تنفيذ الطلب لدى المزود" };
    }

  } catch (error) {
    console.error("خطأ أثناء معالجة الطلب:", error);
    return { success: false, error: "حدث خطأ غير متوقع" };
  }
}

/**
 * 3. فحص حالة طلب معين
 */
export async function checkOrderStatus(orderId) {
  try {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ key: API_KEY, action: "status", order: orderId })
    });
    return await response.json();
  } catch (error) {
    console.error("خطأ في فحص حالة الطلب:", error);
    return null;
  }
}

