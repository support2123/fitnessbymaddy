const { getSupabase } = require('./lib/supabase');
const { checkMedical, createEscalation } = require('./lib/escalation');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const db = getSupabase();
  const {
    lead_id, age, gender, height_cm, weight_kg,
    goal, injuries, medical_conditions,
    diet_preference, workout_schedule, experience_level
  } = req.body;

  if (!lead_id) {
    return res.status(400).json({ error: 'lead_id is required' });
  }

  try {
    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single();

    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    await db.from('intake_submissions').insert({
      lead_id,
      age: parseInt(age) || null,
      gender,
      height_cm: parseFloat(height_cm) || null,
      weight_kg: parseFloat(weight_kg) || null,
      goal,
      injuries,
      medical_conditions,
      diet_preference,
      workout_schedule,
      experience_level
    });

    const allText = [injuries, medical_conditions, goal].join(' ');
    const medicalFlag = checkMedical(allText);
    if (medicalFlag) {
      await createEscalation({
        sourceType: 'intake_form',
        sourceId: lead_id,
        phone: lead.phone,
        reason: `Medical flag in intake: ${medicalFlag}`,
        messageBody: allText
      });
    }

    if (lead.name === null && req.body.name) {
      await db.from('leads').update({ name: req.body.name }).eq('id', lead_id);
    }

    return res.status(200).json({ success: true });

  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
