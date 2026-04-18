const { getClient } = require('../lib/supabase');
const { validateRequired, jsonResponse, errorResponse } = require('../lib/helpers');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = req.body;

    const missing = validateRequired(body, ['lead_id', 'name', 'email', 'age', 'goal']);
    if (missing) {
      return res.status(400).json({ error: missing });
    }

    const db = getClient();

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('id', body.lead_id)
      .single();

    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    await db.from('leads').update({ name: body.name }).eq('id', lead.id);

    const { data: existing } = await db
      .from('clients')
      .select('id')
      .eq('phone', lead.phone)
      .limit(1)
      .single();

    if (existing) {
      await db
        .from('clients')
        .update({
          name: body.name,
          email: body.email,
          age: parseInt(body.age, 10) || null,
          goal: body.goal,
          injuries: body.injuries || null,
          diet_pref: body.diet_pref || null,
          schedule: body.schedule || null,
        })
        .eq('id', existing.id);

      return res.status(200).json({ ok: true, client_id: existing.id, updated: true });
    }

    const { data: client } = await db
      .from('clients')
      .insert({
        lead_id: lead.id,
        phone: lead.phone,
        name: body.name,
        email: body.email,
        program: lead.program_interest,
        age: parseInt(body.age, 10) || null,
        goal: body.goal,
        injuries: body.injuries || null,
        diet_pref: body.diet_pref || null,
        schedule: body.schedule || null,
        status: 'active',
      })
      .select()
      .single();

    return res.status(200).json({ ok: true, client_id: client?.id });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
