const { getSupabase } = require('../lib/supabase');
const { escalateToMaddy } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { name, contact, preferred_date, preferred_time, reason } = req.body;

    if (!name || !contact || !preferred_date) {
      return res.status(400).json({ error: 'Name, contact, and date are required' });
    }

    await escalateToMaddy(
      'Reschedule request',
      `Name: ${name}\nContact: ${contact}\nDate: ${preferred_date}\nTime: ${preferred_time || 'Any'}\nReason: ${reason || 'Not provided'}`
    );

    return res.status(200).json({ success: true, message: 'Reschedule request received' });
  } catch (err) {
    console.error('Reschedule error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
