const { getSupabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const supabase = getSupabase();

  try {
    const {
      lead_id, name, email, age, goal, injuries,
      diet_pref, schedule, phone
    } = req.body;

    if (!lead_id && !phone) {
      return res.status(400).json({ error: 'Missing lead_id or phone' });
    }

    let lead;
    if (lead_id) {
      const { data } = await supabase
        .from('leads')
        .select('*')
        .eq('id', lead_id)
        .maybeSingle();
      lead = data;
    } else {
      const { data } = await supabase
        .from('leads')
        .select('*')
        .eq('phone', phone)
        .maybeSingle();
      lead = data;
    }

    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    if (name) {
      await supabase.from('leads').update({ name }).eq('id', lead.id);
    }

    const { data: existingClient } = await supabase
      .from('clients')
      .select('id')
      .eq('lead_id', lead.id)
      .maybeSingle();

    if (existingClient) {
      await supabase.from('clients').update({
        name: name || existingClient.name,
        email,
        age: age ? parseInt(age) : null,
        goal,
        injuries,
        diet_pref,
        schedule
      }).eq('id', existingClient.id);

      return res.json({ success: true, client_id: existingClient.id, updated: true });
    }

    const { data: client, error } = await supabase.from('clients').insert({
      lead_id: lead.id,
      phone: lead.phone,
      name: name || lead.name,
      email,
      program: lead.program_interest,
      age: age ? parseInt(age) : null,
      goal,
      injuries,
      diet_pref,
      schedule,
      status: 'active'
    }).select().single();

    if (error) throw error;

    return res.json({ success: true, client_id: client.id });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
