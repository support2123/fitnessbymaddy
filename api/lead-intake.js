const { getSupabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const {
      lead_id, name, age, gender, height, weight,
      goal, injuries, medical_conditions, diet_preference,
      workout_experience, available_days, equipment_access,
      phone, email
    } = req.body;

    if (!lead_id) return res.status(400).json({ error: 'Missing lead_id' });

    const db = getSupabase();

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single();

    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    await db.from('leads').update({
      name: name || lead.name,
      status: lead.status === 'new' ? 'qualified' : lead.status
    }).eq('id', lead_id);

    const intakeData = {
      lead_id,
      name, age, gender, height, weight,
      goal, injuries, medical_conditions, diet_preference,
      workout_experience, available_days, equipment_access,
      phone: phone || lead.phone, email
    };

    const { error } = await db.from('lead_intake').upsert(intakeData, { onConflict: 'lead_id' });

    if (error) {
      const { error: createError } = await db.rpc('create_intake_if_missing');
      if (!createError) {
        await db.from('lead_intake').upsert(intakeData, { onConflict: 'lead_id' });
      }
    }

    return res.status(200).json({ ok: true, message: 'Intake saved' });
  } catch (err) {
    console.error('Lead intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
