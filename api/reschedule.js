const { getSupabase } = require('./lib/supabase');
const { sendWhatsApp, notifyMaddy } = require('./lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const db = getSupabase();
  const { client_id, preferred_date, preferred_time, reason } = req.body;

  if (!client_id || !preferred_date || !preferred_time) {
    return res.status(400).json({ error: 'client_id, preferred_date, and preferred_time required' });
  }

  const { data: client } = await db
    .from('clients')
    .select('*')
    .eq('id', client_id)
    .eq('status', 'active')
    .single();

  if (!client) return res.status(404).json({ error: 'Active client not found' });

  const requestedDate = new Date(`${preferred_date}T${preferred_time}:00`);
  const now = new Date();
  const hoursUntilSession = (requestedDate - now) / (1000 * 60 * 60);

  if (hoursUntilSession < 12) {
    return res.status(400).json({ error: 'Reschedule must be at least 12 hours in advance' });
  }

  await notifyMaddy(
    `Reschedule request: ${client.name} wants ${preferred_date} at ${preferred_time}. Reason: ${reason || 'None given'}`
  );

  await sendWhatsApp(client.phone, 'reschedule_confirmed', {
    name: client.name,
    templateParams: [client.name, preferred_date, preferred_time]
  });

  return res.status(200).json({ success: true, message: 'Reschedule request submitted' });
};
