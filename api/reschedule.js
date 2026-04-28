const { getSupabase } = require('./lib/supabase');
const { sendWhatsApp } = require('./lib/whatsapp');
const { escalateToMaddy } = require('./lib/escalation');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { client_id, name, phone, reason, preferred_date, preferred_time, notes } = req.body;

  if (!name || !phone || !preferred_date || !preferred_time) {
    return res.status(400).json({ error: 'Name, phone, date, and time are required' });
  }

  const db = getSupabase();

  await db.from('reschedule_requests').insert({
    client_id: client_id || null,
    name,
    phone,
    reason: reason || null,
    preferred_date,
    preferred_time,
    notes: notes || null,
    status: 'pending',
    created_at: new Date().toISOString()
  });

  await escalateToMaddy(
    'Reschedule request',
    `${name} (${phone}) wants to reschedule to ${preferred_date} at ${preferred_time}. Reason: ${reason || 'not specified'}`
  );

  return res.status(200).json({ success: true, message: 'Reschedule request submitted' });
};
