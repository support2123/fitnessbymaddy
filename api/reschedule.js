const { sendTemplate } = require('../lib/whatsapp');

const MADDY_PHONE = process.env.MADDY_PHONE || '917082478374';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { name, phone, preferred_date, preferred_time, reason } = req.body;

    if (!name || !phone || !preferred_date || !preferred_time) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    await sendTemplate(MADDY_PHONE, 'reschedule_alert', [
      name,
      phone,
      `${preferred_date} at ${preferred_time}`,
      reason || 'Not specified',
    ]);

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Reschedule error:', err.message);
    return res.status(200).json({ success: true });
  }
};
