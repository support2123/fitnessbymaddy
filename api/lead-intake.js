const { supabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const {
      lead_id, name, email, phone, age, gender,
      goal, current_activity, injuries, medical_conditions,
      diet_preference, meals_per_day, allergies,
      workout_days, workout_time, equipment_access,
      sleep_hours, stress_level, motivation, notes
    } = req.body;

    if (!lead_id) return res.status(400).json({ error: 'Missing lead_id' });

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single();

    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    const updates = {};
    if (name) updates.name = name;
    if (lead.status === 'new') updates.status = 'qualified';

    if (Object.keys(updates).length > 0) {
      await supabase.from('leads').update(updates).eq('id', lead_id);
    }

    const intakeData = {
      age, gender, goal, current_activity, injuries,
      medical_conditions, diet_preference, meals_per_day,
      allergies, workout_days, workout_time, equipment_access,
      sleep_hours, stress_level, motivation, notes
    };

    const { error } = await supabase
      .from('leads')
      .update({
        name: name || lead.name,
        first_msg: JSON.stringify(intakeData)
      })
      .eq('id', lead_id);

    if (error) {
      console.error('Intake save error:', error.message);
      return res.status(500).json({ error: 'Save failed' });
    }

    return res.json({ ok: true, lead_id });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
