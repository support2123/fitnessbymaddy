const { getSupabase } = require('../lib/supabase');
const { needsEscalation, escalate } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const db = getSupabase();

  try {
    const {
      lead_id, name, email, age, gender, goal, injuries,
      medical_conditions, diet_preference, workout_experience,
      available_equipment, schedule, phone
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

    const medicalText = [injuries, medical_conditions].filter(Boolean).join(' ');
    if (needsEscalation(medicalText)) {
      await escalate(lead.phone, 'Medical flag in intake form', medicalText.slice(0, 300));
    }

    await db.from('leads').update({
      name: name || lead.name,
      status: lead.status === 'new' ? 'qualified' : lead.status
    }).eq('id', lead.id);

    const { data: intake, error } = await db.from('intake_forms').insert({
      lead_id: lead.id,
      name,
      email,
      age: parseInt(age) || null,
      gender,
      goal,
      injuries,
      medical_conditions,
      diet_preference,
      workout_experience,
      available_equipment,
      schedule,
      submitted_at: new Date().toISOString()
    }).select().single();

    if (error) throw error;

    return res.status(200).json({ success: true, intake_id: intake.id });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Failed to save intake' });
  }
};
