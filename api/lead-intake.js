const { getSupabase } = require('./lib/supabase');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const supabase = getSupabase();
  const {
    lead_id, name, email, age, gender, height, weight,
    goal, injuries, diet_preference, schedule,
    medical_conditions, experience_level
  } = req.body;

  if (!lead_id || !name || !email) {
    return res.status(400).json({ error: 'Missing required fields: lead_id, name, email' });
  }

  const { error: leadError } = await supabase
    .from('leads')
    .update({ name, status: 'qualified' })
    .eq('id', lead_id);

  if (leadError) {
    return res.status(500).json({ error: 'Failed to update lead' });
  }

  const { error: profileError } = await supabase
    .from('client_profiles')
    .upsert({
      lead_id,
      name,
      email,
      age: age || null,
      gender: gender || null,
      height: height || null,
      weight: weight || null,
      goal: goal || null,
      injuries: injuries || null,
      diet_preference: diet_preference || null,
      schedule: schedule || null,
      medical_conditions: medical_conditions || null,
      experience_level: experience_level || null,
      submitted_at: new Date().toISOString()
    }, { onConflict: 'lead_id' });

  if (profileError) {
    return res.status(500).json({ error: 'Failed to save profile' });
  }

  return res.status(200).json({ success: true, message: 'Intake form submitted' });
};
