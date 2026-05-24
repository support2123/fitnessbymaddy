const { getSupabase } = require('./lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const db = getSupabase();
  const {
    lead_id, name, email, age, gender, height, weight,
    goal, injuries, diet_pref, schedule, medical_conditions,
    experience_level, equipment_access
  } = req.body;

  if (!lead_id || !name || !email) {
    return res.status(400).json({ error: 'lead_id, name, and email are required' });
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

    await db.from('leads').update({
      name,
      status: lead.status === 'new' ? 'qualified' : lead.status,
      last_msg_at: new Date().toISOString()
    }).eq('id', lead_id);

    const { error: profileErr } = await db.from('intake_profiles').upsert({
      lead_id,
      name,
      email,
      age: parseInt(age) || null,
      gender,
      height,
      weight: parseFloat(weight) || null,
      goal,
      injuries: injuries || null,
      diet_pref: diet_pref || null,
      schedule: schedule || null,
      medical_conditions: medical_conditions || null,
      experience_level: experience_level || null,
      equipment_access: equipment_access || null,
      submitted_at: new Date().toISOString()
    }, { onConflict: 'lead_id' });

    if (profileErr) {
      console.error('Intake save error:', profileErr.message);
      return res.status(500).json({ error: 'Failed to save intake' });
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
};
