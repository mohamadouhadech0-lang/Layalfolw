// تحويل أسباب الإلغاء/الرفض القادمة من المزوّد إلى رسائل مفهومة للمستخدم (عربي + إنجليزي).
// ملاحظة: حالة الطلب في JAP لا تتضمن سبباً رسمياً؛ نقرأ أي حقل نصي يرسله المزوّد إن وُجد،
// وإلا نعرض رسالة عامة صادقة بدل اختلاق سبب.

const KEYS = ["cancel_reason", "reason", "error", "message", "note", "comment", "details", "description"];

const RULES = [
  [/invalid.{0,12}link|incorrect.{0,12}link|wrong.{0,12}link|bad.{0,12}link|link.{0,20}(not valid|invalid|incorrect)|url.{0,20}(invalid|incorrect)/i,
    "الرابط غير صحيح أو غير متاح للعامة.", "The link is invalid or not publicly available."],
  [/private.{0,12}(account|profile|page|channel)|(account|profile|page|channel).{0,15}private/i,
    "الحساب خاص، يرجى تحويله إلى عام وإعادة الطلب.", "The account is private. Please make it public and place the order again."],
  [/duplicate|already.{0,25}(order|exist|running|progress)|active order|same link/i,
    "يوجد طلب سابق قيد التنفيذ لنفس الرابط.", "There is already an active order for the same link."],
  [/(post|video|photo|profile|account|page|channel|link|content).{0,25}(not found|deleted|removed|unavailable|doesn.?t exist|does not exist)|not found/i,
    "المنشور أو الحساب غير موجود أو تم حذفه.", "The post or account was not found or has been deleted."],
  [/min(imum)?\b|max(imum)?\b|quantity.{0,20}(invalid|incorrect|too)/i,
    "الكمية خارج الحد المسموح للخدمة.", "The quantity is outside the allowed range for this service."],
  [/service.{0,25}(disabled|unavailable|not active|inactive|paused)|disabled/i,
    "الخدمة غير متاحة حالياً.", "This service is currently unavailable."],
  [/limit|too many|rate/i,
    "تم الوصول إلى الحد الأقصى للطلبات على هذا الرابط.", "The maximum number of orders for this link has been reached."],
  // أخطاء داخلية عند المزوّد (رصيد/مفتاح): لا نعرض تفاصيلها للعميل
  [/not.?enough.?funds|insufficient|low balance|api key|apikey|invalid key|incorrect key|unauthori[sz]ed/i,
    "تعذّر تنفيذ الطلب لدى المزوّد مؤقتاً. يرجى المحاولة لاحقاً.", "The provider could not process the order right now. Please try again later."],
];

const DEFAULTS = {
  canceled: ["ألغى المزوّد الطلب دون ذكر سبب محدد.", "The provider canceled this order without giving a specific reason."],
  partial: ["لم يتمكن المزوّد من تنفيذ الكمية كاملة.", "The provider could not deliver the full quantity."],
  failed: ["رفض المزوّد الطلب.", "The provider rejected this order."],
};

// أول حقل نصي مفيد في رد المزوّد
function pickRaw(r) {
  if (!r || typeof r !== "object") return "";
  for (const k of KEYS) {
    const v = r[k];
    if (typeof v === "string" && v.trim()) return v.trim().slice(0, 300);
  }
  return "";
}

// raw = النص الأصلي من المزوّد (قد يكون فارغاً) ، status = canceled | partial | failed
function translate(raw, status) {
  const text = String(raw || "").trim();
  if (!text) {
    const d = DEFAULTS[status] || DEFAULTS.canceled;
    return { ar: d[0], en: d[1], raw: "" };
  }
  for (const [re, ar, en] of RULES) if (re.test(text)) return { ar, en, raw: text };
  return { ar: text, en: text, raw: text };   // سبب غير معروف: يُعرض كما هو من المزوّد
}

module.exports = { pickRaw, translate };
