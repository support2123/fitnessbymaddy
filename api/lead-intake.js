const { getSupabase } = require('./lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      lead_id, name, email, age, gender, height, weight,
      goal, injuries, medical_conditions, diet_preference,
      workout_experience, available_days, equipment,
      wake_time, sleep_time, stress_level, water_intake
    } = req.body;

    if (!lead_id || !name || !email) {
      return res.status(400).json({ error: 'lead_id, name, and email are required' });
    }

    const db = getSupabase();

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single();

    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    await db.from('leads').update({
      name,
      status: 'qualified'
    }).eq('id', lead_id);

    await db.from('intake_data').upsert({
      lead_id,
      name,
      email,
      age: parseInt(age) || null,
      gender,
      height,
      weight: parseFloat(weight) || null,
      goal,
      injuries: injuries || null,
      medical_conditions: medical_conditions || null,
      diet_preference,
      workout_experience,
      available_days: parseInt(available_days) || null,
      equipment: equipment || null,
      wake_time,
      sleep_time,
      stress_level: parseInt(stress_level) || null,
      water_intake,
      submitted_at: new Date().toISOString()
    }, { onConflict: 'lead_id' });

    return res.status(200).json({ success: true, message: 'Intake form submitted' });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
