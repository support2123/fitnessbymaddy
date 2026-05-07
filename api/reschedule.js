const { notifyMaddy } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://www.fitnessbymaddy.com');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { name, phone, preferred_date, preferred_time, reason } = req.body;

    if (!name || !preferred_date || !preferred_time) {
      return res.status(400).json({ error: 'name, preferred_date, and preferred_time required' });
    }

    await notifyMaddy(
      'Reschedule Request',
      `${name} (${phone || 'no phone'}) wants to reschedule to ${preferred_date} at ${preferred_time}. Reason: ${reason || 'Not given'}`
    );

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Reschedule error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
