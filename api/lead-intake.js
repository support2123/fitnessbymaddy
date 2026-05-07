const { getSupabase } = require('./_lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      lead_id, name, email, phone, age, gender,
      goal, injuries, diet_pref, schedule,
      experience, current_weight, height, medical_conditions
    } = req.body;

    if (!lead_id) return res.status(400).json({ error: 'lead_id is required' });

    const db = getSupabase();

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single();

    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    const updates = {};
    if (name) updates.name = name;
    if (lead.status === 'new') updates.status = 'qualified';

    if (Object.keys(updates).length > 0) {
      await db.from('leads').update(updates).eq('id', lead_id);
    }

    const intakeData = {
      lead_id,
      name: name || lead.name,
      email,
      phone: phone || lead.phone,
      age: age ? parseInt(age) : null,
      gender,
      goal,
      injuries: injuries || null,
      diet_pref: diet_pref || null,
      schedule: schedule || null,
      experience: experience || null,
      current_weight: current_weight ? parseFloat(current_weight) : null,
      height: height ? parseFloat(height) : null,
      medical_conditions: medical_conditions || null,
      submitted_at: new Date().toISOString()
    };

    const { error: upsertError } = await db
      .from('lead_intakes')
      .upsert(intakeData, { onConflict: 'lead_id' });

    if (upsertError) {
      console.error('Intake upsert error:', upsertError.message);
    }

    return res.status(200).json({ success: true, message: 'Intake form submitted' });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
