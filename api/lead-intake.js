const { getSupabase } = require('./_lib/supabase');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const db = getSupabase();
  const {
    lead_id, name, email, age, gender, goal, injuries,
    diet_preference, training_days, equipment, current_weight,
    target_weight, medical_conditions, wake_time, sleep_time
  } = req.body;

  if (!lead_id) {
    return res.status(400).json({ error: 'Missing lead_id' });
  }

  const { error } = await db.from('leads')
    .update({
      name,
      status: 'qualified'
    })
    .eq('id', lead_id);

  if (error) {
    return res.status(500).json({ error: 'Failed to update lead' });
  }

  const { error: metaError } = await db.from('lead_intake_data')
    .upsert({
      lead_id,
      name,
      email,
      age: parseInt(age) || null,
      gender,
      goal,
      injuries,
      diet_preference,
      training_days: parseInt(training_days) || null,
      equipment,
      current_weight: parseFloat(current_weight) || null,
      target_weight: parseFloat(target_weight) || null,
      medical_conditions,
      wake_time,
      sleep_time
    }, { onConflict: 'lead_id' });

  if (metaError) {
    console.error('Intake save error:', metaError.message);
  }

  return res.status(200).json({ success: true, message: 'Intake form received' });
};
