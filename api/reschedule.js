const { supabase } = require('./lib/supabase');
const { notifyMaddy } = require('./lib/escalate');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { name, phone, date, timeSlot, reason } = req.body;

    if (!name || !phone || !date || !timeSlot) {
      return res.status(400).json({ error: 'name, phone, date, and timeSlot are required' });
    }

    await notifyMaddy('Reschedule request', {
      name,
      phone,
      details: `Date: ${date}, Time: ${timeSlot}. Reason: ${reason || 'Not specified'}`,
    });

    return res.status(200).json({ ok: true, message: 'Reschedule request sent' });
  } catch (err) {
    console.error('Reschedule error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
