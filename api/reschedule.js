const { getSupabase } = require('./lib/supabase');
const { sendTemplate } = require('./lib/whatsapp');
const { logMessage } = require('./lib/rate-limit');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { client_id, reason, preferred_date, preferred_time, notes } = req.body;

    if (!client_id || !preferred_date || !preferred_time) {
      return res.status(400).json({ error: 'client_id, preferred_date, and preferred_time required' });
    }

    const db = getSupabase();

    const { data: client } = await db
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .eq('status', 'active')
      .single();

    if (!client) return res.status(404).json({ error: 'Active client not found' });

    await db.from('reschedules').insert({
      client_id,
      reason: reason || null,
      preferred_date,
      preferred_time,
      notes: notes || null,
      status: 'pending',
      created_at: new Date().toISOString()
    });

    await sendTemplate(client.phone, 'reschedule_confirmed', [
      client.name,
      preferred_date,
      preferred_time
    ]);
    await logMessage(client.phone, 'out', `[Reschedule confirmed: ${preferred_date} ${preferred_time}]`, 'reschedule_confirmed');

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Reschedule error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
