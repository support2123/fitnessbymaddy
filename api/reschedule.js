const { notifyMaddy } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { name, phone, preferred_date, preferred_time, reason } = req.body;

    if (!name || !phone || !preferred_date || !preferred_time) {
      return res.status(400).json({ error: 'missing required fields' });
    }

    await notifyMaddy(
      'Reschedule Request',
      `From: ${name} (${phone})\nDate: ${preferred_date}\nTime: ${preferred_time}\nReason: ${reason || 'N/A'}`
    );

    return res.json({ success: true });
  } catch (err) {
    console.error('Reschedule error:', err.message);
    return res.status(500).json({ error: 'request failed' });
  }
};
