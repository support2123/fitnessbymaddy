const { getSupabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');
const { notifyMaddy } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const db = getSupabase();
  const { client_id, preferred_date, preferred_time, reason } = req.body;

  if (!client_id || !preferred_date || !preferred_time) {
    return res.status(400).json({ error: 'client_id, preferred_date, preferred_time required' });
  }

  const { data: client } = await db
    .from('clients')
    .select('*')
    .eq('id', client_id)
    .single();

  if (!client) return res.status(404).json({ error: 'Client not found' });

  await notifyMaddy('Reschedule request', {
    phone: client.phone,
    info: `${client.name} wants to reschedule to ${preferred_date} at ${preferred_time}. Reason: ${reason || 'Not specified'}`,
  });

  await sendTemplate(client.phone, 'reschedule_confirmed', [
    client.name || 'there',
    preferred_date,
    preferred_time,
  ]);

  return res.status(200).json({ success: true, message: 'Reschedule request submitted' });
};
