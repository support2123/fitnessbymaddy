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

    const query = lead_id
      ? db.from('leads').select('*').eq('id', lead_id).single()
      : db.from('leads').select('*').eq('phone', phone).single();

    const { data: lead, error: leadErr } = await query;

    if (leadErr || !lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    if (name) {
      await db.from('leads').update({ name }).eq('id', lead.id);
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

      return res.json({ ok: true, action: 'updated', client_id: existingClient.id });
    }

    return res.json({
      ok: true,
      action: 'intake_saved',
      lead_id: lead.id,
      message: 'Intake received. Client record will be created after payment.',
    });

  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
