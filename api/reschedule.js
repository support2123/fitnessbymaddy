const { sendToMaddy } = require('./lib/whatsapp');
const { maskPhone } = require('./lib/market');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { name, phone, preferred_date, preferred_time, reason, client_id } = req.body;

    if (!name || !phone || !preferred_date || !preferred_time) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const msg = [
      `RESCHEDULE REQUEST`,
      `Client: ${name} (${maskPhone(phone)})`,
      `Date: ${preferred_date} at ${preferred_time}`,
      reason ? `Reason: ${reason}` : '',
      client_id ? `Client ID: ${client_id}` : '',
    ].filter(Boolean).join('\n');

    await sendToMaddy(msg);

    return res.json({ success: true });
  } catch (err) {
    console.error('Reschedule error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
