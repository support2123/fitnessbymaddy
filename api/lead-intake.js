const { getSupabase } = require('./lib/supabase');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      lead_id, name, email, age, gender, goal, injuries,
      diet_preference, schedule, medical_conditions, current_weight,
      target_weight, experience_level
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

    await db.from('leads').update({ name }).eq('id', lead_id);

    const intakeData = {
      age, gender, goal, injuries, diet_preference, schedule,
      medical_conditions, current_weight, target_weight, experience_level
    };

    await db.from('clients').upsert({
      lead_id,
      phone: lead.phone,
      name,
      email,
      program: lead.program_interest,
      status: 'active',
      folder_url: `/clients/${lead_id}/`
    }, { onConflict: 'lead_id', ignoreDuplicates: false });

    return res.status(200).json({ ok: true, message: 'Intake saved' });
  } catch (err) {
    console.error('lead-intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
