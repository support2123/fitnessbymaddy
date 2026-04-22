const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp, detectMarket, isHinglish } = require('../lib/whatsapp');
const { cors } = require('../lib/utils');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const {
    lead_id, name, email, phone, age, gender,
    goal, injuries, diet_pref, schedule, experience,
    equipment, medical_conditions,
  } = req.body;

  if (!lead_id || !name || !phone) {
    return res.status(400).json({ error: 'Missing required fields: lead_id, name, phone' });
  }

  const db = getSupabase();

  const { data: lead } = await db
    .from('leads')
    .select('*')
    .eq('id', lead_id)
    .single();

  if (!lead) {
    return res.status(404).json({ error: 'Lead not found' });
  }

  await db.from('leads').update({
    name,
    status: lead.status === 'new' ? 'qualified' : lead.status,
    last_msg_at: new Date().toISOString(),
  }).eq('id', lead_id);

  const needsEscalation = medical_conditions || injuries;
  if (needsEscalation) {
    await sendWhatsApp(
      process.env.MADDY_PHONE || '+917082478374',
      'escalation_alert',
      [name, 'medical/injury noted on intake form', `${injuries || ''} ${medical_conditions || ''}`.trim()]
    );
  }

  const market = detectMarket(phone);
  const hinglish = isHinglish(market);

  const confirmParams = hinglish
    ? [name, 'Intake form mil gaya! Maddy ki team aapka program jald share karegi.']
    : [name, 'Intake form received! Maddy\'s team will share your program shortly.'];
  await sendWhatsApp(phone, 'intake_confirmed', confirmParams);

  return res.status(200).json({
    success: true,
    escalated: !!needsEscalation,
  });
};
