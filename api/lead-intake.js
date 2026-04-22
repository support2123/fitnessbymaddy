const { getSupabase } = require('./_lib/supabase');
const { jsonResponse } = require('./_lib/helpers');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(204).end();
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

    if (!lead_id && !phone) {
      return res.status(400).json({ error: 'Missing lead_id or phone' });
    }

    const db = getSupabase();

    if (lead_id) {
      await db
        .from('leads')
        .update({ name: name || undefined })
        .eq('id', lead_id);
    }

    const lookupField = lead_id ? 'id' : 'phone';
    const lookupValue = lead_id || phone;

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq(lookupField, lookupValue)
      .limit(1)
      .single();

    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    const { data: existingClient } = await db
      .from('clients')
      .select('id')
      .eq('lead_id', lead.id)
      .limit(1)
      .single();

    if (existingClient) {
      await db
        .from('clients')
        .update({
          name: name || existingClient.name,
          email,
          age: age ? parseInt(age) : null,
          goal,
          injuries,
          diet_pref,
          schedule,
        })
        .eq('id', existingClient.id);

      return res.status(200).json({ success: true, client_id: existingClient.id, updated: true });
    }

    const { data: client } = await db
      .from('clients')
      .insert({
        lead_id: lead.id,
        phone: lead.phone,
        name: name || lead.name,
        email,
        age: age ? parseInt(age) : null,
        goal,
        injuries,
        diet_pref,
        schedule,
        status: 'active',
        program: lead.program_interest,
      })
      .select()
      .single();

    return res.status(200).json({ success: true, client_id: client?.id });
  } catch (err) {
    console.error('[INTAKE ERROR]', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
