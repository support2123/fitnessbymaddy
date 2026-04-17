const { getClient } = require('../lib/supabase');
const { needsEscalation, escalateToMaddy } = require('../lib/escalation');
const { maskPhone } = require('../lib/market');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      lead_id, phone, name, email, age, gender,
      height_cm, current_weight, goal_weight, goal,
      injuries, medical_conditions, diet_preference,
      meals_per_day, workout_experience, available_days,
      gym_or_home, wake_time, sleep_time,
    } = req.body;

    if (!lead_id && !phone) {
      return res.status(400).json({ error: 'lead_id or phone required' });
    }

    const db = getClient();

    const needsReview = needsEscalation(injuries) ||
      needsEscalation(medical_conditions) ||
      needsEscalation(goal);

    if (needsReview) {
      const targetPhone = phone || 'unknown';
      await escalateToMaddy(
        'Medical/injury flag in intake form',
        targetPhone,
        `Injuries: ${injuries || 'none'} | Medical: ${medical_conditions || 'none'}`
      );
      await db.from('escalations').insert({
        phone: targetPhone,
        reason: 'Intake form contains medical/injury flags',
        context: `Injuries: ${injuries || 'none'}, Medical: ${medical_conditions || 'none'}`,
      });
    }

    const { data, error } = await db.from('intake_submissions').insert({
      lead_id: lead_id || null,
      phone, name, email,
      age: age ? parseInt(age) : null,
      gender,
      height_cm: height_cm ? parseFloat(height_cm) : null,
      current_weight: current_weight ? parseFloat(current_weight) : null,
      goal_weight: goal_weight ? parseFloat(goal_weight) : null,
      goal, injuries, medical_conditions, diet_preference,
      meals_per_day: meals_per_day ? parseInt(meals_per_day) : null,
      workout_experience,
      available_days: available_days || [],
      gym_or_home, wake_time, sleep_time,
    }).select().single();

    if (error) throw error;

    if (lead_id) {
      await db.from('leads').update({
        name: name || undefined,
        last_msg_at: new Date().toISOString(),
      }).eq('id', lead_id);
    }

    return res.status(200).json({ success: true, id: data.id });
  } catch (err) {
    console.error('lead-intake error:', err.message);
    return res.status(500).json({ error: 'Failed to save intake' });
  }
};
