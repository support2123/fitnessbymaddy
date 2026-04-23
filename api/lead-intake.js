const { supabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const {
      lead_id, name, email, phone, age, goal, injuries,
      diet_pref, schedule, experience, medical_conditions,
    } = req.body;

    if (!lead_id) return res.status(400).json({ error: 'Missing lead_id' });

    const { data: lead } = await supabase()
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single();

    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    await supabase().from('leads').update({
      name: name || lead.name,
      last_msg_at: new Date().toISOString(),
    }).eq('id', lead_id);

    const intakeData = {
      age, goal, injuries, diet_pref,
      schedule, experience, medical_conditions,
    };

    const { needsEscalation: checkEscalation } = require('../lib/escalation');
    const fieldsToCheck = [injuries, medical_conditions, goal].filter(Boolean).join(' ');
    const escalationReason = checkEscalation(fieldsToCheck);

    if (escalationReason) {
      const { escalate } = require('../lib/escalation');
      await escalate(phone || lead.phone, `Intake form: ${escalationReason}`, fieldsToCheck);
    }

    return res.status(200).json({
      success: true,
      message: 'Intake form received. You will hear from us shortly!',
    });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
