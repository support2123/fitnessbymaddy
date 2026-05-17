const { supabase } = require('./_lib/supabase');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).setHeader('Access-Control-Allow-Origin', '*').end();
  }

  Object.entries(CORS_HEADERS).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST only' });
  }

  try {
    const { lead_id, name, email, phone, age, goal, injuries, diet_pref, schedule, program } = req.body;

    if (!lead_id && !phone) {
      return res.status(400).json({ error: 'lead_id or phone required' });
    }

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

    if (name) {
      await supabase.from('leads').update({ name }).eq('id', lead.id);
    }

    const clientData = {
      lead_id: lead.id,
      phone: lead.phone,
      name: name || lead.name,
      email: email || null,
      program: program || lead.program_interest || '6wk_gym',
      age: age ? parseInt(age) : null,
      goal: goal || null,
      injuries: injuries || null,
      diet_pref: diet_pref || null,
      schedule: schedule || null,
      status: 'active'
    };

    const { data: existingClient } = await supabase
      .from('clients')
      .select('id')
      .eq('lead_id', lead.id)
      .single();

    if (existingClient) {
      await supabase.from('clients').update(clientData).eq('id', existingClient.id);
      return res.status(200).json({ ok: true, client_id: existingClient.id, updated: true });
    }

    const { data: client, error } = await supabase.from('clients').insert(clientData).select().single();

    if (error) {
      console.error('Insert client error:', error.message);
      return res.status(500).json({ error: 'Failed to save intake' });
    }

    return res.status(200).json({ ok: true, client_id: client.id });
  } catch (err) {
    console.error('Lead intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
