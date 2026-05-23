const { getSupabase } = require('./lib/supabase');
const { checkEscalation } = require('./lib/escalation');
const { notifyMaddy } = require('./lib/whatsapp');
const { maskPhone } = require('./lib/market');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { lead_id, age, gender, goal, injuries, diet_pref, schedule, medical_conditions, current_activity } = req.body;

    if (!lead_id) {
      return res.status(400).json({ error: 'Missing lead_id' });
    }

    const sb = getSupabase();

    const { data: lead } = await sb.from('leads').select('*').eq('id', lead_id).single();
    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    const allText = [injuries, medical_conditions, goal].filter(Boolean).join(' ');
    const escalation = checkEscalation(allText);
    if (escalation) {
      await sb.from('escalations').insert({
        phone: lead.phone,
        reason: `Intake form: ${escalation}`,
        message_body: allText
      });
      await notifyMaddy(
        `Intake form escalation: "${escalation}"`,
        `Lead: ${maskPhone(lead.phone)}\nDetails: ${allText.substring(0, 300)}`
      );
    }

    await sb.from('intake_submissions').insert({
      lead_id,
      age: age ? parseInt(age) : null,
      gender,
      goal,
      injuries,
      diet_pref,
      schedule,
      medical_conditions,
      current_activity
    });

    if (lead.name === null && req.body.name) {
      await sb.from('leads').update({ name: req.body.name }).eq('id', lead_id);
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
