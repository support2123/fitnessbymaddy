const { getSupabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      lead_id, name, email, phone, age, gender,
      goal, injuries, diet_pref, schedule,
      experience, medical_conditions, current_weight,
      target_weight, height,
    } = req.body;

    if (!lead_id || !name || !email) {
      return res.status(400).json({ error: 'Missing required fields: lead_id, name, email' });
    }

    const db = getSupabase();

    const { data: lead } = await db
      .from('leads')
      .select('id, phone, program_interest')
      .eq('id', lead_id)
      .single();

    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    await db.from('leads').update({
      name,
      status: 'qualified',
    }).eq('id', lead_id);

    const intakeData = {
      lead_id,
      name,
      email,
      phone: phone || lead.phone,
      age: age ? parseInt(age) : null,
      gender,
      goal,
      injuries,
      diet_pref,
      schedule,
      experience,
      medical_conditions,
      current_weight: current_weight ? parseFloat(current_weight) : null,
      target_weight: target_weight ? parseFloat(target_weight) : null,
      height,
      submitted_at: new Date().toISOString(),
    };

    const folderPath = `intakes/${lead_id}.json`;
    await db.storage
      .from('clients')
      .upload(folderPath, JSON.stringify(intakeData, null, 2), {
        contentType: 'application/json',
        upsert: true,
      });

    return res.status(200).json({ success: true, lead_id });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
