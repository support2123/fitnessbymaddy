const { sendTemplate, sendText, canSendToLead } = require('./_lib/whatsapp');
const { normalizePhone, maskPhone, jsonResponse } = require('./_lib/helpers');

module.exports = async function handler(req, res) {
  /* ── CORS preflight ── */
  if (req.method === 'OPTIONS') {
    return jsonResponse(res, 200, { ok: true });
  }

  /* ── Only POST allowed ── */
  if (req.method !== 'POST') {
    return jsonResponse(res, 405, { error: 'Method not allowed' });
  }

  let phone;

  try {
    const { phone: rawPhone, message, template, params, force } = req.body || {};

    /* ── 1. Normalize phone ── */
    phone = normalizePhone(rawPhone || '');

    /* ── 2. Rate limit check (unless forced) ── */
    if (force !== true) {
      const allowed = await canSendToLead(phone);
      if (!allowed) {
        return jsonResponse(res, 429, { error: 'Rate limited' });
      }
    }

    /* ── 3. Send via template or text ── */
    if (template) {
      await sendTemplate(phone, template, params || []);
    } else {
      await sendText(phone, message);
    }

    return jsonResponse(res, 200, { ok: true });
  } catch (err) {
    console.error(`[send-whatsapp] Error for ${maskPhone(phone || '')}: ${err.message}`);
    return jsonResponse(res, 500, { error: 'Internal server error' });
  }
};
