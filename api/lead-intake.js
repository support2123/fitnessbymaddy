const { supabase } = require('../lib/supabase');
const { maskPhone } = require('../lib/market');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { lead_id, name, email, phone, age, goal, injuries, diet_pref, schedule } = req.body;

    if (!lead_id) {
      return res.status(400).json({ error: 'Missing lead_id' });
    }

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single();

    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    await supabase.from('leads').update({
      name: name || lead.name,
      last_msg_at: new Date().toISOString(),
    }).eq('id', lead_id);

    const { data: existingClient } = await supabase
      .from('clients')
      .select('id')
      .eq('lead_id', lead_id)
      .limit(1)
      .single();

    if (existingClient) {
      await supabase.from('clients').update({
        name: name || existingClient.name,
        email,
        age: age ? parseInt(age) : null,
        goal,
        injuries,
        diet_pref,
        schedule,
      }).eq('id', existingClient.id);

      return res.status(200).json({ status: 'updated', client_id: existingClient.id });
    }

    const { data: client, error } = await supabase.from('clients').insert({
      lead_id,
      phone: phone || lead.phone,
      name: name || lead.name,
      email,
      program: lead.program_interest || 'zoom_trial',
      age: age ? parseInt(age) : null,
      goal,
      injuries,
      diet_pref,
      schedule,
      status: 'active',
    }).select().single();

    if (error) {
      console.error(`Intake error for lead ${lead_id}:`, error.message);
      return res.status(500).json({ error: 'Failed to create client record' });
    }

    console.log(`Intake completed: ${maskPhone(phone || lead.phone)}, client: ${client.id}`);
    return res.status(200).json({ status: 'created', client_id: client.id });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
