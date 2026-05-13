const { getSupabase } = require('../lib/supabase');
const { notifyMaddy } = require('../lib/whatsapp');
const { maskPhone } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { name, phone, preferred_date, preferred_time, reason, notes } = req.body;

  if (!name || !phone || !preferred_date) {
    return res.status(400).json({ error: 'name, phone, and preferred_date required' });
  }

  const db = getSupabase();
  const cleanPhone = phone.replace(/[^0-9+]/g, '').replace(/^\+/, '');

  // Verify this is an existing client
  const { data: client } = await db
    .from('clients')
    .select('id, name, program')
    .eq('phone', cleanPhone)
    .single();

  // Notify Maddy of reschedule request
  await notifyMaddy(
    'Session reschedule request',
    `Client: ${name} (${maskPhone(cleanPhone)})\nProgram: ${client?.program || 'unknown'}\nNew date: ${preferred_date} at ${preferred_time || 'flexible'}\nReason: ${reason}\nNotes: ${notes || 'none'}`
  );

  return res.status(200).json({ success: true });
};
