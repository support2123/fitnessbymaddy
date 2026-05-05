const { getSupabase } = require('./lib/supabase');
const { sendWhatsApp } = require('./lib/whatsapp');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const db = getSupabase();
  const { client_id, preferred_date, preferred_time, reason } = req.body;

  if (!client_id || !preferred_date || !preferred_time) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const { data: client } = await db
    .from('clients')
    .select('*')
    .eq('id', client_id)
    .single();

  if (!client) {
    return res.status(404).json({ error: 'Client not found' });
  }

  await sendWhatsApp(client.phone, 'reschedule_confirmed', [
    client.name || 'there',
    preferred_date,
    preferred_time
  ]);

  return res.status(200).json({ success: true });
};
