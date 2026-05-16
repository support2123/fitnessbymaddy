const { getSupabase } = require('./lib/supabase');
const { sendWhatsApp } = require('./lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { name, phone, original_date, new_date, time_slot, reason } = req.body;

    if (!name || !phone || !new_date || !time_slot) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const supabase = getSupabase();

    await supabase.from('reschedule_requests').insert({
      name,
      phone,
      original_date: original_date || null,
      new_date,
      time_slot,
      reason: reason || null,
      status: 'pending',
      created_at: new Date().toISOString()
    });

    await sendWhatsApp(process.env.MADDY_PHONE, 'reschedule_request', {
      templateParams: [name, new_date, time_slot, reason || 'No reason given']
    });

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Reschedule error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
