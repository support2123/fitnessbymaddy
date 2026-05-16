const { getSupabase } = require('./_lib/supabase');
const { sendWhatsApp, notifyMaddy } = require('./_lib/whatsapp');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { client_id, date, time, reason } = req.body;

  if (!client_id || !date || !time) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const db = getSupabase();

  const { data: client } = await db
    .from('clients')
    .select('name, phone')
    .eq('id', client_id)
    .single();

  if (!client) {
    return res.status(404).json({ error: 'Client not found' });
  }

  await notifyMaddy(
    'RESCHEDULE REQUEST',
    `${client.name || 'Client'} wants to reschedule to ${date} at ${time}. Reason: ${reason || 'Not provided'}`
  );

  await sendWhatsApp(client.phone, 'reschedule_confirmed', {
    name: client.name || 'there',
    templateParams: [date, time]
  });

  return res.status(200).json({ success: true });
};
