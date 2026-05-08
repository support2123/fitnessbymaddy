const { supabase } = require('./lib/supabase');
const { sendTemplate } = require('./lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { client_id, name, contact, preferred_date, preferred_time, reason } = req.body;

    if (!name || !contact || !preferred_date) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const maddyPhone = process.env.MADDY_PHONE || '+917082478374';
    await sendTemplate(maddyPhone, 'reschedule_request', [
      name,
      contact,
      `${preferred_date} at ${preferred_time || 'flexible'}`,
      reason || 'No reason given',
    ]);

    await supabase.from('messages').insert({
      phone: contact,
      direction: 'in',
      body: `Reschedule request: ${preferred_date} ${preferred_time || ''} — ${reason || 'no reason'}`,
      template_name: 'reschedule_request',
    });

    return res.json({ success: true });
  } catch (err) {
    console.error('Reschedule error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
