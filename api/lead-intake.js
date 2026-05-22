const { getSupabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      lead_id, name, phone, email, age, gender,
      goal, injuries, diet_preference, schedule,
      medical_conditions, current_fitness, experience_level
    } = req.body;

    if (!lead_id || !name || !phone) {
      return res.status(400).json({ error: 'Missing required fields: lead_id, name, phone' });
    }

    const db = getSupabase();

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
      last_msg_at: new Date().toISOString()
    }).eq('id', lead_id);

    const intakeData = {
      age: parseInt(age) || null,
      gender,
      goal,
      injuries: injuries || 'None',
      diet_preference: diet_preference || 'No preference',
      schedule: schedule || 'Flexible',
      medical_conditions: medical_conditions || 'None',
      current_fitness: current_fitness || 'Beginner',
      experience_level: experience_level || 'Beginner',
      email
    };

    await db.from('leads').update({
      first_msg: JSON.stringify(intakeData)
    }).eq('id', lead_id);

    return res.status(200).json({ ok: true, message: 'Intake form submitted successfully' });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
