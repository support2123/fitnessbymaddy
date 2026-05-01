const { getSupabase } = require('./_lib/supabase');
const { needsEscalation, escalateToMaddy } = require('./_lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const db = getSupabase();
  const {
    lead_id, name, email, phone, age, gender,
    goal, injuries, diet_pref, schedule,
    medical_conditions, current_weight, target_weight,
  } = req.body;

  if (!lead_id) return res.status(400).json({ error: 'Missing lead_id' });

  const { data: lead } = await db
    .from('leads')
    .select('*')
    .eq('id', lead_id)
    .maybeSingle();

  if (!lead) return res.status(404).json({ error: 'Lead not found' });

  await db.from('leads').update({
    name: name || lead.name,
    last_msg_at: new Date().toISOString(),
  }).eq('id', lead_id);

  const intakeData = {
    age, gender, goal, injuries, diet_pref, schedule,
    medical_conditions, current_weight, target_weight, email,
  };

  const combinedText = [injuries, medical_conditions, goal].filter(Boolean).join(' ');
  if (needsEscalation(combinedText)) {
    await escalateToMaddy(
      'Medical flag on intake form',
      phone || lead.phone,
      combinedText.slice(0, 300)
    );
  }

  const { data: existingClient } = await db
    .from('clients')
    .select('id')
    .eq('lead_id', lead_id)
    .maybeSingle();

  if (existingClient) {
    return res.json({ ok: true, message: 'Intake received, client already exists', client_id: existingClient.id });
  }

  return res.json({ ok: true, message: 'Intake form saved. Awaiting payment to activate.' });
};
