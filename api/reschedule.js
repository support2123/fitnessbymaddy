const { notifyMaddy } = require('./lib/whatsapp');
const { getSupabase } = require('./lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { client_id, name, phone, preferred_date, preferred_time, reason } = req.body;

    if (!name || !phone || !preferred_date || !preferred_time) {
      return res.status(400).json({ error: 'name, phone, preferred_date, and preferred_time are required' });
    }

    await notifyMaddy(
      'Session Reschedule Request',
      `Client: ${name}\nPhone: ${phone}\nDate: ${preferred_date}\nTime: ${preferred_time} IST\nReason: ${reason || 'Not specified'}`
    );

    const db = getSupabase();
    await db.from('messages').insert({
      phone: phone.replace(/[^0-9]/g, ''),
      direction: 'in',
      body: `[RESCHEDULE] Date: ${preferred_date} Time: ${preferred_time} Reason: ${reason || 'N/A'}`,
      sent_at: new Date().toISOString()
    });

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Reschedule error:', err.message);
    return res.status(500).json({ error: 'Failed to submit reschedule request' });
  }
};
