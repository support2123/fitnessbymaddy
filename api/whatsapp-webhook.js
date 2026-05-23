const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { needsEscalation, notifyMaddy } = require('../lib/escalation');
const {
  detectMarket,
  detectProgramInterest,
  getProgramName,
  getProgramCheckoutUrl,
  isHinglishMarket,
  parseBody,
  corsHeaders
} = require('../lib/utils');

module.exports = async function handler(req, res) {
  corsHeaders(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body = await parseBody(req);
  const phone = body.phone || body.mobile || body.from;
  const message = body.message || body.text || body.body || '';
  const name = body.name || body.pushName || null;

  if (!phone) return res.status(400).json({ error: 'Missing phone' });

  const db = getSupabase();

  await db.from('messages').insert({
    phone,
    direction: 'in',
    body: message,
    status: 'received'
  });

  const esc = needsEscalation(message);
  if (esc.escalate) {
    await notifyMaddy('Escalation keyword detected in message', {
      phone,
      clientName: name,
      details: `Keyword: "${esc.trigger}" — Message: "${message}"`
    });
    return res.status(200).json({ action: 'escalated', trigger: esc.trigger });
  }

  if (/^(stop|unsubscribe|opt.?out)$/i.test(message.trim())) {
    await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
    return res.status(200).json({ action: 'opted_out' });
  }

  const { data: existingLead } = await db
    .from('leads')
    .select('*')
    .eq('phone', phone)
    .single();

  if (!existingLead) {
    return await handleNewLead(db, phone, name, message, res);
  }

  if (existingLead.status === 'dropped') {
    return res.status(200).json({ action: 'ignored_dropped' });
  }

  if (existingLead.status === 'new') {
    return await handleQualification(db, existingLead, message, res);
  }

  await db.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('id', existingLead.id);
  return res.status(200).json({ action: 'updated' });
};

async function handleNewLead(db, phone, name, message, res) {
  const market = detectMarket(phone);

  const { data: lead } = await db.from('leads').insert({
    phone,
    name,
    source: 'whatsapp',
    status: 'new',
    first_msg: message,
    last_msg_at: new Date().toISOString(),
    market
  }).select().single();

  const hinglish = isHinglishMarket(market);
  const welcomeParams = hinglish
    ? [name || 'there']
    : [name || 'there'];

  await sendWhatsApp(phone, 'welcome_v1', welcomeParams);

  const interest = detectProgramInterest(message);
  if (interest) {
    await db.from('leads').update({
      program_interest: interest,
      status: 'qualified'
    }).eq('id', lead.id);

    const programName = getProgramName(interest);
    const checkoutUrl = getProgramCheckoutUrl(interest);

    await sendWhatsApp(phone, 'program_recommendation', [
      name || 'there',
      programName,
      checkoutUrl,
      `https://fitnessbymaddy.com/intake.html?lead=${lead.id}`
    ]);

    return res.status(200).json({ action: 'new_lead_qualified', program: interest });
  }

  return res.status(200).json({ action: 'new_lead_created', leadId: lead.id });
}

async function handleQualification(db, lead, message, res) {
  const interest = detectProgramInterest(message);

  if (!interest) {
    await db.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('id', lead.id);
    return res.status(200).json({ action: 'no_match' });
  }

  await db.from('leads').update({
    program_interest: interest,
    status: 'qualified',
    last_msg_at: new Date().toISOString()
  }).eq('id', lead.id);

  const programName = getProgramName(interest);
  const checkoutUrl = getProgramCheckoutUrl(interest);
  const hinglish = isHinglishMarket(lead.market);

  await sendWhatsApp(lead.phone, 'program_recommendation', [
    lead.name || 'there',
    programName,
    checkoutUrl,
    `https://fitnessbymaddy.com/intake.html?lead=${lead.id}`
  ]);

  return res.status(200).json({ action: 'qualified', program: interest });
}
