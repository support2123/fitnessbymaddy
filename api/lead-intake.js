const { supabase } = require('../lib/supabase');
const { shouldEscalate, createEscalation } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const {
      lead_id, name, age, gender, height_cm, weight_kg,
      goal, injuries, medical_conditions, diet_preference,
      workout_days, equipment_access, wake_time, sleep_time,
      stress_level
    } = req.body;

    if (!lead_id || !name) {
      return res.status(400).json({ error: 'lead_id and name required' });
    }

    const medicalText = [injuries, medical_conditions].filter(Boolean).join(' ');
    const escalationKeyword = shouldEscalate(medicalText);
    if (escalationKeyword) {
      const { data: lead } = await supabase
        .from('leads')
        .select('phone')
        .eq('id', lead_id)
        .single();

      if (lead) {
        await createEscalation(
          lead.phone,
          `Intake form — "${escalationKeyword}" reported`,
          medicalText
        );
      }
    }

    const { error } = await supabase.from('intake_forms').insert({
      lead_id,
      name,
      age: age || null,
      gender: gender || null,
      height_cm: height_cm || null,
      weight_kg: weight_kg || null,
      goal: goal || null,
      injuries: injuries || null,
      medical_conditions: medical_conditions || null,
      diet_preference: diet_preference || null,
      workout_days: workout_days || null,
      equipment_access: equipment_access || null,
      wake_time: wake_time || null,
      sleep_time: sleep_time || null,
      stress_level: stress_level || null
    });

    if (error) throw error;

    await supabase
      .from('leads')
      .update({ name })
      .eq('id', lead_id);

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Failed to save intake' });
  }
};
