const { supabase } = require('../lib/supabase');
const { needsEscalation, buildEscalationAlert } = require('../lib/escalation');
const { notifyMaddy } = require('../lib/whatsapp');
const { maskPhone } = require('../lib/pii');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      lead_id, age, gender, height_cm, current_weight, goal_weight,
      goal, injuries, medical_conditions, diet_preference,
      meals_per_day, workout_days_per_week, workout_location,
      equipment_available, sleep_hours, stress_level
    } = req.body;

    if (!lead_id) return res.status(400).json({ error: 'lead_id required' });

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single();

    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    // Check for medical escalation triggers
    const combinedText = [injuries, medical_conditions, goal].filter(Boolean).join(' ');
    const esc = needsEscalation(combinedText);
    if (esc.escalate) {
      await notifyMaddy(
        buildEscalationAlert(maskPhone(lead.phone), `Intake form: ${combinedText}`, esc.reasons)
      );
    }

    const { data: submission, error } = await supabase
      .from('intake_submissions')
      .insert({
        lead_id,
        age: age ? parseInt(age) : null,
        gender,
        height_cm: height_cm ? parseFloat(height_cm) : null,
        current_weight: current_weight ? parseFloat(current_weight) : null,
        goal_weight: goal_weight ? parseFloat(goal_weight) : null,
        goal,
        injuries: injuries || null,
        medical_conditions: medical_conditions || null,
        diet_preference,
        meals_per_day: meals_per_day ? parseInt(meals_per_day) : null,
        workout_days_per_week: workout_days_per_week ? parseInt(workout_days_per_week) : null,
        workout_location,
        equipment_available,
        sleep_hours: sleep_hours ? parseFloat(sleep_hours) : null,
        stress_level: stress_level ? parseInt(stress_level) : null
      })
      .select()
      .single();

    if (error) {
      console.error('Intake insert error:', error.message);
      return res.status(500).json({ error: 'Failed to save intake' });
    }

    return res.status(200).json({ success: true, id: submission.id });
  } catch (err) {
    console.error('Lead intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
