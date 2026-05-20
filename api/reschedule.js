const { sendWhatsApp } = require('./_lib/whatsapp');
const { maskPhone } = require('./_lib/mask');

const MADDY_PHONE = process.env.MADDY_PHONE || '917082478374';

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { name, phone, date, time_slot, notes } = req.body || {};
    if (!name || !phone || !date || !time_slot) {
      return res.status(400).json({ error: 'name, phone, date, and time_slot required' });
    }

    await sendWhatsApp(MADDY_PHONE, null, {
      text: `RESCHEDULE REQUEST:\nClient: ${name}\nPhone: ${maskPhone(phone)}\nNew date: ${date} at ${time_slot}\nNotes: ${notes || 'none'}`,
      isClient: true,
      skipRateLimit: true
    });

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('[Reschedule] Error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
