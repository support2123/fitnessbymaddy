const { getSupabase } = require('./lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const db = getSupabase();

  try {
    const {
      lead_id, name, email, phone, age, gender, height, weight,
      goal, injuries, diet_pref, schedule, experience, medical
    } = req.body;

    if (!lead_id && !phone) {
      return res.status(400).json({ error: 'lead_id or phone required' });
    }

    let leadId = lead_id;
    if (lead_id) {
      const updates = {};
      if (name) updates.name = name;
      const { error } = await db.from('leads').update(updates).eq('id', lead_id);
      if (error) console.error('Lead update error:', error.message);
    }

    const intakeData = {
      age: age || null,
      gender: gender || null,
      height: height || null,
      current_weight: weight || null,
      goal: goal || null,
      injuries: injuries || null,
      diet_preference: diet_pref || null,
      schedule: schedule || null,
      experience: experience || null,
      medical_conditions: medical || null,
      email: email || null
    };

    if (leadId) {
      const { data: existingClient } = await db
        .from('clients')
        .select('id')
        .eq('lead_id', leadId)
        .single();

      if (existingClient) {
        await db.from('clients').update({
          name: name || undefined,
          email: email || undefined
        }).eq('id', existingClient.id);
      }
    }

    return res.status(200).json({ ok: true, leadId });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Submission failed' });
  }
};
