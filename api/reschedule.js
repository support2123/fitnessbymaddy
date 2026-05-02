const { getSupabase } = require('./lib/supabase');
const { sendWhatsApp } = require('./lib/whatsapp');
const { MADDY_PHONE } = require('./lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { name, phone, preferred_date, time_slot, reason } = req.body;

    if (!name || !phone || !preferred_date) {
      return res.status(400).json({ error: 'name, phone, and preferred_date required' });
    }

    const supabase = getSupabase();

    await supabase.from('messages').insert({
      phone,
      direction: 'in',
      body: `Reschedule request: ${preferred_date} ${time_slot || ''} - ${reason || 'No reason given'}`,
      sent_at: new Date().toISOString(),
      status: 'received',
    });

    await sendWhatsApp(MADDY_PHONE, 'reschedule_request', [
      name,
      phone,
      preferred_date,
      time_slot || 'Any',
    ]);

    await sendWhatsApp(phone, 'reschedule_confirmed', [
      name,
      preferred_date,
    ]);

    return res.status(200).json({ status: 'submitted' });
  } catch (err) {
    console.error('Reschedule error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
