const { getSupabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const db = getSupabase();
  const {
    lead_id,
    name,
    age,
    gender,
    goal,
    injuries,
    diet_preference,
    schedule,
    experience_level,
    medical_conditions,
    current_weight,
    target_weight,
    phone
  } = req.body;

  if (!lead_id && !phone) {
    return res.status(400).json({ error: 'lead_id or phone required' });
  }

  const intakeData = {
    name, age, gender, goal, injuries, diet_preference,
    schedule, experience_level, medical_conditions,
    current_weight, target_weight,
    submitted_at: new Date().toISOString()
  };

  if (lead_id) {
    const { data: lead } = await db
      .from('leads')
      .select('phone')
      .eq('id', lead_id)
      .single();

    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    await db.from('leads').update({ name }).eq('id', lead_id);

    const { data: client } = await db
      .from('clients')
      .select('id')
      .eq('phone', lead.phone)
      .single();

    if (client) {
      await db.from('clients').update({ intake_data: intakeData, name }).eq('id', client.id);
    }
  } else if (phone) {
    const { data: client } = await db
      .from('clients')
      .select('id')
      .eq('phone', phone)
      .single();

    if (client) {
      await db.from('clients').update({ intake_data: intakeData, name }).eq('id', client.id);
    }
  }

  return res.status(200).json({ success: true });
};
