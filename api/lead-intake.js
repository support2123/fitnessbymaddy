const { getSupabase } = require('./lib/supabase');
const { needsEscalation, escalateToMaddy } = require('./lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      lead_id, age, gender, height_cm, current_weight, goal_weight,
      goal, injuries, medical_conditions, diet_preference,
      training_experience, available_days, equipment_access
    } = req.body;

    if (!lead_id) return res.status(400).json({ error: 'Missing lead_id' });

    const db = getSupabase();

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single();

    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    const medicalText = [injuries, medical_conditions, goal].filter(Boolean).join(' ');
    if (needsEscalation(medicalText)) {
      await escalateToMaddy('Medical flag in intake form', {
        phone: lead.phone,
        name: lead.name,
        message: medicalText
      });
    }

    await db.from('intake_submissions').insert({
      lead_id,
      age: parseInt(age) || null,
      gender,
      height_cm: parseFloat(height_cm) || null,
      current_weight: parseFloat(current_weight) || null,
      goal_weight: parseFloat(goal_weight) || null,
      goal,
      injuries: injuries || null,
      medical_conditions: medical_conditions || null,
      diet_preference,
      training_experience,
      available_days: parseInt(available_days) || null,
      equipment_access
    });

    return res.json({ success: true, message: 'Intake form submitted' });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
