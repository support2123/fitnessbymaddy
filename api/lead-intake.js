const { getSupabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

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
      return res.status(400).json({ error: 'lead_id or phone required' });
    }

    const db = getSupabase();

    const filter = lead_id
      ? db.from('leads').select('*').eq('id', lead_id).single()
      : db.from('leads').select('*').eq('phone', phone).single();

    const { data: lead, error: leadErr } = await filter;

    if (leadErr || !lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    const updates = {};
    if (name) updates.name = name.substring(0, 100);
    if (Object.keys(updates).length > 0) {
      await db.from('leads').update(updates).eq('id', lead.id);
    }

    const { data: existing } = await db
      .from('clients')
      .select('id')
      .eq('lead_id', lead.id)
      .single();

    if (existing) {
      await db
        .from('clients')
        .update({
          name: name || existing.name,
          email,
          age: age ? parseInt(age) : null,
          goal,
          injuries,
          diet_pref,
          schedule,
        })
        .eq('id', existing.id);

      return res.status(200).json({ updated: true, client_id: existing.id });
    }

    const { data: client, error: clientErr } = await db
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
        program: lead.program_interest,
        status: 'active',
      })
      .select()
      .single();

    if (clientErr) {
      console.error('Client insert error:', clientErr.message);
      return res.status(500).json({ error: 'Failed to create client record' });
    }

    return res.status(200).json({ created: true, client_id: client.id });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
