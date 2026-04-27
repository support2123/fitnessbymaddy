const { supabase } = require('../lib/supabase');
const { sendTemplate, logIncoming } = require('../lib/whatsapp');
const { detectMarket, isHinglish, maskPhone } = require('../lib/market');
const { needsEscalation, escalateToMaddy } = require('../lib/escalation');
const { classifyIntent, getProgramCheckoutUrl, getProgramPrice } = require('../lib/classifier');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const payload = req.body;
    const phone = normalizePhone(payload.phone || payload.from || payload.sender);
    const message = payload.message || payload.text || payload.body || '';
    const senderName = payload.name || payload.sender_name || null;

    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    console.log(`[WA-IN] ${maskPhone(phone)}: ${message.slice(0, 80)}`);
    await logIncoming(phone, message);

    if (needsEscalation(message)) {
      await escalateToMaddy('Keyword trigger in lead message', phone, message.slice(0, 200));
    }

    const { intent, program } = classifyIntent(message);

    if (intent === 'opt_out') {
      await handleOptOut(phone);
      return res.json({ action: 'opted_out' });
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      return res.json(await handleNewLead(phone, message, senderName));
    }

    if (existingLead.status === 'dropped') {
      return res.json({ action: 'ignored_dropped' });
    }

    await supabase
      .from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('id', existingLead.id);

    if (intent === 'program_interest' && program) {
      return res.json(await handleProgramInterest(existingLead, program));
    }

    return res.json({ action: 'logged', intent });
  } catch (err) {
    console.error('[WA-WEBHOOK ERROR]', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function handleNewLead(phone, message, name) {
  const market = detectMarket(phone);
  const hinglish = isHinglish(market);

  const { data: lead } = await supabase
    .from('leads')
    .insert({
      phone,
      name,
      source: 'whatsapp',
      status: 'new',
      first_msg: message,
      market,
    })
    .select()
    .single();

  const templateName = hinglish ? 'welcome_v1_hi' : 'welcome_v1_en';
  await sendTemplate(phone, templateName, [name || 'there']);

  const { intent, program } = classifyIntent(message);
  if (intent === 'program_interest' && program) {
    await handleProgramInterest(lead, program);
  }

  return { action: 'new_lead', leadId: lead.id, market };
}

async function handleProgramInterest(lead, program) {
  const market = lead.market || detectMarket(lead.phone);
  const hinglish = isHinglish(market);
  const checkoutUrl = getProgramCheckoutUrl(program);
  const price = getProgramPrice(program);

  await supabase
    .from('leads')
    .update({ status: 'qualified', program_interest: program })
    .eq('id', lead.id);

  const intakeUrl = `https://fitnessbymaddy.com/intake.html?lead=${lead.id}`;
  const templateName = hinglish ? 'program_interest_hi' : 'program_interest_en';

  await sendTemplate(lead.phone, templateName, [
    lead.name || 'there',
    price,
    checkoutUrl,
    intakeUrl,
  ], false);

  return { action: 'qualified', program, leadId: lead.id };
}

async function handleOptOut(phone) {
  await supabase
    .from('leads')
    .update({ status: 'dropped' })
    .eq('phone', phone);

  await supabase
    .from('clients')
    .update({ status: 'paused' })
    .eq('phone', phone)
    .eq('status', 'active');
}

function normalizePhone(raw) {
  if (!raw) return null;
  let phone = raw.replace(/[^+\d]/g, '');
  if (!phone.startsWith('+')) phone = '+' + phone;
  return phone;
}
