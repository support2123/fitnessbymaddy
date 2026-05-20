const { getSupabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { lead_id, name, email, age, goal, injuries, diet_pref, schedule, phone } = req.body;

    if (!lead_id) return res.status(400).json({ error: 'lead_id required' });

    const db = getSupabase();

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single();

    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    await db.from('leads').update({
      name: name || lead.name,
      last_msg_at: new Date().toISOString()
    }).eq('id', lead_id);

    const { data: existingClient } = await db
      .from('clients')
      .select('id')
      .eq('phone', lead.phone)
      .single();

    if (existingClient) {
      await db.from('clients').update({
        name: name || existingClient.name,
        email,
        age: age ? parseInt(age) : null,
        goal,
        injuries,
        diet_pref,
        schedule
      }).eq('id', existingClient.id);
    }

    return res.json({ success: true, message: 'Intake form saved' });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
