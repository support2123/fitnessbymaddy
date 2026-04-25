const { getSupabase } = require('./lib/supabase');
const { needsEscalation, escalateToMaddy } = require('./lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const db = getSupabase();

  try {
    const {
      lead_id, name, email, phone, age, gender, goal,
      injuries, diet_pref, schedule, experience,
      current_weight, target_weight, height,
    } = req.body;

    if (!lead_id) {
      return res.status(400).json({ error: 'lead_id required' });
    }

    const medicalFields = [injuries, goal].filter(Boolean).join(' ');
    if (needsEscalation(medicalFields)) {
      await escalateToMaddy('Medical/injury flag on intake form', {
        phone: phone || '',
        name: name || '',
        message: medicalFields,
      });
    }

    const { error } = await db.from('leads')
      .update({
        name: name || undefined,
        status: 'qualified',
        last_msg_at: new Date().toISOString(),
      })
      .eq('id', lead_id);

    if (error) {
      return res.status(400).json({ error: 'Lead not found' });
    }

    const intakeData = {
      lead_id, name, email, phone, age, gender, goal,
      injuries, diet_pref, schedule, experience,
      current_weight, target_weight, height,
      submitted_at: new Date().toISOString(),
    };

    const bucketPath = `intakes/${lead_id}.json`;
    await db.storage.from('client-data')
      .upload(bucketPath, JSON.stringify(intakeData, null, 2), {
        contentType: 'application/json',
        upsert: true,
      });

    return res.json({ success: true, lead_id });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
