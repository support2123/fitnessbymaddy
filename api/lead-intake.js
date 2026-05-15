const { supabase } = require('../lib/supabase');
const { cors } = require('../lib/helpers');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const {
    lead_id, name, email, phone, age, gender, height, weight,
    goal, injuries, medical_conditions, diet_preference,
    training_experience, gym_access, schedule, current_supplements,
  } = req.body;

  if (!lead_id) return res.status(400).json({ error: 'Missing lead_id' });

  const lead = await supabase.from('leads').select('*').eq('id', lead_id).single();
  if (!lead.data) return res.status(404).json({ error: 'Lead not found' });

  await supabase.from('leads').update({
    name: name || lead.data.name,
  }).eq('id', lead_id);

  const intakeData = {
    age, gender, height, weight, goal, injuries, medical_conditions,
    diet_preference, training_experience, gym_access, schedule,
    current_supplements, email,
  };

  const { error } = await supabase.from('leads').update({
    name: name || lead.data.name,
    intake_data: intakeData,
  }).eq('id', lead_id);

  if (error) return res.status(500).json({ error: error.message });

  return res.json({ success: true, message: 'Intake form submitted successfully' });
};
