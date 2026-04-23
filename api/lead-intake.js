const { getSupabase } = require('./_lib/supabase');
const { sendWhatsApp } = require('./_lib/whatsapp');
const { corsHeaders, parseBody, detectMarket } = require('./_lib/utils');

module.exports = async function handler(req, res) {
  corsHeaders(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const body = await parseBody(req);
  const {
    lead_id, name, phone, email, age, gender,
    goal, injuries, diet_preference, schedule,
    experience_level, current_weight, target_weight,
    program
  } = body;

  if (!phone && !lead_id) {
    return res.status(400).json({ error: 'phone or lead_id required' });
  }

  const db = getSupabase();

  if (lead_id) {
    await db.from('leads').update({
      name: name || undefined,
      program_interest: program || undefined,
      last_msg_at: new Date().toISOString()
    }).eq('id', lead_id);

    const market = detectMarket(phone);
    const ack = market === 'IN'
      ? `Shukriya ${name || ''}! Aapka form mil gaya. Maddy ki team jaldi contact karegi \u{1F64F}`
      : `Thank you ${name || ''}! We've received your form. Maddy's team will reach out soon \u{1F64F}`;

    if (phone) await sendWhatsApp(phone, ack, 'intake_received');

    return res.status(200).json({ success: true, lead_id });
  }

  const market = detectMarket(phone);
  const { data: lead, error } = await db.from('leads').upsert({
    phone,
    name,
    source: 'intake_form',
    status: 'qualified',
    program_interest: program || goal,
    market,
    last_msg_at: new Date().toISOString()
  }, { onConflict: 'phone' }).select().single();

  if (error) {
    return res.status(500).json({ error: 'Failed to save intake' });
  }

  const ack = market === 'IN'
    ? `Shukriya ${name || ''}! Aapka form mil gaya. Maddy ki team jaldi contact karegi \u{1F64F}`
    : `Thank you ${name || ''}! We've received your form. Maddy's team will reach out soon \u{1F64F}`;

  await sendWhatsApp(phone, ack, 'intake_received');

  return res.status(200).json({ success: true, lead_id: lead?.id });
};
