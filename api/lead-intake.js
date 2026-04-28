const { getSupabase } = require('./_lib/supabase');
const { needsEscalation, escalateToMaddy } = require('./_lib/escalation');
const { maskPhone } = require('./_lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const {
      lead_id, name, email, phone, age, gender,
      goal, injuries, diet_pref, schedule,
      experience, medical_conditions,
    } = req.body || {};

    if (!lead_id) return res.status(400).json({ error: 'missing lead_id' });

    const db = getSupabase();

    const { data: lead } = await db
      .from('leads')
      .select('id, phone')
      .eq('id', lead_id)
      .maybeSingle();

    if (!lead) return res.status(404).json({ error: 'lead not found' });

    const combinedText = [goal, injuries, medical_conditions].filter(Boolean).join(' ');
    if (needsEscalation(combinedText)) {
      await escalateToMaddy('intake_form_flag', maskPhone(lead.phone), combinedText);
    }

    await db.from('leads').update({
      name: name || undefined,
      last_msg_at: new Date().toISOString(),
    }).eq('id', lead_id);

    const intakeData = {
      name, email, phone: phone || lead.phone, age, gender,
      goal, injuries, diet_pref, schedule, experience, medical_conditions,
      submitted_at: new Date().toISOString(),
    };

    await db.from('messages').insert({
      phone: lead.phone,
      direction: 'in',
      body: JSON.stringify(intakeData).substring(0, 2000),
      template_name: 'intake_form',
    });

    return res.json({ ok: true, lead_id });
  } catch (err) {
    console.error('lead-intake error:', err.message);
    return res.status(500).json({ error: 'internal' });
  }
};
