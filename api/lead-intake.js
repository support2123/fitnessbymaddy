const { supabase } = require('./lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { lead_id, name, email, age, goal, injuries, diet_pref, schedule, phone } = req.body;

  if (!lead_id && !phone) {
    return res.status(400).json({ error: 'lead_id or phone required' });
  }

  try {
    let lead;
    if (lead_id) {
      const { data } = await supabase.from('leads').select('*').eq('id', lead_id).single();
      lead = data;
    } else {
      const { data } = await supabase.from('leads').select('*').eq('phone', phone).order('created_at', { ascending: false }).limit(1).single();
      lead = data;
    }

    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    // Update lead with name
    if (name) {
      await supabase.from('leads').update({ name }).eq('id', lead.id);
    }

    // Store intake data on client record if already converted
    const { data: existingClient } = await supabase
      .from('clients')
      .select('*')
      .eq('lead_id', lead.id)
      .single();

    if (existingClient) {
      await supabase.from('clients').update({
        name: name || existingClient.name,
        email: email || existingClient.email,
        age: age || existingClient.age,
        goal: goal || existingClient.goal,
        injuries: injuries || existingClient.injuries,
        diet_pref: diet_pref || existingClient.diet_pref,
        schedule: schedule || existingClient.schedule
      }).eq('id', existingClient.id);
    }

    return res.status(200).json({ success: true, lead_id: lead.id });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
