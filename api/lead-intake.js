const { getSupabase } = require('./lib/supabase');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      lead_id, name, email, age, gender, height, weight,
      goal, injuries, diet_preference, workout_days,
      gym_access, experience_level, medical_conditions,
      phone,
    } = req.body;

    if (!lead_id && !phone) {
      return res.status(400).json({ error: 'lead_id or phone required' });
    }

    const db = getSupabase();

    let leadId = lead_id;

    if (!leadId && phone) {
      const { data: lead } = await db
        .from('leads')
        .select('id')
        .eq('phone', phone)
        .limit(1)
        .single();
      if (lead) leadId = lead.id;
    }

    if (leadId) {
      await db.from('leads').update({
        name: name || undefined,
        status: 'qualified',
        last_msg_at: new Date().toISOString(),
      }).eq('id', leadId);
    }

    const { data: intake, error } = await db.from('intake_forms').insert({
      lead_id: leadId || null,
      name,
      email,
      phone: phone || null,
      age: parseInt(age) || null,
      gender,
      height,
      weight: parseFloat(weight) || null,
      goal,
      injuries: injuries || null,
      diet_preference: diet_preference || null,
      workout_days: parseInt(workout_days) || null,
      gym_access: gym_access === 'true' || gym_access === true,
      experience_level: experience_level || null,
      medical_conditions: medical_conditions || null,
      submitted_at: new Date().toISOString(),
    }).select().single();

    if (error) throw error;

    return res.status(200).json({ ok: true, intake_id: intake.id });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Failed to save intake form' });
  }
};
