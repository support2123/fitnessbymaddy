const { supabase } = require('./lib/supabase');
const { jsonResponse, errorResponse } = require('./lib/utils');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      lead_id,
      name,
      email,
      age,
      goal,
      injuries,
      diet_pref,
      schedule,
      phone,
    } = req.body;

    if (!lead_id) {
      return res.status(400).json({ error: 'Missing lead_id' });
    }

    const { data: lead } = await supabase
      .from('leads')
      .select('id, phone')
      .eq('id', lead_id)
      .single();

    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    if (name) {
      await supabase.from('leads').update({ name }).eq('id', lead_id);
    }

    const { data: existingClient } = await supabase
      .from('clients')
      .select('id')
      .eq('lead_id', lead_id)
      .single();

    const clientData = {
      name: name || null,
      email: email || null,
      age: age ? parseInt(age) : null,
      goal: goal || null,
      injuries: injuries || null,
      diet_pref: diet_pref || null,
      schedule: schedule || null,
    };

    if (existingClient) {
      await supabase
        .from('clients')
        .update(clientData)
        .eq('id', existingClient.id);
    } else {
      await supabase.from('clients').insert({
        ...clientData,
        lead_id,
        phone: phone || lead.phone,
        status: 'active',
      });
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
