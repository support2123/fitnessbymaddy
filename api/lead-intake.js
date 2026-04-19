const { getSupabase } = require('../lib/supabase');
const { maskPhone } = require('../lib/helpers');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).json({});
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      lead_id, name, email, age, goal, injuries,
      diet_pref, schedule, phone,
    } = req.body;

    if (!lead_id && !phone) {
      return res.status(400).json({ error: 'lead_id or phone required' });
    }

    const db = getSupabase();

    let lead;
    if (lead_id) {
      const { data } = await db.from('leads').select('*').eq('id', lead_id).single();
      lead = data;
    } else {
      const { data } = await db.from('leads').select('*').eq('phone', phone).single();
      lead = data;
    }

    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    if (name) {
      await db.from('leads').update({ name }).eq('id', lead.id);
    }

    const { data: existingClient } = await db
      .from('clients')
      .select('id')
      .eq('lead_id', lead.id)
      .single();

    if (existingClient) {
      await db.from('clients').update({
        name: name || existingClient.name,
        email,
        age: age ? parseInt(age) : null,
        goal,
        injuries,
        diet_pref,
        schedule,
      }).eq('id', existingClient.id);

      console.log(`[INTAKE] Updated client for ${maskPhone(lead.phone)}`);
      return res.status(200).json({ success: true, updated: true, client_id: existingClient.id });
    }

    const { data: newClient, error } = await db.from('clients').insert({
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
      status: 'active',
    }).select().single();

    if (error) {
      console.error('[INTAKE ERROR]', error.message);
      return res.status(500).json({ error: 'Failed to create client' });
    }

    console.log(`[INTAKE] New client created for ${maskPhone(lead.phone)}`);
    return res.status(200).json({ success: true, client_id: newClient.id });
  } catch (err) {
    console.error('[INTAKE ERROR]', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
