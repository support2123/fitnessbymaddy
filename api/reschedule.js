const { supabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { client_id, date, time, reason } = req.body;

    if (!client_id || !date || !time) {
      return res.status(400).json({ error: 'client_id, date, and time required' });
    }

    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .eq('status', 'active')
      .single();

    if (!client) return res.status(404).json({ error: 'Active client not found' });

    await supabase.from('messages').insert({
      phone: client.phone,
      direction: 'in',
      body: `Reschedule request: ${date} at ${time}. Reason: ${reason || 'N/A'}`,
      sent_at: new Date().toISOString(),
      status: 'received'
    });

    await sendWhatsApp(client.phone, 'session_rescheduled', {
      name: client.name || 'there',
      templateParams: [client.name || 'there', date, time]
    });

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Reschedule error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
