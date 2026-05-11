const { getSupabase } = require('./_lib/supabase');
const { needsEscalation, escalateToMaddy } = require('./_lib/escalation');
const { maskPhone } = require('./_lib/whatsapp');

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
      medical_conditions,
      diet_preference,
      workout_experience,
      available_equipment,
      weekly_schedule,
      sleep_hours,
      stress_level
    } = req.body;

    if (!lead_id && !phone) {
      return res.status(400).json({ error: 'Missing lead_id or phone' });
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
      medical_conditions, diet_preference, workout_experience,
      available_equipment, weekly_schedule, sleep_hours, stress_level, email
    };

    await db.from('leads').update({
      name: name || lead.name,
      last_msg_at: new Date().toISOString()
    }).eq('id', lead.id);

    const escalationText = [injuries, medical_conditions, goal].filter(Boolean).join(' ');
    if (needsEscalation(escalationText)) {
      await escalateToMaddy('Intake form - medical flag', {
        phone: maskPhone(lead.phone),
        message: escalationText.substring(0, 200),
        clientName: name || lead.name || 'Unknown'
      });
    }

    return res.status(200).json({ success: true, lead_id: lead.id, intake: intakeData });
  } catch (err) {
    console.error('Lead intake error:', err.message);
    return res.status(500).json({ error: 'Failed to process intake' });
  }
};
