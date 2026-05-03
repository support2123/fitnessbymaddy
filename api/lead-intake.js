const { getSupabase } = require('./lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const {
      lead_id, phone, name, email, age, gender, goal,
      injuries, medical_conditions, diet_preference,
      workout_days_per_week, equipment_access, current_activity
    } = req.body;

    if (!lead_id && !phone) {
      return res.status(400).json({ error: 'lead_id or phone required' });
    }

    const db = getSupabase();

    const { data: intake, error } = await db.from('intakes').insert({
      lead_id: lead_id || null,
      phone: phone || null,
      name,
      email,
      age: age ? parseInt(age) : null,
      gender,
      goal,
      injuries: injuries || null,
      medical_conditions: medical_conditions || null,
      diet_preference: diet_preference || null,
      workout_days_per_week: workout_days_per_week ? parseInt(workout_days_per_week) : null,
      equipment_access: equipment_access || null,
      current_activity: current_activity || null
    }).select().single();

    if (error) throw error;

    if (lead_id) {
      await db.from('leads')
        .update({ name, last_msg_at: new Date().toISOString() })
        .eq('id', lead_id);
    }

    const needsEscalation = checkMedicalFlags({ injuries, medical_conditions });
    if (needsEscalation) {
      const { escalate } = require('./lib/escalation');
      await escalate({
        phone: phone || 'unknown',
        reason: `Intake form medical flag: ${needsEscalation}`,
        messageBody: `Injuries: ${injuries || 'none'}, Medical: ${medical_conditions || 'none'}`
      });
    }

    return res.json({ ok: true, intakeId: intake.id });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Failed to save intake' });
  }
};

function checkMedicalFlags({ injuries, medical_conditions }) {
  const flags = ['pregnancy', 'pregnant', 'heart', 'surgery', 'diabetes',
    'seizure', 'epilepsy', 'cancer', 'tumor'];
  const combined = ((injuries || '') + ' ' + (medical_conditions || '')).toLowerCase();
  for (const flag of flags) {
    if (combined.includes(flag)) return flag;
  }
  return null;
}
