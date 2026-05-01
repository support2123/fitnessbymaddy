const { getClient } = require('../lib/supabase');
const { needsEscalation, escalateToMaddy } = require('../lib/escalation');
const { maskPhone } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const {
      lead_id,
      name,
      email,
      phone,
      age,
      gender,
      goal,
      injuries,
      diet_preference,
      schedule,
      medical_conditions,
      current_weight,
      target_weight,
      experience_level,
    } = req.body;

    if (!lead_id) return res.status(400).json({ error: 'missing lead_id' });

    const db = getClient();

    const freeText = [goal, injuries, medical_conditions].filter(Boolean).join(' ');
    if (needsEscalation(freeText)) {
      await escalateToMaddy('Medical flag in intake form', {
        phone: maskPhone(phone),
        detail: freeText.slice(0, 300),
      });
    }

    const { error } = await db
      .from('leads')
      .update({
        name: name || undefined,
        last_msg_at: new Date().toISOString(),
      })
      .eq('id', lead_id);

    if (error) {
      console.error('lead-intake update error:', error.message);
      return res.status(500).json({ error: 'db_error' });
    }

    return res.json({ success: true, lead_id });
  } catch (err) {
    console.error('lead-intake error:', err.message);
    return res.status(500).json({ error: 'internal' });
  }
};
