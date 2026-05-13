const { getSupabase } = require('../lib/supabase');
const { shouldEscalate } = require('../lib/escalation');
const { escalateToMaddy } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(204).end();
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    const {
      lead_id, name, email, age, goal, injuries, diet_pref,
      schedule, medical_conditions, medications, experience_level,
    } = req.body;

    if (!lead_id) return res.status(400).json({ error: 'lead_id required' });

    const db = getSupabase();

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single();

    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    await db.from('leads').update({
      name: name || lead.name,
      last_msg_at: new Date().toISOString(),
    }).eq('id', lead_id);

    const intakeData = {
      name, email, age, goal, injuries, diet_pref,
      schedule, medical_conditions, medications, experience_level,
      submitted_at: new Date().toISOString(),
    };

    const needsEscalation = shouldEscalate(injuries) ||
      shouldEscalate(medical_conditions) ||
      shouldEscalate(medications);

    if (needsEscalation) {
      await escalateToMaddy({
        reason: 'Medical flag on intake form',
        phone: lead.phone,
        name,
        message: `Injuries: ${injuries || 'none'}, Medical: ${medical_conditions || 'none'}, Meds: ${medications || 'none'}`,
        context: 'Intake form submission',
      });
    }

    return res.json({
      ok: true,
      lead_id,
      escalated: needsEscalation,
      message: needsEscalation
        ? 'Thanks! Maddy will personally review your profile before we begin.'
        : 'Thanks! Your information has been saved. We\'ll get you started soon.',
    });

  } catch (err) {
    console.error('Lead intake error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
};
