const { getSupabase } = require('../lib/supabase');
const { needsEscalation, notifyMaddy } = require('../lib/escalation');
const { corsHeaders, parseBody } = require('../lib/utils');

module.exports = async function handler(req, res) {
  corsHeaders(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body = await parseBody(req);
  const {
    lead_id, name, email, phone, age, gender,
    goal, injuries, diet_pref, schedule,
    medical_conditions, current_weight, target_weight,
    experience_level
  } = body;

  if (!lead_id || !name || !email) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const db = getSupabase();

  const medicalText = [injuries, medical_conditions].filter(Boolean).join(' ');
  const esc = needsEscalation(medicalText);
  if (esc.escalate) {
    await notifyMaddy('Medical flag on intake form', {
      phone,
      clientName: name,
      details: `Trigger: "${esc.trigger}" — Info: ${medicalText}`
    });
  }

  const { error } = await db.from('leads').update({
    name,
    last_msg_at: new Date().toISOString()
  }).eq('id', lead_id);

  if (error) {
    return res.status(500).json({ error: 'Failed to update lead' });
  }

  return res.status(200).json({ success: true, escalated: esc.escalate });
};
