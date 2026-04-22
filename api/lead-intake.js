const { getClient } = require('./_lib/supabase');
const { needsEscalation } = require('./_lib/escalation');
const { notifyMaddy, buildEscalationDetails } = require('./_lib/notify');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const sb = getClient();

  try {
    const {
      lead_id, phone, name, age, gender, goal,
      injuries, medical, diet_preference, schedule, experience,
    } = req.body;

    if (!lead_id && !phone) {
      return res.status(400).json({ error: 'lead_id or phone required' });
    }

    // Check for medical escalation
    const combinedText = [injuries, medical, goal].filter(Boolean).join(' ');
    if (needsEscalation(combinedText)) {
      const details = buildEscalationDetails(
        phone || 'unknown',
        combinedText,
        'intake form medical flag'
      );
      await notifyMaddy('Intake Escalation', details);
    }

    // Save intake form
    const { data, error } = await sb.from('intake_forms').insert({
      lead_id: lead_id || null,
      phone,
      name,
      age: age ? parseInt(age, 10) : null,
      gender,
      goal,
      injuries: injuries || null,
      medical: medical || null,
      diet_preference: diet_preference || null,
      schedule: schedule || null,
      experience: experience || null,
      submitted_at: new Date().toISOString(),
    }).select().single();

    if (error) throw error;

    // Update lead name if provided
    if (lead_id && name) {
      await sb.from('leads').update({ name }).eq('id', lead_id);
    }

    return res.status(200).json({ ok: true, id: data.id });
  } catch (err) {
    console.error('lead-intake error:', err.message);
    return res.status(500).json({ error: 'internal' });
  }
};
