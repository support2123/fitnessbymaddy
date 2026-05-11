const { getClient } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const sb = getClient();
  const {
    lead_id, name, email, phone, age, gender,
    goal, injuries, diet_preference, schedule,
    current_weight, height, medical_conditions,
    experience_level, equipment_access
  } = req.body;

  if (!lead_id) return res.status(400).json({ error: 'lead_id is required' });

  const { data: lead } = await sb
    .from('leads')
    .select('*')
    .eq('id', lead_id)
    .single();

  if (!lead) return res.status(404).json({ error: 'Lead not found' });

  if (name) {
    await sb.from('leads').update({ name }).eq('id', lead_id);
  }

  const intakeData = {
    age, gender, goal, injuries, diet_preference, schedule,
    current_weight, height, medical_conditions,
    experience_level, equipment_access
  };

  const { data: existingClient } = await sb
    .from('clients')
    .select('id')
    .eq('lead_id', lead_id)
    .single();

  if (existingClient) {
    await sb.from('clients').update({
      name: name || lead.name,
      email: email || undefined,
      intake_data: intakeData
    }).eq('id', existingClient.id);
  }

  return res.status(200).json({
    ok: true,
    message: 'Intake form submitted successfully',
    lead_id
  });
};
