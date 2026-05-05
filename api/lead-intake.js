const { supabase } = require('./lib/supabase');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      lead_id, name, email, age, gender, goal, injuries,
      diet_preference, workout_days, equipment_access,
      current_weight, target_weight, medical_conditions,
      daily_schedule, motivation
    } = req.body;

    if (!lead_id) {
      return res.status(400).json({ error: 'Missing lead_id' });
    }

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single();

    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    await supabase
      .from('leads')
      .update({
        name: name || lead.name,
        status: 'qualified',
        program_interest: lead.program_interest || goal
      })
      .eq('id', lead_id);

    const { error } = await supabase
      .from('lead_intake')
      .upsert({
        lead_id,
        name,
        email,
        age: parseInt(age) || null,
        gender,
        goal,
        injuries,
        diet_preference,
        workout_days: parseInt(workout_days) || null,
        equipment_access,
        current_weight: parseFloat(current_weight) || null,
        target_weight: parseFloat(target_weight) || null,
        medical_conditions,
        daily_schedule,
        motivation,
        submitted_at: new Date().toISOString()
      }, { onConflict: 'lead_id' });

    if (error) {
      console.error('Intake save error:', error.message);
      return res.status(500).json({ error: 'Failed to save' });
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
