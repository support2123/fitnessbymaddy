const { supabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const {
    lead_id, name, email, age, gender, goal, injuries,
    diet_preference, schedule, medical_conditions, experience_level,
  } = req.body;

  if (!lead_id) return res.status(400).json({ error: 'lead_id required' });

  const { data: lead } = await supabase
    .from('leads')
    .select('*')
    .eq('id', lead_id)
    .single();

  if (!lead) return res.status(404).json({ error: 'Lead not found' });

  await supabase
    .from('leads')
    .update({
      name: name || lead.name,
      status: lead.status === 'new' ? 'qualified' : lead.status,
      last_msg_at: new Date().toISOString(),
    })
    .eq('id', lead_id);

  await supabase.from('intake_responses').insert({
    lead_id,
    name,
    email,
    age: parseInt(age) || null,
    gender,
    goal,
    injuries: injuries || null,
    diet_preference: diet_preference || null,
    schedule: schedule || null,
    medical_conditions: medical_conditions || null,
    experience_level: experience_level || null,
    submitted_at: new Date().toISOString(),
  });

  return res.status(200).json({ ok: true, message: 'Intake form submitted successfully' });
};
