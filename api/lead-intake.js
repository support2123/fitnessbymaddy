const { getSupabase } = require('./_lib/supabase');
const { needsEscalation, escalate } = require('./_lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const {
      lead_id, name, email, phone, age, gender,
      goal, injuries, medical_conditions, diet_preference,
      training_experience, schedule, current_weight, height
    } = req.body;

    if (!lead_id && !phone) {
      return res.status(400).json({ error: 'lead_id or phone required' });
    }

    const db = getSupabase();

    let leadId = lead_id;
    if (!leadId && phone) {
      const { data } = await db.from('leads').select('id').eq('phone', phone).limit(1).single();
      if (data) leadId = data.id;
    }

    if (leadId) {
      await db.from('leads').update({
        name: name || undefined,
        last_msg_at: new Date().toISOString()
      }).eq('id', leadId);
    }

    const medicalText = [injuries, medical_conditions].filter(Boolean).join(' ');
    const escalationReason = needsEscalation(medicalText);
    if (escalationReason) {
      await escalate(phone || 'unknown', `Intake form: ${escalationReason}`, medicalText);
    }

    return res.status(200).json({
      ok: true,
      message: 'Intake form received. We will be in touch shortly!'
    });
  } catch (err) {
    console.error('Lead intake error:', err.message);
    return res.status(500).json({ error: 'internal' });
  }
};
