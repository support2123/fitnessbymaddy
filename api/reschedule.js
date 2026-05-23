const { notifyMaddy } = require('../lib/whatsapp');
const { maskPhone } = require('../lib/market');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { name, phone, new_date, time_slot, reason } = req.body;

    if (!name || !phone || !new_date || !time_slot) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    await notifyMaddy(
      'Reschedule Request',
      `Name: ${name}\nPhone: ${maskPhone(phone)}\nNew Date: ${new_date}\nTime: ${time_slot}\nReason: ${reason || 'Not provided'}`
    );

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Reschedule error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
