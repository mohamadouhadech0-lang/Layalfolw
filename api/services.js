// GET /api/services  — قائمة الخدمات بأسعار البيع (يتطلب تسجيل دخول)
const { auth } = require("../lib/firebase");
const { getServices } = require("../lib/jap");

module.exports = async (req, res) => {
  try {
    const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    if (!token) return res.status(401).json({ error: "unauthorized" });
    await auth.verifyIdToken(token);
    const { list } = await getServices();
    return res.status(200).json(list);
  } catch (e) {
    console.error(e);
    const code = /id-token|auth\//i.test(String(e.code || e.message)) ? 401 : 502;
    return res.status(code).json({ error: code === 401 ? "unauthorized" : "services_unavailable" });
  }
};
