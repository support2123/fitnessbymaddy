const { notifyMaddy } = require('./_lib/whatsapp');
const { handleCors, cleanPhone, maskPhone } = require('./_lib/utils');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { name, phone, preferred_date, preferred_time, reason, client_id } = req.body;

    if (!name || !phone || !preferred_date) {
      return res.status(400).json({ error: 'name, phone, and preferred_date required' });
    }

    await notifyMaddy(
      'Reschedule Request',
      `Client: ${name}\n` +
      `Phone: ${maskPhone(cleanPhone(phone))}\n` +
      `Date: ${preferred_date}\n` +
      `Time: ${preferred_time || 'Flexible'}\n` +
      `Reason: ${reason || 'Not specified'}\n` +
      `Client ID: ${client_id || 'N/A'}`
    );

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[Reschedule] Error:', err.message);
    return res.status(500).json({ error: 'internal' });
  }
};
