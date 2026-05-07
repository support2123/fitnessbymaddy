const { getSupabase } = require('./_lib/supabase');
const { needsEscalation, escalateToMaddy } = require('./_lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      lead_id, name, email, phone, age, gender, height, weight,
      goal, injuries, medical_conditions, diet_preference,
      training_experience, days_per_week, equipment_access,
      wake_time, sleep_time, supplements, notes
    } = req.body;

    if (!lead_id) {
      return res.status(400).json({ error: 'lead_id is required' });
    }

    const db = getSupabase();

    const { data: lead, error: leadError } = await db
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single();

    if (leadError || !lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    const updates = {};
    if (name) updates.name = name;
    if (lead.status === 'new') updates.status = 'qualified';

    await db.from('leads').update(updates).eq('id', lead_id);

    const medicalText = [injuries, medical_conditions, notes].filter(Boolean).join(' ');
    if (needsEscalation(medicalText)) {
      await escalateToMaddy('Medical/injury flag in intake form', {
        phone: lead.phone,
        name: name || lead.name,
        message: medicalText
      });
    }

    const intakeData = {
      age, gender, height, weight, goal, injuries, medical_conditions,
      diet_preference, training_experience, days_per_week,
      equipment_access, wake_time, sleep_time, supplements, notes,
      email
    };

    const { error: metaError } = await db
      .from('leads')
      .update({
        name: name || lead.name,
        program_interest: goal || lead.program_interest
      })
      .eq('id', lead_id);

    if (metaError) {
      console.error('Lead update error:', metaError.message);
    }

    return res.status(200).json({
      ok: true,
      message: 'Intake form submitted successfully',
      lead_id
    });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
