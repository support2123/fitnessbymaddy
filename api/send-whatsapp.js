const { insert } = require("./lib/supabase");
const { sendTemplate, sendText, maskPhone } = require("./lib/whatsapp");
const { jsonResponse, errorResponse } = require("./lib/utils");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return errorResponse(res, "Method not allowed", 405);
  }

  // ---------- Auth check ----------
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7)
    : authHeader;

  if (!process.env.INTERNAL_API_KEY || token !== process.env.INTERNAL_API_KEY) {
    console.error("[send-whatsapp] Unauthorized request");
    return errorResponse(res, "Unauthorized", 401);
  }

  let phone;

  try {
    const body = req.body || {};
    phone = body.phone;
    const templateName = body.templateName || body.template_name;
    const params = body.params || [];
    const message = body.message;

    if (!phone) {
      return errorResponse(res, "Missing phone number", 400);
    }

    // Normalize phone
    if (!phone.startsWith("+")) {
      phone = `+${phone}`;
    }

    if (!templateName && !message) {
      return errorResponse(res, "Must provide either templateName or message", 400);
    }

    let result;

    if (templateName) {
      // ---------- Send template ----------
      result = await sendTemplate(phone, templateName, params);

      // Log outbound template
      try {
        await insert("messages", {
          phone,
          direction: "out",
          template_name: templateName,
          body: null,
          created_at: new Date().toISOString(),
        });
      } catch (logErr) {
        console.error(`[send-whatsapp] Message log failed for ${maskPhone(phone)}: ${logErr.message}`);
      }

      console.log(`[send-whatsapp] Template '${templateName}' sent to ${maskPhone(phone)}`);

    } else {
      // ---------- Send text ----------
      result = await sendText(phone, message);

      // Log outbound text
      try {
        await insert("messages", {
          phone,
          direction: "out",
          template_name: null,
          body: message.slice(0, 1000),
          created_at: new Date().toISOString(),
        });
      } catch (logErr) {
        console.error(`[send-whatsapp] Message log failed for ${maskPhone(phone)}: ${logErr.message}`);
      }

      console.log(`[send-whatsapp] Text message sent to ${maskPhone(phone)}`);
    }

    return jsonResponse(res, {
      status: "sent",
      phone: maskPhone(phone),
      type: templateName ? "template" : "text",
      result,
    });

  } catch (err) {
    const safePhone = phone ? maskPhone(phone) : "unknown";

    // Handle rate limiting specifically
    if (err.message && err.message.includes("Rate limited")) {
      console.warn(`[send-whatsapp] ${err.message}`);
      return errorResponse(res, err.message, 429);
    }

    console.error(`[send-whatsapp] Error for ${safePhone}: ${err.message}`);
    return errorResponse(res, "Internal server error", 500);
  }
}
