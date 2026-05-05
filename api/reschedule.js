const { supabase } = require('./lib/supabase');
const { sendTemplate } = require('./lib/whatsapp');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://fitnessbymaddy.com');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { client_id, date, time, reason } = req.body;

  if (!client_id || !date || !time) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const { data: client } = await supabase
      .from('clients')
      .select('id, phone, name')
      .eq('id', client_id)
      .single();

    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    // Notify Maddy about reschedule
    await sendTemplate('+917082478374', 'reschedule_notify', [
      client.name || 'Client',
      `${date} at ${time}`,
      reason || 'No reason given'
    ]);

    // Confirm to client
    await sendTemplate(client.phone, 'reschedule_confirmed', [
      client.name || 'there',
      `${date} at ${time}`
    ]);

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Reschedule error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
