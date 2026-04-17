const { getSupabase } = require('./lib/supabase');

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
      phone,
      age,
      gender,
      goal,
      injuries,
      diet_preference,
      schedule,
      experience_level,
      current_weight,
      target_weight,
      medical_conditions,
    } = req.body;

    if (!lead_id || !name || !email) {
      return res.status(400).json({ error: 'lead_id, name, and email are required' });
    }

    const db = getSupabase();

    const { data: lead, error: leadErr } = await db
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single();

    if (leadErr || !lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    await db.from('leads').update({
      name,
      status: lead.status === 'new' ? 'qualified' : lead.status,
    }).eq('id', lead_id);

    const { data: existing } = await db
      .from('clients')
      .select('id')
      .eq('lead_id', lead_id)
      .single();

    const clientData = {
      lead_id,
      phone: phone || lead.phone,
      name,
      email,
      intake_data: {
        age,
        gender,
        goal,
        injuries,
        diet_preference,
        schedule,
        experience_level,
        current_weight,
        target_weight,
        medical_conditions,
      },
    };

    if (existing) {
      await db.from('clients').update(clientData).eq('id', existing.id);
    } else {
      clientData.status = 'active';
      clientData.program = lead.program_interest || null;
      await db.from('clients').insert(clientData);
    }

    return res.status(200).json({ ok: true, message: 'Intake saved successfully' });
  } catch (err) {
    console.error('[lead-intake] Error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
