const { getSupabase } = require('./_lib/supabase');
const { needsEscalation, escalateToMaddy } = require('./_lib/escalation');
const { maskPhone } = require('./_lib/mask-phone');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      lead_id, name, email, age, goal, injuries, diet_pref,
      schedule, medical_conditions, phone,
    } = req.body;

    if (!lead_id) return res.status(400).json({ error: 'Missing lead_id' });

    const db = getSupabase();
    const { data: lead } = await db.from('leads').select('*').eq('id', lead_id).single();
    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    await db.from('leads').update({
      name: name || lead.name,
      last_msg_at: new Date().toISOString(),
    }).eq('id', lead_id);

    const intakeText = [
      injuries, medical_conditions, goal, diet_pref,
    ].filter(Boolean).join(' ');

    if (needsEscalation(intakeText)) {
      await escalateToMaddy(
        'Medical flag in intake form',
        `Lead: ${maskPhone(lead.phone)}\nName: ${name}\nDetails: ${intakeText.slice(0, 300)}`
      );
    }

    return res.status(200).json({ success: true, message: 'Intake received' });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
