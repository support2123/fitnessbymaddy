const { getSupabase } = require('./lib/supabase');
const { sendWhatsApp } = require('./lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { name, phone, preferred_date, preferred_time, reason } = req.body;

    if (!name || !phone || !preferred_date || !preferred_time) {
      return res.status(400).json({ error: 'All required fields must be filled' });
    }

    const db = getSupabase();

    await db.from('reschedule_requests').insert({
      name,
      phone,
      preferred_date,
      preferred_time,
      reason: reason || null,
      status: 'pending',
      created_at: new Date().toISOString(),
    });

    await sendWhatsApp('+917082478374', 'escalation_alert', [
      'Reschedule request',
      phone,
      `${name} wants ${preferred_date} at ${preferred_time}`,
    ]);

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Reschedule error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
