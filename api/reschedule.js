const { supabase } = require('./lib/supabase');
const { sendTemplate } = require('./lib/whatsapp');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { email, original_date, preferred_date, preferred_time, reason } = req.body;

    if (!email || !preferred_date || !preferred_time) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('email', email)
      .eq('status', 'active')
      .single();

    if (!client) {
      return res.status(404).json({ error: 'No active client found with this email' });
    }

    await supabase.from('reschedule_requests').insert({
      client_id: client.id,
      original_date,
      preferred_date,
      preferred_time,
      reason: reason || '',
      status: 'pending',
      created_at: new Date().toISOString()
    });

    await sendTemplate('+917082478374', 'reschedule_request', [
      client.name,
      original_date,
      `${preferred_date} at ${preferred_time}`
    ]);

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Reschedule error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
