const { getSupabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const db = getSupabase();

  try {
    const {
      lead_id,
      name,
      email,
      phone,
      age,
      gender,
      height,
      weight,
      goal,
      injuries,
      diet_preference,
      schedule,
      experience_level,
      medical_conditions
    } = req.body;

    if (!lead_id && !phone) {
      return res.status(400).json({ error: 'lead_id or phone required' });
    }

    let lead;
    if (lead_id) {
      const { data } = await db.from('leads').select('*').eq('id', lead_id).single();
      lead = data;
    } else if (phone) {
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
      age, gender, height, weight, goal,
      injuries, diet_preference, schedule,
      experience_level, medical_conditions
    };

    await db.from('leads').update({
      name: name || lead.name,
      intake_data: intakeData
    }).eq('id', lead.id);

    const hasEscalationFlags = [injuries, medical_conditions].some(
      field => field && field.trim().length > 0
    );

    if (hasEscalationFlags) {
      const { createEscalation } = require('../lib/escalation');
      await createEscalation(
        lead.phone,
        'intake_medical_flag',
        `Injuries: ${injuries || 'none'}, Medical: ${medical_conditions || 'none'}`
      );
    }

    return res.json({ ok: true, lead_id: lead.id });

  } catch (err) {
    console.error('[lead-intake] Error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
