const { supabase } = require('../lib/supabase');
const { escalateToMaddy } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { name, phone, date, time, reason } = req.body;
    if (!name || !phone || !date || !time) {
      return res.status(400).json({ error: 'Name, phone, date, and time are required' });
    }

    await escalateToMaddy('Reschedule request', {
      name,
      phone,
      details: `Wants to reschedule to ${date} at ${time}. ${reason ? 'Reason: ' + reason : ''}`
    });

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Reschedule error:', err.message);
    return res.status(500).json({ error: 'Failed to submit' });
  }
};
