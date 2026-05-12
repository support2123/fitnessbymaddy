const { getSupabase } = require('../lib/supabase');
const { shouldEscalate, createEscalation } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const {
      lead_id, age, gender, height_cm, weight_kg, goal,
      injuries, medical_conditions, diet_preference,
      training_experience, available_days, equipment_access,
    } = req.body || {};

    if (!lead_id) return res.status(400).json({ error: 'lead_id required' });

    const sb = getSupabase();

    const { data: lead } = await sb
      .from('leads')
      .select('id, phone')
      .eq('id', lead_id)
      .single();

    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    const medicalText = [injuries, medical_conditions].filter(Boolean).join('. ');
    const escalationKeyword = shouldEscalate(medicalText);
    if (escalationKeyword) {
      await createEscalation('lead', lead.id, lead.phone, `Intake form: ${escalationKeyword}`, medicalText);
    }

    const { data: intake, error } = await sb
      .from('intake_forms')
      .insert({
        lead_id,
        age: age ? parseInt(age, 10) : null,
        gender: gender || null,
        height_cm: height_cm ? parseFloat(height_cm) : null,
        weight_kg: weight_kg ? parseFloat(weight_kg) : null,
        goal: goal || null,
        injuries: injuries || null,
        medical_conditions: medical_conditions || null,
        diet_preference: diet_preference || null,
        training_experience: training_experience || null,
        available_days: available_days ? parseInt(available_days, 10) : 5,
        equipment_access: equipment_access || null,
      })
      .select()
      .single();

    if (error) throw error;

    return res.status(200).json({ ok: true, id: intake.id });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
