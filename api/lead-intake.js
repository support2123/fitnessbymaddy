const { getSupabase } = require('../lib/supabase');
const { needsEscalation, escalateToMaddy } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const {
      lead_id, name, age, email, phone,
      goal, injuries, medical_conditions,
      diet_preference, workout_schedule,
      current_activity_level, equipment_available,
    } = req.body;

    if (!lead_id) return res.status(400).json({ error: 'lead_id required' });

    const db = getSupabase();

    const allText = [goal, injuries, medical_conditions].join(' ');
    if (needsEscalation(allText)) {
      await escalateToMaddy(
        'Medical flag in intake form',
        phone || 'unknown',
        allText.slice(0, 300)
      );
    }

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single();

    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    await db.from('leads').update({
      name: name || lead.name,
      status: lead.status === 'new' ? 'qualified' : lead.status,
    }).eq('id', lead_id);

    const intakeData = {
      lead_id,
      name,
      age: parseInt(age) || null,
      email,
      phone: phone || lead.phone,
      goal,
      injuries: injuries || null,
      medical_conditions: medical_conditions || null,
      diet_preference: diet_preference || null,
      workout_schedule: workout_schedule || null,
      current_activity_level: current_activity_level || null,
      equipment_available: equipment_available || null,
      submitted_at: new Date().toISOString(),
    };

    await db.from('lead_intakes').upsert(intakeData, { onConflict: 'lead_id' });

    return res.json({ ok: true, lead_id });
  } catch (err) {
    console.error('[lead-intake]', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
