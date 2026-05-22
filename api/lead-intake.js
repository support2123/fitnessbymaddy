const { getSupabase } = require('../lib/supabase');
const { needsEscalation, createEscalation } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      lead_id, name, email, age, gender, height, weight,
      goal, injuries, diet_pref, schedule, medical, photos_consent
    } = req.body;

    if (!lead_id || !name || !email) {
      return res.status(400).json({ error: 'lead_id, name, and email are required' });
    }

    const db = getSupabase();

    await db.from('leads').update({ name }).eq('id', lead_id);

    const combinedText = [injuries, medical, goal].filter(Boolean).join(' ');
    if (needsEscalation(combinedText)) {
      const { data: lead } = await db.from('leads').select('phone').eq('id', lead_id).single();
      await createEscalation({
        sourceType: 'intake_form',
        sourceId: lead_id,
        phone: lead?.phone || 'unknown',
        reason: 'medical_flag',
        details: combinedText.slice(0, 500)
      });
    }

    return res.status(200).json({ ok: true, message: 'Intake received' });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
