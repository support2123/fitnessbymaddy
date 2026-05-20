const { getSupabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      lead_id, name, email, age, gender, height, weight,
      goal, injuries, diet_preference, schedule, experience,
      medical_conditions, phone,
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

    await db.from('leads').update({
      name: name || lead.name,
    }).eq('id', lead.id);

    const intakeData = {
      age, gender, height, weight, goal, injuries,
      diet_preference, schedule, experience, medical_conditions, email,
    };

    const { error } = await db.from('clients').upsert({
      lead_id: lead.id,
      phone: lead.phone,
      name: name || lead.name,
      email,
      program: lead.program_interest,
      status: 'active',
    }, { onConflict: 'lead_id', ignoreDuplicates: true });

    if (error && error.code !== '23505') {
      console.error('intake insert error:', error);
    }

    return res.status(200).json({ ok: true, message: 'Intake form received' });
  } catch (err) {
    console.error('lead-intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
