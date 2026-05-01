const { getSupabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      lead_id, name, email, age, gender, height, weight,
      goal, injuries, diet_preference, schedule,
      medical_conditions, medications
    } = req.body;

    if (!lead_id || !name || !email) {
      return res.status(400).json({ error: 'lead_id, name, and email are required' });
    }

    const db = getSupabase();

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single();

    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    await db.from('leads').update({ name }).eq('id', lead_id);

    const intakeData = {
      lead_id,
      name,
      email,
      age: parseInt(age) || null,
      gender,
      height,
      weight: parseFloat(weight) || null,
      goal,
      injuries: injuries || null,
      diet_preference: diet_preference || null,
      schedule: schedule || null,
      medical_conditions: medical_conditions || null,
      medications: medications || null,
      submitted_at: new Date().toISOString()
    };

    const { error: storageErr } = await db.storage
      .from('client-data')
      .upload(
        `intakes/${lead_id}.json`,
        JSON.stringify(intakeData, null, 2),
        { contentType: 'application/json', upsert: true }
      );

    if (storageErr) console.error('Storage error:', storageErr.message);

    return res.status(200).json({ success: true, message: 'Intake form submitted' });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
