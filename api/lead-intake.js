const { supabase } = require('../lib/supabase');
const { needsEscalation, escalateToMaddy } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      lead_id, phone, name, email, age, gender, height,
      current_weight, goal_weight, primary_goal, injuries,
      medical_conditions, diet_preference, meals_per_day,
      workout_experience, available_equipment, days_per_week,
      preferred_time
    } = req.body;

    if (!name || !email) {
      return res.status(400).json({ error: 'Name and email are required' });
    }

    // Check for medical escalation triggers
    const medicalText = [injuries, medical_conditions].filter(Boolean).join(' ');
    if (needsEscalation(medicalText)) {
      await escalateToMaddy('Medical condition flagged in intake form', {
        name, phone, details: medicalText
      });
    }

    // Save intake submission
    const { data, error } = await supabase.from('intake_submissions').insert({
      lead_id: lead_id || null,
      phone: phone || null,
      name,
      email,
      age: age ? parseInt(age) : null,
      gender,
      height,
      current_weight,
      goal_weight,
      primary_goal,
      injuries: injuries || null,
      medical_conditions: medical_conditions || null,
      diet_preference,
      meals_per_day: meals_per_day ? parseInt(meals_per_day) : null,
      workout_experience,
      available_equipment,
      days_per_week: days_per_week ? parseInt(days_per_week) : null,
      preferred_time
    }).select().single();

    if (error) throw error;

    // Update lead record if lead_id provided
    if (lead_id) {
      await supabase.from('leads').update({
        name,
        last_msg_at: new Date().toISOString()
      }).eq('id', lead_id);
    }

    return res.status(200).json({ ok: true, id: data.id });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Failed to save intake form' });
  }
};
