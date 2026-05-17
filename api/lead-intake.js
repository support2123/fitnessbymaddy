const { getSupabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

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

    if (!lead_id && !phone) {
      return res.status(400).json({ error: 'lead_id or phone required' });
    }

    const db = getSupabase();

    const lookup = lead_id
      ? { column: 'id', value: lead_id }
      : { column: 'phone', value: phone };

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq(lookup.column, lookup.value)
      .limit(1)
      .single();

    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    await db
      .from('leads')
      .update({
        name: name || lead.name,
        program_interest: goal || lead.program_interest,
      })
      .eq('id', lead.id);

    const intakeData = {
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
      email,
    };

    const { data: existingClient } = await db
      .from('clients')
      .select('id')
      .eq('lead_id', lead.id)
      .limit(1)
      .single();

    if (existingClient) {
      await db
        .from('clients')
        .update({ name: name || undefined, email: email || undefined })
        .eq('id', existingClient.id);
    }

    return res.status(200).json({
      success: true,
      lead_id: lead.id,
      message: 'Intake form received. We will be in touch!',
    });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
