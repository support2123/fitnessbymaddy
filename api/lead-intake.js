const { getSupabase, TABLES } = require('./_utils/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = req.body || {};
    const {
      lead_id, name, email, age, gender, height, weight,
      goal, injuries, diet_pref, workout_schedule,
      medical_conditions, experience_level, phone,
    } = body;

    if (!lead_id && !phone) {
      return res.status(400).json({ error: 'Missing lead_id or phone' });
    }

    const db = getSupabase();

    let lead;
    if (lead_id) {
      const { data } = await db.from(TABLES.LEADS).select('*').eq('id', lead_id).single();
      lead = data;
    } else {
      const { data } = await db.from(TABLES.LEADS).select('*').eq('phone', phone).order('created_at', { ascending: false }).limit(1);
      lead = data && data[0];
    }

    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    const updates = {};
    if (name) updates.name = name;
    if (body.program_interest) updates.program_interest = body.program_interest;

    const intakeData = {
      email, age: parseInt(age) || null, gender, height, weight,
      goal, injuries, diet_pref, workout_schedule,
      medical_conditions, experience_level,
      submitted_at: new Date().toISOString(),
    };

    updates.intake_data = intakeData;

    await db.from(TABLES.LEADS).update(updates).eq('id', lead.id);

    const { checkEscalationTriggers } = require('./_utils/escalation');
    const combined = [injuries, medical_conditions, goal].filter(Boolean).join(' ');
    const escalation = checkEscalationTriggers(combined);
    if (escalation) {
      const { notifyMaddy } = require('./_utils/escalation');
      await notifyMaddy(escalation, `Lead: ${lead.name || lead.phone}\nIntake form flagged: ${combined.slice(0, 200)}`);
    }

    return res.status(200).json({ success: true, leadId: lead.id });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
