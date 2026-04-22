const { getSupabase } = require('./_lib/supabase');
const { sendTemplate } = require('./_lib/whatsapp');
const { needsEscalation, escalateToMaddy } = require('./_lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const db = getSupabase();

  try {
    const {
      lead_id,
      name,
      email,
      phone,
      age,
      goal,
      injuries,
      diet_pref,
      schedule,
      medical_conditions,
    } = req.body;

    if (!lead_id) return res.status(400).json({ error: 'Missing lead_id' });

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single();

    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    if (name) {
      await db.from('leads').update({ name }).eq('id', lead_id);
    }

    const escalationText = [injuries, medical_conditions, goal].filter(Boolean).join(' ');
    if (needsEscalation(escalationText)) {
      await escalateToMaddy('Medical flag in intake form', {
        phone: lead.phone,
        text: escalationText,
      });
    }

    await db.from('leads').update({
      status: 'qualified',
      last_msg_at: new Date().toISOString(),
    }).eq('id', lead_id);

    return res.json({
      success: true,
      message: 'Intake form submitted. Maddy\'s team will send your program details shortly.',
    });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
