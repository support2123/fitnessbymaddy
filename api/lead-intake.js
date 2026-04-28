const { getSupabase } = require('./_lib/supabase');
const { needsEscalation, cors, parseBody } = require('./_lib/helpers');
const { sendWhatsApp, maskPhone } = require('./_lib/whatsapp');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const db = getSupabase();
  let body;
  try {
    body = await parseBody(req);
  } catch {
    return res.status(400).json({ error: 'Invalid body' });
  }

  const { lead_id, name, email, age, goal, injuries, diet_pref, schedule, medical } = body;

  if (!lead_id) return res.status(400).json({ error: 'lead_id required' });

  const { data: lead } = await db
    .from('leads')
    .select('*')
    .eq('id', lead_id)
    .single();

  if (!lead) return res.status(404).json({ error: 'Lead not found' });

  await db.from('leads').update({
    name: name || lead.name,
    status: 'qualified'
  }).eq('id', lead_id);

  const intakeData = { age, goal, injuries, diet_pref, schedule, medical, email };
  await db.from('leads').update({
    intake_data: intakeData
  }).eq('id', lead_id);

  const combinedText = [injuries, medical, goal].filter(Boolean).join(' ');
  if (needsEscalation(combinedText)) {
    await sendWhatsApp(
      process.env.MADDY_PHONE || '+917082478374',
      'escalation_alert',
      [maskPhone(lead.phone), `Intake form flagged: ${combinedText.slice(0, 200)}`]
    );
  }

  return res.status(200).json({ ok: true, message: 'Intake received' });
};
