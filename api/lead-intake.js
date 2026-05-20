const { getSupabase } = require('./_lib/supabase');
const { needsEscalation, escalateToMaddy } = require('./_lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const db = getSupabase();
  const {
    lead_id, name, phone, email, age, gender, height, weight,
    goal, injuries, medical_conditions, diet_preference,
    workout_schedule, equipment_access, current_activity,
    photos_consent
  } = req.body;

  if (!lead_id && !phone) {
    return res.status(400).json({ error: 'lead_id or phone required' });
  }

  const allText = [goal, injuries, medical_conditions].filter(Boolean).join(' ');
  if (needsEscalation(allText)) {
    await escalateToMaddy({
      reason: 'Medical/injury flag in intake form',
      phone: phone || 'unknown',
      details: `Injuries: ${injuries || 'none'} | Medical: ${medical_conditions || 'none'}`
    });
  }

  let leadPhone = phone;
  if (lead_id) {
    const { data: lead } = await db.from('leads').select('phone').eq('id', lead_id).limit(1);
    if (lead && lead.length > 0) leadPhone = lead[0].phone;
  }

  const updates = {};
  if (name) updates.name = name;
  if (goal) updates.program_interest = goal;

  if (lead_id) {
    await db.from('leads').update(updates).eq('id', lead_id);
  } else if (phone) {
    await db.from('leads').update(updates).eq('phone', phone);
  }

  const intakeData = {
    age, gender, height, weight, goal, injuries,
    medical_conditions, diet_preference, workout_schedule,
    equipment_access, current_activity, photos_consent,
    name, email
  };

  if (lead_id) {
    const { data: existingClient } = await db
      .from('clients')
      .select('id')
      .eq('lead_id', lead_id)
      .limit(1);

    if (existingClient && existingClient.length > 0) {
      await db.from('clients').update({
        name, email,
        ...(intakeData.equipment_access === 'home' ? { program: '6wk_home' } : {})
      }).eq('id', existingClient[0].id);
    }
  }

  return res.status(200).json({ success: true, message: 'Intake form received' });
};
