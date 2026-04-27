const { getSupabase } = require('../lib/supabase');
const { needsEscalation } = require('../lib/escalation');
const { notifyMaddy } = require('../lib/whatsapp');
const { maskPhone } = require('../lib/market');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const {
      lead_id, name, email, phone, age, gender,
      goal, injuries, diet_preference, schedule,
      experience_level, medical_conditions, notes
    } = req.body;

    if (!lead_id) return res.status(400).json({ error: 'lead_id required' });

    const sb = getSupabase();

    // Verify lead exists
    const { data: lead } = await sb.from('leads').select('*').eq('id', lead_id).single();
    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    // Update lead with intake data
    const updates = {};
    if (name) updates.name = name;

    await sb.from('leads').update(updates).eq('id', lead_id);

    // Check for medical escalation triggers
    const allText = [injuries, medical_conditions, notes].filter(Boolean).join(' ');
    const esc = needsEscalation(allText);
    if (esc.escalate) {
      await notifyMaddy(
        `Intake form flagged for ${maskPhone(lead.phone)}:\n` +
        `Trigger: ${esc.reason}\n` +
        `Details: ${allText.slice(0, 200)}`
      );
    }

    // Store intake data as a note on the lead (extend later to dedicated table if needed)
    const intakeData = {
      name, email, phone: phone || lead.phone, age, gender,
      goal, injuries, diet_preference, schedule,
      experience_level, medical_conditions, notes,
      submitted_at: new Date().toISOString()
    };

    // Store in lead's first_msg field as JSON for now, or use a jsonb column
    await sb.from('leads').update({
      name: name || lead.name,
      first_msg: JSON.stringify(intakeData)
    }).eq('id', lead_id);

    return res.json({ success: true, escalated: esc.escalate });

  } catch (err) {
    console.error('Lead intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
