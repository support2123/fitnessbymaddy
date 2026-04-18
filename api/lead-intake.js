const supabase = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      lead_id, name, email, phone, age, goal,
      injuries, diet_pref, schedule, program
    } = req.body;

    if (!phone && !lead_id) {
      return res.status(400).json({ error: 'Phone or lead_id required' });
    }

    if (lead_id) {
      const { data: lead } = await supabase
        .from('leads')
        .select('*')
        .eq('id', lead_id)
        .maybeSingle();

      if (lead) {
        await supabase.from('leads').update({
          name: name || lead.name,
          last_msg_at: new Date().toISOString()
        }).eq('id', lead_id);
      }
    }

    const { data: existingClient } = await supabase
      .from('clients')
      .select('id')
      .eq('phone', phone)
      .maybeSingle();

    if (existingClient) {
      await supabase.from('clients').update({
        name, email, age: parseInt(age) || null,
        goal, injuries, diet_pref, schedule
      }).eq('id', existingClient.id);

      return res.status(200).json({ status: 'updated', client_id: existingClient.id });
    }

    const { data: client, error } = await supabase.from('clients').insert({
      lead_id: lead_id || null,
      phone,
      name,
      email,
      program: program || null,
      age: parseInt(age) || null,
      goal,
      injuries,
      diet_pref,
      schedule,
      status: 'active'
    }).select().single();

    if (error) {
      console.error('Intake insert error:', error.message);
      return res.status(500).json({ error: 'Failed to save' });
    }

    return res.status(200).json({ status: 'created', client_id: client.id });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
};
