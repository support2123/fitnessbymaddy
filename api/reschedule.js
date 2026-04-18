const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { name, phone, date, time, reason } = req.body;

    if (!name || !phone || !date || !time) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const maddyPhone = process.env.MADDY_PHONE;
    if (maddyPhone) {
      await sendWhatsApp(maddyPhone, 'reschedule_request', [
        name,
        phone.slice(-4),
        date,
        time,
        reason || 'No reason given',
      ]);
    }

    await sendWhatsApp(phone, 'reschedule_confirmed', [
      name,
      date,
      time,
    ]);

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Reschedule error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
