const { getSupabase } = require('../lib/supabase');
const { needsEscalation } = require('../lib/utils');
const { escalateToMaddy } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const db = getSupabase();
  const body = req.body || {};

  const {
    lead_id, name, email, phone, age, gender, goal,
    injuries, diet_preference, schedule, experience,
    medical_conditions, current_weight, target_weight,
  } = body;

  if (!lead_id && !phone) {
    return res.status(400).json({ error: 'lead_id or phone required' });
  }

  try {
    const intakeText = [
      injuries, medical_conditions, goal, diet_preference,
    ].filter(Boolean).join(' ');

    if (needsEscalation(intakeText)) {
      await escalateToMaddy({
        reason: 'Medical/injury flag in intake form',
        phone: phone || 'unknown',
        clientName: name,
        details: intakeText.slice(0, 300),
      });
    }

    if (lead_id) {
      await db.from('leads').update({
        name: name || undefined,
        last_msg_at: new Date().toISOString(),
      }).eq('id', lead_id);
    }

    const intakeRecord = {
      lead_id: lead_id || null,
      phone: phone || null,
      name, email, age: age ? parseInt(age) : null,
      gender, goal, injuries, diet_preference, schedule,
      experience, medical_conditions,
      current_weight: current_weight ? parseFloat(current_weight) : null,
      target_weight: target_weight ? parseFloat(target_weight) : null,
      submitted_at: new Date().toISOString(),
    };

    const { error: intakeErr } = await db
      .from('intake_forms')
      .insert(intakeRecord);

    if (intakeErr && intakeErr.code === '42P01') {
      await db.rpc('exec_sql', {
        sql: `create table if not exists intake_forms (
          id uuid primary key default gen_random_uuid(),
          lead_id uuid,
          phone text,
          name text,
          email text,
          age integer,
          gender text,
          goal text,
          injuries text,
          diet_preference text,
          schedule text,
          experience text,
          medical_conditions text,
          current_weight numeric,
          target_weight numeric,
          submitted_at timestamptz default now()
        )`
      }).catch(() => {});
      await db.from('intake_forms').insert(intakeRecord);
    }

    return res.status(200).json({ success: true, message: 'Intake form submitted' });

  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Submission failed' });
  }
};
