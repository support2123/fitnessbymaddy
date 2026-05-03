const { getSupabase } = require('./_lib/supabase');
const { needsEscalation, escalateToMaddy } = require('./_lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const db = getSupabase();

  try {
    const {
      lead_id, name, email, phone, age, gender,
      goal, injuries, diet_pref, schedule,
      medical_conditions, experience_level,
    } = req.body || {};

    if (!lead_id) {
      return res.status(400).json({ error: 'lead_id required' });
    }

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single();

    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    const fieldsToCheck = [injuries, medical_conditions, goal].filter(Boolean).join(' ');
    if (needsEscalation(fieldsToCheck)) {
      await escalateToMaddy(
        'Medical flag in intake form',
        lead.phone,
        fieldsToCheck.slice(0, 300)
      );
    }

    await db.from('leads').update({
      name: name || lead.name,
      status: lead.status === 'new' ? 'qualified' : lead.status,
      last_msg_at: new Date().toISOString(),
    }).eq('id', lead_id);

    const intakeData = {
      lead_id,
      name, email, phone: phone || lead.phone,
      age: age ? parseInt(age, 10) : null,
      gender, goal, injuries, diet_pref, schedule,
      medical_conditions, experience_level,
      submitted_at: new Date().toISOString(),
    };

    await db.from('intake_forms').upsert(intakeData, { onConflict: 'lead_id' });

    return res.status(200).json({ success: true, leadId: lead_id });
  } catch (err) {
    console.error(`Intake error: ${err.message}`);
    return res.status(500).json({ error: 'Internal error' });
  }
};
