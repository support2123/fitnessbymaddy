const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { json, parseBody } = require('../lib/utils');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return json(res, { ok: true });
  if (req.method !== 'POST') return json(res, { error: 'POST only' }, 405);

  const body = await parseBody(req);
  const { client_id, name, phone, preferred_date, preferred_time, reason } = body;

  if (!phone || !preferred_date || !preferred_time) {
    return json(res, { error: 'phone, preferred_date, preferred_time required' }, 400);
  }

  // Notify Maddy about the reschedule request
  await sendWhatsApp(process.env.MADDY_PHONE || '+917082478374', 'reschedule_request', {
    name: 'Maddy',
    templateParams: [
      name || phone,
      preferred_date,
      preferred_time,
      reason || 'No reason given',
    ],
  });

  // Send confirmation to client
  if (phone) {
    await sendWhatsApp(phone, 'reschedule_confirm', {
      name: name || 'there',
      templateParams: [name || 'there', preferred_date, preferred_time],
    });
  }

  return json(res, { ok: true });
};
