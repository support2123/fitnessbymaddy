const { getSupabase } = require('./_lib/supabase');
const { needsEscalation, escalateToMaddy } = require('./_lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const db = getSupabase();
    const {
      lead_id, name, email, phone, age, gender, goal, injuries,
      medical_conditions, diet_preference, workout_schedule,
      experience_level, current_weight, target_weight, height
    } = req.body;

    if (!lead_id) return res.status(400).json({ error: 'Missing lead_id' });

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single();

    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    if (name) {
      await db.from('leads').update({ name }).eq('id', lead_id);
    }

    const intakeText = [injuries, medical_conditions, goal].filter(Boolean).join(' ');
    if (needsEscalation(intakeText)) {
      await escalateToMaddy({
        reason: 'intake_form_medical_flag',
        phone: lead.phone,
        message: intakeText
      });
    }

    const intakeData = {
      age, gender, goal, injuries, medical_conditions,
      diet_preference, workout_schedule, experience_level,
      current_weight, target_weight, height, email,
      intake_submitted_at: new Date().toISOString()
    };

    const { data: existingClient } = await db
      .from('clients')
      .select('id')
      .eq('lead_id', lead_id)
      .limit(1)
      .single();

    if (existingClient) {
      await db.from('clients').update({
        name: name || undefined,
        email: email || undefined
      }).eq('id', existingClient.id);
    }

    return res.status(200).json({ success: true, lead_id, intake: intakeData });

  } catch (err) {
    console.error('Lead intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
