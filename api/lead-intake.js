const { getSupabase } = require('../lib/supabase');
const { maskPhone } = require('../lib/masking');

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
      current_weight, height, experience_level,
      medical_conditions, supplements
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

    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    await db
      .from('leads')
      .update({
        name,
        last_msg_at: new Date().toISOString()
      })
      .eq('id', lead_id);

    const intakeData = {
      lead_id,
      name,
      email,
      phone: phone || lead.phone,
      age: age || null,
      gender: gender || null,
      goal: goal || null,
      injuries: injuries || null,
      diet_pref: diet_pref || null,
      schedule: schedule || null,
      current_weight: current_weight || null,
      height: height || null,
      experience_level: experience_level || null,
      medical_conditions: medical_conditions || null,
      supplements: supplements || null,
      submitted_at: new Date().toISOString()
    };

    await db.from('intake_forms').upsert(intakeData, { onConflict: 'lead_id' });

    console.log(`Intake submitted for lead ${lead_id} (${maskPhone(lead.phone)})`);
    return res.status(200).json({ status: 'ok', message: 'Intake form submitted successfully' });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
