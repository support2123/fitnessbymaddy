const { getSupabase } = require('../lib/supabase');
const { sendText, maskPhone } = require('../lib/whatsapp');
const { escalateToMaddy } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const supabase = getSupabase();

  try {
    const { name, phone, preferred_date, preferred_time, reason } = req.body;

    if (!name || !phone || !preferred_date || !preferred_time) {
      return res.status(400).json({ error: 'name, phone, preferred_date, and preferred_time are required' });
    }

    await supabase.from('reschedule_requests').insert({
      name,
      phone,
      preferred_date,
      preferred_time,
      reason: reason || '',
      status: 'pending',
      created_at: new Date().toISOString(),
    });

    await escalateToMaddy(
      'Session reschedule request',
      `Client: ${name}\nPhone: ${maskPhone(phone)}\nDate: ${preferred_date}\nTime: ${preferred_time}\nReason: ${reason || 'N/A'}`,
      { supabase }
    );

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Reschedule error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
