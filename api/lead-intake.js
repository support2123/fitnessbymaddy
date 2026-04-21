const { getSupabase } = require('./lib/supabase');
const { cors, parseBody } = require('./lib/helpers');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body = await parseBody(req);
  const { lead_id, name, email, age, goal, injuries, diet_pref, schedule, medical } = body;

  if (!lead_id) return res.status(400).json({ error: 'Missing lead_id' });

  const db = getSupabase();

  const { data: lead } = await db
    .from('leads')
    .select('*')
    .eq('id', lead_id)
    .single();

  if (!lead) return res.status(404).json({ error: 'Lead not found' });

  if (name) await db.from('leads').update({ name }).eq('id', lead_id);

  const intakeData = { age, goal, injuries, diet_pref, schedule, medical, email };

  const folderPath = `clients/${lead_id}`;
  await db.storage.from('clients').upload(
    `${folderPath}/intake.json`,
    JSON.stringify(intakeData, null, 2),
    { contentType: 'application/json', upsert: true }
  );

  if (medical && /injur|pregnan|medication|surgery|heart|diabet/i.test(medical)) {
    const { sendWhatsApp } = require('./lib/whatsapp');
    await sendWhatsApp({
      phone: process.env.MADDY_PHONE || '+917082478374',
      templateName: 'escalation_alert',
      params: [name || 'Unknown', 'MEDICAL_FLAG', medical.slice(0, 100)],
    });
  }

  return res.status(200).json({ success: true, message: 'Intake form received' });
};
