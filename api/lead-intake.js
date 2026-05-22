const { getClient } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const db = getClient();

  try {
    const {
      lead_id, name, email, age, gender, height, weight,
      goal, injuries, diet_pref, workout_schedule,
      medical_conditions, experience_level
    } = req.body;

    if (!lead_id) {
      return res.status(400).json({ error: 'Missing lead_id' });
    }

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single();

    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    if (name) {
      await db.from('leads').update({ name }).eq('id', lead_id);
    }

    const intakeData = {
      age: parseInt(age) || null,
      gender,
      height,
      weight: parseFloat(weight) || null,
      goal,
      injuries: injuries || 'None',
      diet_pref: diet_pref || 'No preference',
      workout_schedule: workout_schedule || 'Flexible',
      medical_conditions: medical_conditions || 'None',
      experience_level: experience_level || 'Beginner',
      email,
      submitted_at: new Date().toISOString()
    };

    await db.from('leads').update({
      name: name || lead.name,
      intake_data: intakeData
    }).eq('id', lead_id);

    return res.status(200).json({ ok: true, message: 'Intake form submitted' });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Failed to process intake' });
  }
};
