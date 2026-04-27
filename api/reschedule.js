const { getClient } = require('../lib/supabase');
const { sendText } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { client_id, name, phone, date, time_slot, reason } = req.body;

    if (!name || !phone || !date || !time_slot) {
      return res.status(400).json({ error: 'name, phone, date, and time_slot required' });
    }

    const maddyPhone = process.env.MADDY_PHONE || '917082478374';
    const msg = `RESCHEDULE REQUEST\nClient: ${name} (${phone})\nDate: ${date}\nTime: ${time_slot}\nReason: ${reason || 'N/A'}`;

    await sendText(maddyPhone, msg, true);

    const db = getClient();
    await db.from('messages').insert({
      phone,
      direction: 'in',
      body: `Reschedule request: ${date} at ${time_slot}`,
      template_name: null,
    });

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Reschedule error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
