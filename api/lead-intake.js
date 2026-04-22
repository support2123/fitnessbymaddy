const { getSupabase } = require('./_lib/supabase');
const { cors } = require('./_lib/helpers');
const { needsEscalation, escalateToMaddy } = require('./_lib/escalation');

module.exports = async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const db = getSupabase();
  const b = req.body || {};
  const leadId = b.lead_id;

  if (!leadId) return res.status(400).json({ error: 'missing lead_id' });

  const medicalFields = [b.injuries, b.medical, b.goal].filter(Boolean).join(' ');
  if (needsEscalation(medicalFields)) {
    const { data: lead } = await db.from('leads').select('phone').eq('id', leadId).single();
    await escalateToMaddy('intake_medical_flag', lead?.phone || 'unknown', medicalFields);
  }

  const { error } = await db.from('intake_data').insert({
    lead_id: leadId,
    age: b.age ? parseInt(b.age, 10) : null,
    gender: b.gender || null,
    height_cm: b.height_cm ? parseFloat(b.height_cm) : null,
    weight_kg: b.weight_kg ? parseFloat(b.weight_kg) : null,
    goal: b.goal || null,
    injuries: b.injuries || null,
    diet_pref: b.diet_pref || null,
    schedule: b.schedule || null,
    experience: b.experience || null,
    medical: b.medical || null
  });

  if (error) {
    console.error('[Intake] Insert error:', error.message);
    return res.status(500).json({ error: 'save_failed' });
  }

  return res.json({ ok: true });
};
