const { supabase } = require('../lib/supabase');
const { detectEscalation, handleEscalation } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      lead_id,
      name, age, gender, height_cm, weight_kg,
      goal, injuries, medical_conditions,
      diet_preference, workout_days_per_week,
      equipment_access, wake_time, sleep_time
    } = req.body;

    if (!lead_id) return res.status(400).json({ error: 'Missing lead_id' });

    // Validate lead exists
    const { data: lead } = await supabase
      .from('leads')
      .select('id, phone')
      .eq('id', lead_id)
      .single();

    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    // Check for medical escalation triggers
    const medicalText = [injuries, medical_conditions].filter(Boolean).join(' ');
    const escalationTrigger = detectEscalation(medicalText);
    if (escalationTrigger) {
      await handleEscalation(lead.phone, `Intake form: ${medicalText}`, escalationTrigger);
    }

    // Update lead name
    if (name) {
      await supabase
        .from('leads')
        .update({ name })
        .eq('id', lead_id);
    }

    // Save intake submission
    const { data: submission, error } = await supabase
      .from('intake_submissions')
      .insert({
        lead_id,
        age: age ? parseInt(age) : null,
        gender,
        height_cm: height_cm ? parseFloat(height_cm) : null,
        weight_kg: weight_kg ? parseFloat(weight_kg) : null,
        goal,
        injuries: injuries || null,
        medical_conditions: medical_conditions || null,
        diet_preference,
        workout_days_per_week: workout_days_per_week ? parseInt(workout_days_per_week) : null,
        equipment_access,
        wake_time,
        sleep_time
      })
      .select('id')
      .single();

    if (error) throw error;

    return res.status(200).json({ success: true, submission_id: submission.id });

  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Failed to save intake form' });
  }
};
