const { sendTemplate, sendText, canSendToLead } = require('./_lib/whatsapp');
const { jsonResponse, errorResponse } = require('./_lib/helpers');
const { getSupabase } = require('./_lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return errorResponse(res, 'POST only', 405);

  const { phone, text, template, params, force } = req.body || {};

  if (!phone) return errorResponse(res, 'phone is required');
  if (!text && !template) return errorResponse(res, 'text or template is required');

  const normalizedPhone = phone.replace(/[^0-9+]/g, '').replace(/^(\d)/, '+$1');

  // Check if lead has opted out
  const db = getSupabase();
  const { data: lead } = await db
    .from('leads')
    .select('opted_out, status')
    .eq('phone', normalizedPhone)
    .limit(1)
    .single();

  if (lead?.opted_out) {
    return errorResponse(res, 'Lead has opted out');
  }

  // Rate limiting for leads (not active clients)
  const { data: client } = await db
    .from('clients')
    .select('id, status')
    .eq('phone', normalizedPhone)
    .eq('status', 'active')
    .limit(1)
    .single();

  if (!client && !force) {
    const rateOk = await canSendToLead(normalizedPhone);
    if (!rateOk) {
      return errorResponse(res, 'Rate limited: max 1 message per 2 hours for leads', 429);
    }
  }

  let result;
  if (template) {
    result = await sendTemplate(normalizedPhone, template, params || []);
  } else {
    result = await sendText(normalizedPhone, text);
  }

  return jsonResponse(res, {
    ok: result.ok,
    data: result.data || null,
    error: result.error || null
  });
};
