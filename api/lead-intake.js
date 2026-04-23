const { getSupabase } = require('./lib/supabase');
const { needsEscalation, escalateToMaddy } = require('./lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const {
      lead_id, name, email, phone, age, gender,
      goal, injuries, medical_conditions, diet_pref,
      schedule, experience_level, current_weight,
      target_weight, height
    } = req.body;

    if (!lead_id) return res.status(400).json({ error: 'Missing lead_id' });

    const db = getSupabase();

    const allText = [injuries, medical_conditions, goal].filter(Boolean).join(' ');
    if (needsEscalation(allText)) {
      await escalateToMaddy('Intake form — medical/injury flag', phone || 'unknown', allText);
    }

    const updates = {};
    if (name) updates.name = name;

    const { error } = await db.from('leads').update(updates).eq('id', lead_id);
    if (error) throw error;

    const intakeData = {
      lead_id, name, email, phone, age, gender,
      goal, injuries, medical_conditions, diet_pref,
      schedule, experience_level, current_weight,
      target_weight, height,
      submitted_at: new Date().toISOString()
    };

    const { data: existing } = await db
      .from('leads')
      .select('id')
      .eq('id', lead_id)
      .single();

    if (!existing) return res.status(404).json({ error: 'Lead not found' });

    // Store intake data as a JSON column update or in metadata
    // For now we update lead name/email and log the full intake
    await db.from('messages').insert({
      phone: phone || 'form',
      direction: 'in',
      body: 'INTAKE_FORM: ' + JSON.stringify(intakeData)
    });

    return res.json({ success: true, lead_id });

  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
