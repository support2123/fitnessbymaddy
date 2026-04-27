const { getSupabase } = require('../lib/supabase');
const { needsEscalation, createEscalation } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const sb = getSupabase();

  try {
    const {
      lead_id, name, email, phone, age, gender,
      goal, injuries, medical_conditions,
      diet_preference, workout_schedule, experience_level,
    } = req.body;

    if (!name || !email) {
      return res.status(400).json({ error: 'Name and email are required' });
    }

    // Save intake form
    const { data: intake, error } = await sb
      .from('intake_forms')
      .insert({
        lead_id: lead_id || null,
        name, email, phone, age: age ? parseInt(age) : null,
        gender, goal, injuries, medical_conditions,
        diet_preference, workout_schedule, experience_level,
      })
      .select()
      .single();

    if (error) throw error;

    // Update lead record if lead_id provided
    if (lead_id) {
      await sb
        .from('leads')
        .update({ name, status: 'qualified' })
        .eq('id', lead_id);
    }

    // Check for medical escalation
    const medCheck = [injuries, medical_conditions, goal].filter(Boolean).join(' ');
    const escalationKeyword = needsEscalation(medCheck);
    if (escalationKeyword) {
      await createEscalation(phone || 'form_submission', escalationKeyword, medCheck, null);
    }

    return res.status(200).json({ ok: true, id: intake.id });
  } catch (err) {
    console.error(`[INTAKE] Error: ${err.message}`);
    return res.status(500).json({ error: 'Failed to save intake form' });
  }
};
