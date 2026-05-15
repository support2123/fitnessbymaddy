const { getSupabase } = require('./_lib/supabase');
const { jsonResponse } = require('./_lib/helpers');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      lead_id, name, email, age, gender, height, weight,
      goal, injuries, diet_pref, schedule, allergies,
      medical_conditions, experience_level
    } = req.body;

    if (!lead_id) {
      return res.status(400).json({ error: 'Missing lead_id' });
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

    if (name) {
      await db.from('leads')
        .update({ name })
        .eq('id', lead_id);
    }

    const intakeData = {
      lead_id,
      name: name || lead.name,
      email,
      age: parseInt(age) || null,
      gender,
      height,
      weight: parseFloat(weight) || null,
      goal,
      injuries: injuries || null,
      diet_pref: diet_pref || null,
      schedule: schedule || null,
      allergies: allergies || null,
      medical_conditions: medical_conditions || null,
      experience_level: experience_level || null,
      submitted_at: new Date().toISOString()
    };

    await db.from('messages').insert({
      phone: lead.phone,
      direction: 'in',
      body: `[INTAKE FORM] ${JSON.stringify(intakeData)}`,
      sent_at: new Date().toISOString(),
      status: 'received'
    });

    return res.status(200).json({ ok: true, message: 'Intake submitted' });
  } catch (err) {
    console.error('Lead intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
