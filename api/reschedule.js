const { notifyMaddy, maskPhone } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { name, phone, preferred_date, time_slot, reason, client_id } = req.body;

    if (!name || !phone || !preferred_date || !time_slot) {
      return res.status(400).json({ error: 'name, phone, preferred_date, and time_slot required' });
    }

    const details = [
      `Client: ${name}`,
      `Phone: ${maskPhone(phone)}`,
      `New date: ${preferred_date} at ${time_slot}`,
      reason ? `Reason: ${reason}` : null,
      client_id ? `Client ID: ${client_id}` : null,
    ].filter(Boolean).join('\n');

    await notifyMaddy('Reschedule Request', details);

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Reschedule error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
