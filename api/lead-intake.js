const { getSupabase } = require('./_lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      lead_id, name, email, age, gender, height, weight,
      goal, injuries, diet_preference, workout_schedule,
      experience_level, medical_conditions, phone
    } = req.body;

    if (!lead_id && !phone) {
      return res.status(400).json({ error: 'Missing lead_id or phone' });
    }

    const sb = getSupabase();

    let lead;
    if (lead_id) {
      const { data } = await sb.from('leads').select('*').eq('id', lead_id).single();
      lead = data;
    } else {
      const normalizedPhone = normalizePhone(phone);
      const { data } = await sb.from('leads').select('*').eq('phone', normalizedPhone).single();
      lead = data;
    }

    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    await sb.from('leads').update({
      name: name || lead.name,
      last_msg_at: new Date().toISOString()
    }).eq('id', lead.id);

    const intakeData = {
      age: age || null,
      gender: gender || null,
      height: height || null,
      weight: weight || null,
      goal: goal || null,
      injuries: injuries || null,
      diet_preference: diet_preference || null,
      workout_schedule: workout_schedule || null,
      experience_level: experience_level || null,
      medical_conditions: medical_conditions || null,
      email: email || null
    };

    const { data: existingClient } = await sb
      .from('clients')
      .select('id')
      .eq('lead_id', lead.id)
      .single();

    if (existingClient) {
      await sb.from('clients')
        .update({ name: name || undefined, email: email || undefined })
        .eq('id', existingClient.id);
    }

    return res.status(200).json({ ok: true, lead_id: lead.id });

  } catch (err) {
    console.error(`[lead-intake] Error: ${err.message}`);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function normalizePhone(phone) {
  let p = (phone || '').replace(/[^0-9+]/g, '');
  if (p && !p.startsWith('+')) p = '+' + p;
  return p;
}
