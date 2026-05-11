const { getSupabase } = require('./_lib/supabase');
const { escalateIfNeeded } = require('./_lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const {
      lead_id, name, email, age, gender, height, weight,
      goal, injuries, medical_conditions, diet_preference,
      workout_schedule, gym_or_home, experience_level, photos,
    } = req.body || {};

    if (!lead_id) return res.status(400).json({ error: 'lead_id required' });

    const db = getSupabase();

    const { data: lead } = await db
      .from('leads')
      .select('id, phone')
      .eq('id', lead_id)
      .single();

    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    await db.from('leads').update({ name }).eq('id', lead_id);

    const medText = [injuries, medical_conditions].filter(Boolean).join('. ');
    await escalateIfNeeded(lead.phone, medText, 'Intake form');

    return res.json({
      ok: true,
      message: 'Intake received. You will receive your program details on WhatsApp after payment.',
    });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
