const { getSupabase } = require('./_utils/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const db = getSupabase();

  try {
    const {
      lead_id, name, email, phone, age, gender,
      goal, injuries, diet_preference, schedule,
      medical_conditions, current_weight, target_weight,
      experience_level, equipment_access
    } = req.body;

    if (!lead_id && !phone) {
      return res.status(400).json({ error: 'lead_id or phone required' });
    }

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

    const updates = {};
    if (name) updates.name = name;
    if (lead.status === 'new') updates.status = 'qualified';

    if (Object.keys(updates).length > 0) {
      await db.from('leads').update(updates).eq('id', lead.id);
    }

    const intakeData = {
      age, gender, goal, injuries, diet_preference, schedule,
      medical_conditions, current_weight, target_weight,
      experience_level, equipment_access
    };

    const { data: existing } = await db
      .from('clients')
      .select('id')
      .eq('lead_id', lead.id)
      .limit(1)
      .single();

    if (existing) {
      return res.json({ success: true, message: 'Intake already submitted', client_id: existing.id });
    }

    // Store intake as metadata in the lead record for now;
    // full client record created on payment via exly-webhook
    await db.from('leads').update({
      name: name || lead.name,
      program_interest: goal || lead.program_interest
    }).eq('id', lead.id);

    return res.json({
      success: true,
      message: 'Intake received',
      lead_id: lead.id
    });

  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
