const { supabase } = require('../lib/supabase');
const { needsEscalation, escalateToMaddy, getEscalationReason } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      lead_id, age, gender, goal, injuries, medical_conditions,
      diet_preference, workout_days, workout_location,
      wake_time, sleep_time, current_weight, target_weight,
    } = req.body;

    if (!lead_id) return res.status(400).json({ error: 'Missing lead_id' });

    const { data: lead } = await supabase
      .from('leads').select('*').eq('id', lead_id).single();

    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    // Check for medical escalation triggers
    const freeText = [injuries, medical_conditions, goal].filter(Boolean).join(' ');
    if (needsEscalation(freeText)) {
      await escalateToMaddy({
        phone: lead.phone,
        reason: getEscalationReason(freeText),
        messageBody: `Intake form flagged: ${freeText}`,
      });
    }

    const { data: submission, error } = await supabase
      .from('intake_submissions').insert({
        lead_id,
        age: parseInt(age) || null,
        gender,
        goal,
        injuries,
        medical_conditions,
        diet_preference,
        workout_days: parseInt(workout_days) || null,
        workout_location,
        wake_time,
        sleep_time,
        current_weight: parseFloat(current_weight) || null,
        target_weight: parseFloat(target_weight) || null,
      }).select().single();

    if (error) throw error;

    return res.status(200).json({ ok: true, id: submission.id });

  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
