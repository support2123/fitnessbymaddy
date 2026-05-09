const { getSupabase } = require('./_lib/supabase');
const { jsonResponse } = require('./_lib/helpers');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      lead_id, name, email, phone, age, gender,
      goal, injuries, diet_preference, schedule,
      experience_level, current_weight, target_weight,
      medical_conditions, supplements,
    } = req.body;

    if (!lead_id) return res.status(400).json({ error: 'lead_id required' });

    const db = getSupabase();

    const { data: lead } = await db
      .from('leads')
      .select('id, phone')
      .eq('id', lead_id)
      .single();

    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    await db.from('leads').update({
      name: name || undefined,
      status: 'qualified',
    }).eq('id', lead_id);

    await db.from('intake_forms').upsert({
      lead_id,
      name,
      email,
      phone: phone || lead.phone,
      age: parseInt(age) || null,
      gender,
      goal,
      injuries,
      diet_preference,
      schedule,
      experience_level,
      current_weight: parseFloat(current_weight) || null,
      target_weight: parseFloat(target_weight) || null,
      medical_conditions,
      supplements,
      submitted_at: new Date().toISOString(),
    }, { onConflict: 'lead_id' });

    return res.json({ status: 'ok', message: 'Intake form submitted' });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
