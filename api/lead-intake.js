const { getSupabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const supabase = getSupabase();
  const {
    lead_id, name, email, age, gender, goal, injuries,
    diet_preference, schedule, current_activity, medical_conditions
  } = req.body;

  if (!lead_id) return res.status(400).json({ error: 'Missing lead_id' });

  const { data: lead } = await supabase
    .from('leads')
    .select('*')
    .eq('id', lead_id)
    .single();

  if (!lead) return res.status(404).json({ error: 'Lead not found' });

  // Update lead with intake data
  await supabase.from('leads').update({
    name: name || lead.name,
    status: 'qualified'
  }).eq('id', lead_id);

  // Store intake data as client profile (pre-conversion)
  await supabase.from('intake_profiles').upsert({
    lead_id,
    name,
    email,
    age: parseInt(age) || null,
    gender,
    goal,
    injuries: injuries || null,
    diet_preference,
    schedule,
    current_activity,
    medical_conditions: medical_conditions || null,
    submitted_at: new Date().toISOString()
  }, { onConflict: 'lead_id' });

  return res.status(200).json({ success: true, message: 'Intake submitted' });
};
