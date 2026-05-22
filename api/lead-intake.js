const { getSupabase } = require('./lib/supabase');
const { needsEscalation, escalate } = require('./lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const db = getSupabase();

  try {
    const {
      lead_id, name, email, age, gender, height, weight,
      goal, injuries, diet_pref, schedule, medical_conditions,
      experience_level
    } = req.body;

    if (!lead_id) return res.status(400).json({ error: 'Missing lead_id' });

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single();

    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    const intakeText = [injuries, medical_conditions, goal].filter(Boolean).join(' ');
    if (needsEscalation(intakeText)) {
      await escalate(
        'Medical/injury flag in intake form',
        lead.phone,
        `Age: ${age}, Injuries: ${injuries}, Medical: ${medical_conditions}`
      );
    }

    await db.from('leads').update({
      name: name || lead.name,
      status: lead.status === 'new' ? 'qualified' : lead.status
    }).eq('id', lead_id);

    const { error: metaError } = await db.from('lead_intake').upsert({
      lead_id,
      name,
      email,
      age: age ? parseInt(age) : null,
      gender,
      height,
      weight: weight ? parseFloat(weight) : null,
      goal,
      injuries: injuries || null,
      diet_pref: diet_pref || null,
      schedule: schedule || null,
      medical_conditions: medical_conditions || null,
      experience_level: experience_level || null,
      submitted_at: new Date().toISOString()
    });

    if (metaError) {
      console.error('Intake save error:', metaError.message);
      return res.status(500).json({ error: 'Failed to save intake' });
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
