const { getSupabase } = require('./lib/supabase');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const db = getSupabase();
  const {
    lead_id, name, email, age, gender, goal, injuries,
    diet_preference, schedule, medical_conditions, current_weight,
    target_weight, experience_level
  } = req.body;

  if (!lead_id || !name || !email) {
    return res.status(400).json({ error: 'lead_id, name, and email are required' });
  }

  const { data: lead } = await db
    .from('leads')
    .select('*')
    .eq('id', lead_id)
    .single();

  if (!lead) {
    return res.status(404).json({ error: 'Lead not found' });
  }

  await db.from('leads').update({
    name,
    status: 'qualified'
  }).eq('id', lead_id);

  const { error } = await db.from('intake_forms').insert({
    lead_id,
    name,
    email,
    age: age || null,
    gender: gender || null,
    goal: goal || null,
    injuries: injuries || null,
    diet_preference: diet_preference || null,
    schedule: schedule || null,
    medical_conditions: medical_conditions || null,
    current_weight: current_weight || null,
    target_weight: target_weight || null,
    experience_level: experience_level || null,
    submitted_at: new Date().toISOString()
  });

  if (error) {
    return res.status(500).json({ error: 'Failed to save intake form' });
  }

  if (medical_conditions && medical_conditions.trim().length > 0) {
    const { escalateToMaddy } = require('./lib/escalation');
    await escalateToMaddy(
      'Medical condition on intake form',
      `Lead: ${name} | Conditions: ${medical_conditions}`
    );
  }

  return res.status(200).json({ success: true, message: 'Intake form submitted' });
};
