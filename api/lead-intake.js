const { supabase } = require('./lib/supabase');
const { sendWhatsApp } = require('./lib/whatsapp');
const { needsEscalation, notifyMaddy } = require('./lib/escalation');
const { maskPhone } = require('./lib/market');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      lead_id, name, email, age, goal, injuries, diet_pref,
      schedule, experience, medical_conditions,
    } = req.body;

    if (!lead_id || !name || !email) {
      return res.status(400).json({ error: 'Missing required fields: lead_id, name, email' });
    }

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single();

    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    const intakeText = [injuries, medical_conditions, goal].filter(Boolean).join(' ');
    if (needsEscalation(intakeText)) {
      await notifyMaddy('Intake form contains escalation keywords', {
        lead_id,
        phone: maskPhone(lead.phone),
        name,
        flagged_text: intakeText.slice(0, 300),
      }, sendWhatsApp);
    }

    await supabase
      .from('leads')
      .update({
        name,
        status: lead.status === 'new' ? 'qualified' : lead.status,
      })
      .eq('id', lead_id);

    return res.status(200).json({ success: true, lead_id });
  } catch (err) {
    console.error('Lead intake error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
