const { getSupabase } = require('./lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const db = getSupabase();
  const {
    lead_id,
    name,
    email,
    age,
    gender,
    goal,
    injuries,
    diet_preference,
    schedule,
    medical_conditions,
    current_activity_level
  } = req.body;

  if (!lead_id) return res.status(400).json({ error: 'Missing lead_id' });

  const { data: lead, error: leadErr } = await db
    .from('leads')
    .select('*')
    .eq('id', lead_id)
    .single();

  if (leadErr || !lead) {
    return res.status(404).json({ error: 'Lead not found' });
  }

  const { error } = await db.from('leads').update({
    name: name || lead.name,
    program_interest: goal || lead.program_interest
  }).eq('id', lead_id);

  if (error) {
    return res.status(500).json({ error: 'Failed to update lead' });
  }

  const intakeData = {
    age, gender, goal, injuries, diet_preference,
    schedule, medical_conditions, current_activity_level
  };

  const { error: metaErr } = await db.from('leads').update({
    first_msg: JSON.stringify(intakeData)
  }).eq('id', lead_id);

  if (metaErr) {
    console.error('Failed to store intake metadata:', metaErr);
  }

  res.status(200).json({ success: true, message: 'Intake form submitted' });
};
