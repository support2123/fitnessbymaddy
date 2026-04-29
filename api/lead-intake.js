const { getSupabase } = require('./_lib/supabase');
const { needsEscalation, createEscalation } = require('./_lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const supabase = getSupabase();
  const data = req.body;

  if (!data.name || !data.phone) {
    return res.status(400).json({ error: 'Name and phone are required' });
  }

  // Check for medical escalation triggers
  const combinedText = [
    data.injuries,
    data.medical_conditions,
    data.goal
  ].filter(Boolean).join(' ');

  const escalationReason = needsEscalation(combinedText);

  const { error } = await supabase.from('intake_forms').insert({
    lead_id: data.lead_id || null,
    name: data.name,
    email: data.email || null,
    phone: data.phone,
    age: data.age ? parseInt(data.age) : null,
    gender: data.gender || null,
    height_cm: data.height_cm ? parseFloat(data.height_cm) : null,
    weight_kg: data.weight_kg ? parseFloat(data.weight_kg) : null,
    goal: data.goal || null,
    injuries: data.injuries || null,
    medical_conditions: data.medical_conditions || null,
    diet_preference: data.diet_preference || null,
    meals_per_day: data.meals_per_day ? parseInt(data.meals_per_day) : null,
    workout_days_per_week: data.workout_days_per_week ? parseInt(data.workout_days_per_week) : null,
    gym_access: data.gym_access !== 'no',
    equipment: data.equipment || null,
    schedule_preference: data.schedule_preference || null
  });

  if (error) {
    console.error('Intake form insert error:', error.message);
    return res.status(500).json({ error: 'Failed to save form' });
  }

  // Update lead record if lead_id provided
  if (data.lead_id) {
    await supabase.from('leads')
      .update({ name: data.name })
      .eq('id', data.lead_id);
  }

  // Escalate if medical concerns detected
  if (escalationReason) {
    await createEscalation({
      phone: data.phone,
      reason: `Intake form: ${escalationReason}`,
      triggerMessage: combinedText
    });
  }

  return res.status(200).json({ success: true, message: 'Intake form submitted' });
};
