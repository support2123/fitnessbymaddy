const { sendText } = require('../lib/whatsapp');
const { maskPhone, cors } = require('../lib/helpers');

const MADDY_PHONE = process.env.MADDY_PHONE || '+917082478374';

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { name, phone, preferred_date, preferred_slot, reason } = req.body;

    if (!name || !phone || !preferred_date || !preferred_slot) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    await sendText(MADDY_PHONE,
      `RESCHEDULE REQUEST\n` +
      `Client: ${name}\n` +
      `Phone: ${maskPhone(phone)}\n` +
      `Date: ${preferred_date}\n` +
      `Slot: ${preferred_slot}\n` +
      `Reason: ${reason || 'Not specified'}`
    );

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Reschedule error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
