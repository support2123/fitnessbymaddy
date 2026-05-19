const { getSupabase } = require('./_lib/supabase');
const { sendTemplate, notifyMaddy } = require('./_lib/whatsapp');
const { checkEscalation } = require('./_lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      lead_id, name, email, phone, age, gender,
      height_cm, current_weight, goal_weight, goal,
      injuries, medical_conditions, diet_preference,
      meals_per_day, workout_days_per_week, equipment_access,
      wake_time, sleep_time
    } = req.body;

    if (!lead_id) return res.status(400).json({ error: 'lead_id required' });

    const sb = getSupabase();

    const medicalText = [injuries, medical_conditions].filter(Boolean).join(' ');
    const esc = checkEscalation(medicalText);
    if (esc.escalate) {
      await notifyMaddy(
        `⚠️ INTAKE ESCALATION\nLead: ${lead_id}\nReason: "${esc.reason}"\nInjuries: ${injuries || 'none'}\nMedical: ${medical_conditions || 'none'}`
      );
    }

    await sb.from('intake_forms').insert({
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
      equipment_access,
      wake_time,
      sleep_time
    });

    if (name || email) {
      const updates = {};
      if (name) updates.name = name;
      await sb.from('leads').update(updates).eq('id', lead_id);
    }

    if (phone) {
      await sendTemplate(phone, 'intake_received', [name || 'there']);
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
