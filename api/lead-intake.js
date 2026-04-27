const { getSupabase } = require('../lib/supabase');
const { maskPhone } = require('../lib/mask-phone');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      lead_id, name, email, phone, age, gender, height, weight,
      goal, injuries, diet_preference, allergies,
      training_experience, equipment_access, schedule,
      medical_conditions, current_supplements
    } = req.body;

    if (!lead_id && !phone) {
      return res.status(400).json({ error: 'lead_id or phone required' });
    }

    const db = getSupabase();

    let lead;
    if (lead_id) {
      const { data } = await db.from('leads').select('*').eq('id', lead_id).single();
      lead = data;
    } else {
      const { data } = await db.from('leads').select('*').eq('phone', phone).single();
      lead = data;
    }

    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    if (name) {
      await db.from('leads').update({ name }).eq('id', lead.id);
    }

    const intakeData = {
      age, gender, height, weight, goal, injuries,
      diet_preference, allergies, training_experience,
      equipment_access, schedule, medical_conditions,
      current_supplements, email,
      submitted_at: new Date().toISOString()
    };

    const { error } = await db
      .from('leads')
      .update({
        name: name || lead.name,
        last_msg_at: new Date().toISOString()
      })
      .eq('id', lead.id);

    // Store intake as a jsonb column or in a separate table
    // For now, we store key data in leads and the full intake in the first_msg field
    await db
      .from('leads')
      .update({ first_msg: JSON.stringify(intakeData) })
      .eq('id', lead.id);

    console.log(`Intake form submitted for lead ${maskPhone(lead.phone)}`);

    return res.status(200).json({
      ok: true,
      message: 'Intake form received! We\'ll be in touch shortly.'
    });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
