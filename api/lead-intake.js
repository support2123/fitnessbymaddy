const { getSupabase } = require('./_lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      lead_id, name, email, age, gender, goal, injuries,
      diet_pref, schedule, experience, current_weight,
      target_weight, height, medical_conditions,
    } = req.body;

    if (!lead_id || !name || !email) {
      return res.status(400).json({ error: 'Missing required fields: lead_id, name, email' });
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

    await db.from('leads').update({ name }).eq('id', lead_id);

    const intakeData = {
      lead_id,
      name,
      email,
      age: age || null,
      gender: gender || null,
      goal: goal || null,
      injuries: injuries || null,
      diet_pref: diet_pref || null,
      schedule: schedule || null,
      experience: experience || null,
      current_weight: current_weight || null,
      target_weight: target_weight || null,
      height: height || null,
      medical_conditions: medical_conditions || null,
      submitted_at: new Date().toISOString(),
    };

    await db.from('intake_forms').upsert(intakeData, { onConflict: 'lead_id' });

    return res.status(200).json({ success: true, message: 'Intake form submitted' });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
