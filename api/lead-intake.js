const { supabase } = require('../lib/supabase');
const { handleCors } = require('../lib/helpers');
const { needsEscalation } = require('../lib/helpers');
const { escalate } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const {
      lead_id, name, email, phone, age, gender,
      goal, injuries, diet_pref, schedule,
      medical_conditions, current_weight, target_weight
    } = req.body;

    if (!lead_id) {
      return res.status(400).json({ error: 'Missing lead_id' });
    }

    const intakeText = [injuries, medical_conditions, goal].filter(Boolean).join(' ');
    if (needsEscalation(intakeText)) {
      await escalate('Medical flag in intake form', phone || 'unknown', intakeText.slice(0, 300));
    }

    const updates = {};
    if (name) updates.name = name;
    if (phone) updates.phone = phone;

    if (Object.keys(updates).length > 0) {
      await supabase.from('leads').update(updates).eq('id', lead_id);
    }

    const { error } = await supabase.from('leads').update({
      name: name || undefined,
      last_msg_at: new Date().toISOString()
    }).eq('id', lead_id);

    if (error) {
      return res.status(500).json({ error: 'Failed to update lead' });
    }

    return res.status(200).json({ ok: true, message: 'Intake received' });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
