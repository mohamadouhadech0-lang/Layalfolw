import { db, auth } from "./firebaseConfig.js";
import { doc, getDoc, updateDoc, collection, addDoc, serverTimestamp } from 'firebase/firestore';

const API_URL = "https://corsproxy.io/?" + encodeURIComponent("https://justanotherpanel.com/api/v2");
const API_KEY = "feaa69096d501c6ccfc39634a59e2cc8";

export async function getJapServices() {
  try {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ key: API_KEY, action: "services" })
    });

    const status = response.status;
    const text = await response.text();

    // ستظهر لك رسالة على هاتفك توضح حالة الاتصال والنص القادم
    alert("رمز الاستجابة: " + status + "\nالنص: " + text.substring(0, 100));

    if (!response.ok) {
      return [];
    }

    return JSON.parse(text);
  } catch (error) {
    alert("حدث خطأ في شبكة الاتصال: " + error.message);
    return [];
  }
}

export async function processUserOrder(serviceId, serviceRatePer1K, link, quantity) {
  try {
    const user = auth.currentUser;
    if (!user) return { success: false, error: "يرجى تسجيل الدخول أولاً" };

    const totalCost = (parseFloat(serviceRatePer1K) * parseInt(quantity)) / 1000;
    const userRef = doc(db, "users", user.uid);
    const userSnap = await getDoc(userRef);

    if (!userSnap.exists()) {
      return { success: false, error: "حساب المستخدم غير موجود" };
    }

    const currentBalance = userSnap.data().balance || 0;

    if (currentBalance < totalCost) {
      return { success: false, error: "رصيدك غير كاف لتنفيذ هذا الطلب" };
    }

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

    if (data.order) {
      const newBalance = currentBalance - totalCost;
      await updateDoc(userRef, { balance: newBalance });

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
    return { success: false, error: "حدث خطأ غير معتاد: " + error.message };
  }
}
