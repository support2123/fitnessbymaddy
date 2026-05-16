const { supabase } = require('./lib/supabase');
const { sendWhatsApp } = require('./lib/whatsapp');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { client_id, preferred_date, preferred_time, reason } = req.body;

    if (!client_id || !preferred_date || !preferred_time) {
      return res.status(400).json({ error: 'client_id, preferred_date, and preferred_time required' });
    }

    const { data: client } = await supabase
      .from('clients')
      .select('name, phone')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    await sendWhatsApp('+917082478374', 'reschedule_request', {
      name: 'Maddy',
      templateParams: [
        client.name || 'A client',
        preferred_date,
        preferred_time,
        reason || 'No reason given'
      ]
    }, true);

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Reschedule error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
