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

    // Find the lead
    let lead;
    if (lead_id) {
      const { data } = await supabase.from('leads').select('*').eq('id', lead_id).single();
      lead = data;
    } else {
      const { data } = await supabase.from('leads').select('*').eq('phone', phone).single();
      lead = data;
    }

    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    // Update lead with name
    if (name) {
      await supabase.from('leads').update({ name }).eq('id', lead.id);
    }

    // If client already exists, update their info
    const { data: existingClient } = await supabase
      .from('clients')
      .select('id')
      .eq('lead_id', lead.id)
      .single();

    if (existingClient) {
      await supabase.from('clients').update({
        name: name || undefined,
        email: email || undefined,
        age: age || undefined,
        goal: goal || undefined,
        injuries: injuries || undefined,
        diet_pref: diet_pref || undefined,
        schedule: schedule || undefined
      }).eq('id', existingClient.id);

      return res.status(200).json({ success: true, client_id: existingClient.id, updated: true });
    }

    return res.status(200).json({
      success: true,
      lead_id: lead.id,
      message: 'Intake saved. Client record will be created on payment.'
    });
  } catch (err) {
    console.error('Lead intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
