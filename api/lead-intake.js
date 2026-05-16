const { supabase } = require('./lib/supabase');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { lead_id, name, email, age, goal, injuries, diet_pref, schedule, phone } = req.body;

    if (!lead_id && !phone) {
      return res.status(400).json({ error: 'lead_id or phone required' });
    }

    let leadData;
    if (lead_id) {
      const { data } = await supabase.from('leads').select('*').eq('id', lead_id).single();
      leadData = data;
    } else {
      const { data } = await supabase.from('leads').select('*').eq('phone', phone).single();
      leadData = data;
    }

    if (!leadData) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    if (name) {
      await supabase.from('leads').update({ name }).eq('id', leadData.id);
    }

    const { data: existingClient } = await supabase
      .from('clients')
      .select('id')
      .eq('lead_id', leadData.id)
      .single();

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
    }

    return res.status(200).json({ success: true, lead_id: leadData.id });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
