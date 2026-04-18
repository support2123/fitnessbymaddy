const { getSupabase } = require('./lib/supabase');
const { needsEscalation, escalate } = require('./lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      lead_id, name, email, age, gender, goal, injuries,
      diet_preference, workout_days, equipment_access,
      medical_conditions, current_weight, target_weight, schedule
    } = req.body;

    if (!lead_id) return res.status(400).json({ error: 'Missing lead_id' });

    const db = getSupabase();

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single();

    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    if (name) {
      await db.from('leads').update({ name }).eq('id', lead_id);
    }

    const intakeData = {
      name, email, age, gender, goal, injuries,
      diet_preference, workout_days, equipment_access,
      medical_conditions, current_weight, target_weight, schedule
    };

    const escalationFields = [injuries, medical_conditions, goal].filter(Boolean).join(' ');
    if (needsEscalation(escalationFields)) {
      await escalate(lead.phone, 'Intake form flagged — medical/injury', escalationFields);
    }

    const bucket = db.storage.from('clients');
    const filePath = `intakes/${lead_id}.json`;
    await bucket.upload(filePath, JSON.stringify(intakeData, null, 2), {
      contentType: 'application/json',
      upsert: true
    });

    return res.status(200).json({ success: true, lead_id });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
