const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { notifyMaddy } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const supabase = getSupabase();
  const { client_id, date, time, reason } = req.body;

  if (!client_id || !date || !time) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const { data: client } = await supabase
    .from('clients')
    .select('*')
    .eq('id', client_id)
    .single();

  if (!client) return res.status(404).json({ error: 'Client not found' });

  // Notify Maddy about reschedule
  await notifyMaddy('Session reschedule request', {
    name: client.name,
    phone: client.phone,
    message: `Wants to reschedule to ${date} at ${time}. Reason: ${reason || 'Not specified'}`
  });

  // Send confirmation to client
  await sendWhatsApp(client.phone, 'reschedule_confirmed', {
    name: client.name,
    templateParams: [client.name, date, time]
  }).catch(() => {});

  return res.status(200).json({ success: true });
};
