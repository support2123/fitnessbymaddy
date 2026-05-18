const { getSupabase } = require('./lib/supabase');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const db = getSupabase();
  const {
    lead_id, name, email, age, gender, height, weight,
    goal, injuries, diet_preference, workout_days,
    schedule_preference, medical_conditions, current_fitness,
    photos
  } = req.body;

  if (!lead_id) {
    return res.status(400).json({ error: 'lead_id is required' });
  }

  try {
    const { data: lead, error: leadErr } = await db
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single();

    if (leadErr || !lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    await db.from('leads').update({ name: name || lead.name }).eq('id', lead_id);

    const intakeData = {
      lead_id,
      name,
      email,
      age: parseInt(age) || null,
      gender,
      height,
      weight: parseFloat(weight) || null,
      goal,
      injuries: injuries || '',
      diet_preference: diet_preference || '',
      workout_days: parseInt(workout_days) || null,
      schedule_preference: schedule_preference || '',
      medical_conditions: medical_conditions || '',
      current_fitness: current_fitness || '',
      photos: photos || [],
      submitted_at: new Date().toISOString()
    };

    const { error: metaErr } = await db
      .from('leads')
      .update({
        name: name || lead.name,
        first_msg: JSON.stringify(intakeData)
      })
      .eq('id', lead_id);

    if (metaErr) {
      console.error('Intake save error:', metaErr.message);
      return res.status(500).json({ error: 'Failed to save intake data' });
    }

    return res.status(200).json({ ok: true, message: 'Intake form submitted successfully' });
  } catch (err) {
    console.error('Lead intake error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
