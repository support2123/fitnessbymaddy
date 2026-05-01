const { getSupabase } = require('../lib/supabase');
const { cors, needsEscalation, maskPhone } = require('../lib/helpers');
const { notifyMaddy } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const {
    lead_id, name, email, age, gender, goal, injuries,
    diet_pref, schedule, experience, medical_conditions
  } = req.body;

  if (!lead_id) return res.status(400).json({ error: 'Missing lead_id' });

  const db = getSupabase();

  const { data: lead } = await db
    .from('leads')
    .select('*')
    .eq('id', lead_id)
    .single();

  if (!lead) return res.status(404).json({ error: 'Lead not found' });

  await db.from('leads').update({
    name: name || lead.name
  }).eq('id', lead_id);

  const intakeData = { age, gender, goal, injuries, diet_pref, schedule, experience, medical_conditions };
  const intakeText = JSON.stringify(intakeData);

  if (needsEscalation(intakeText)) {
    await notifyMaddy(
      'Intake form has medical flags',
      `Lead: ${maskPhone(lead.phone)}\nName: ${name}\nFlags: ${injuries || ''} ${medical_conditions || ''}`
    );
  }

  await db.from('messages').insert({
    phone: lead.phone,
    direction: 'in',
    body: `[Intake Form] ${intakeText.slice(0, 1500)}`,
    template_name: null,
    sent_at: new Date().toISOString()
  });

  return res.json({ ok: true, lead_id });
};
