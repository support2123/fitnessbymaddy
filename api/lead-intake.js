const { getSupabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const db = getSupabase();
    const {
      lead_id, name, email, age, gender, height, weight,
      goal, injuries, medical_conditions, diet_preference,
      activity_level, schedule, equipment_access, photos
    } = req.body;

    if (!lead_id) return res.status(400).json({ error: 'Missing lead_id' });

    const { data: lead } = await db.from('leads')
      .select('*')
      .eq('id', lead_id)
      .single();

    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    await db.from('leads').update({
      name: name || lead.name,
      status: lead.status === 'new' ? 'qualified' : lead.status
    }).eq('id', lead_id);

    const { data: existing } = await db.from('intake_forms')
      .select('id')
      .eq('lead_id', lead_id)
      .single();

    const intakeData = {
      lead_id,
      name,
      email,
      age: age ? parseInt(age) : null,
      gender,
      height,
      weight: weight ? parseFloat(weight) : null,
      goal,
      injuries: injuries || null,
      medical_conditions: medical_conditions || null,
      diet_preference,
      activity_level,
      schedule,
      equipment_access,
      photos: photos || [],
      submitted_at: new Date().toISOString()
    };

    if (existing) {
      await db.from('intake_forms').update(intakeData).eq('id', existing.id);
    } else {
      await db.from('intake_forms').insert(intakeData);
    }

    return res.status(200).json({ success: true, message: 'Intake form submitted' });

  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
