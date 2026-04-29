const { supabase } = require('../lib/supabase');
const { maskPhone } = require('../lib/utils');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      lead_id, name, email, phone, age, goal,
      injuries, diet_pref, schedule, photos
    } = req.body;

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

    if (name) {
      await supabase
        .from('leads')
        .update({ name })
        .eq('id', lead_id);
    }

    const { data: existingClient } = await supabase
      .from('clients')
      .select('id')
      .eq('lead_id', lead_id)
      .limit(1)
      .single();

    if (existingClient) {
      await supabase
        .from('clients')
        .update({
          name: name || existingClient.name,
          email,
          age: age ? parseInt(age) : null,
          goal,
          injuries,
          diet_pref,
          schedule
        })
        .eq('id', existingClient.id);

      return res.status(200).json({ success: true, client_id: existingClient.id, updated: true });
    }

    const { data: client, error } = await supabase
      .from('clients')
      .insert({
        lead_id,
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
      })
      .select()
      .single();

    if (error) {
      console.error(`Intake error for lead ${maskPhone(lead.phone)}:`, error.message);
      return res.status(500).json({ error: 'Failed to save intake data' });
    }

    return res.status(200).json({ success: true, client_id: client.id });
  } catch (err) {
    console.error('Intake handler error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
