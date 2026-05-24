const { getSupabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const db = getSupabase();

  try {
    const {
      lead_id, name, email, phone, age, goal,
      injuries, diet_pref, schedule,
    } = req.body;

    if (!lead_id) return res.status(400).json({ error: 'lead_id required' });

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single();

    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    if (name) {
      await db.from('leads').update({ name }).eq('id', lead_id);
    }

    const { data: existingClient } = await db
      .from('clients')
      .select('id')
      .eq('lead_id', lead_id)
      .single();

    if (existingClient) {
      await db.from('clients').update({
        name: name || lead.name,
        email,
        age: age ? parseInt(age, 10) : null,
        goal,
        injuries,
        diet_pref,
        schedule,
      }).eq('id', existingClient.id);

      return res.json({ success: true, client_id: existingClient.id, updated: true });
    }

    const { data: client, error } = await db.from('clients').insert({
      lead_id,
      phone: phone || lead.phone,
      name: name || lead.name,
      email,
      program: lead.program_interest,
      age: age ? parseInt(age, 10) : null,
      goal,
      injuries,
      diet_pref,
      schedule,
      status: 'active',
    }).select().single();

    if (error) throw error;

    return res.json({ success: true, client_id: client.id });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
