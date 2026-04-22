const { supabase } = require('../lib/supabase');
const { needsEscalation, getEscalationReason, createEscalation } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const {
      lead_id, name, email, phone, age, gender,
      goal, injuries, diet_preference, schedule,
      medical_conditions, experience_level, notes,
    } = req.body;

    if (!lead_id) return res.status(400).json({ error: 'Missing lead_id' });

    const { data: lead } = await supabase
      .from('leads').select('*').eq('id', lead_id).single();

    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    await supabase.from('leads').update({
      name: name || lead.name,
      last_msg_at: new Date().toISOString(),
    }).eq('id', lead_id);

    const intakeData = {
      age, gender, goal, injuries, diet_preference,
      schedule, medical_conditions, experience_level, notes, email,
    };

    // Store intake data as a message for audit trail
    await supabase.from('messages').insert({
      phone: lead.phone,
      direction: 'in',
      body: JSON.stringify(intakeData),
      template_name: 'intake_form',
    });

    // Check for escalation-worthy content
    const fullText = [injuries, medical_conditions, notes].filter(Boolean).join(' ');
    if (needsEscalation(fullText)) {
      const reason = getEscalationReason(fullText);
      await createEscalation(lead.phone, null, reason, fullText);
    }

    return res.status(200).json({ ok: true, lead_id });
  } catch (err) {
    console.error('Intake error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
};
