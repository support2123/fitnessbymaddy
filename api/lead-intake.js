const { getSupabase } = require('./lib/supabase');
const { needsEscalation, escalate } = require('./lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const db = getSupabase();
  const {
    lead_id, name, email, age, gender, goal, injuries,
    diet_preference, schedule, medical_conditions, experience_level
  } = req.body;

  if (!lead_id) return res.status(400).json({ error: 'lead_id required' });

  const { data: lead } = await db
    .from('leads')
    .select('*')
    .eq('id', lead_id)
    .single();

  if (!lead) return res.status(404).json({ error: 'Lead not found' });

  const intakeData = {
    name: name || lead.name,
    email,
    age: parseInt(age) || null,
    gender,
    goal,
    injuries: injuries || '',
    diet_preference,
    schedule,
    medical_conditions: medical_conditions || '',
    experience_level
  };

  await db.from('leads').update({
    name: intakeData.name,
    intake_data: intakeData
  }).eq('id', lead_id);

  if (injuries || medical_conditions) {
    const combined = `${injuries} ${medical_conditions}`.toLowerCase();
    if (needsEscalation(combined)) {
      await escalate(lead.phone, 'Medical condition in intake form', combined.slice(0, 120));
    }
  }

  return res.status(200).json({ success: true, message: 'Intake form saved' });
};
