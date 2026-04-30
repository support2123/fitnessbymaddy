const { supabase } = require('./_lib/supabase');
const { sendWhatsApp } = require('./_lib/whatsapp');
const { detectMarket, isHinglish } = require('./_lib/market');
const { needsEscalation, isOptOut, escalateToMaddy } = require('./_lib/escalation');
const { KEYWORD_ROUTES, PROGRAMS } = require('./_lib/constants');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { phone, message, name } = parsePayload(req.body);
    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    await supabase.from('messages').insert({
      phone, direction: 'in', body: message
    });

    if (isOptOut(message)) {
      await supabase.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.json({ action: 'opted_out' });
    }

    if (needsEscalation(message)) {
      await escalateToMaddy(phone, 'keyword_trigger', message);
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (existingLead && existingLead.status === 'dropped') {
      return res.json({ action: 'dropped_lead_ignored' });
    }

    if (!existingLead) {
      return await handleNewLead(phone, message, name, res);
    }

    if (existingLead.status === 'new') {
      return await handleQualification(existingLead, message, res);
    }

    return res.json({ action: 'existing_lead', status: existingLead.status });
  } catch (err) {
    console.error('Webhook error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function handleNewLead(phone, message, name, res) {
  const market = detectMarket(phone);

  await supabase.from('leads').insert({
    phone, name: name || null, source: 'whatsapp',
    status: 'new', first_msg: message, market
  });

  const greeting = isHinglish(market)
    ? "Hi! Maddy's team here. Kaun sa goal hai - fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?"
    : "Hi! Maddy's team here. What's your goal - fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?";

  await sendWhatsApp(phone, greeting, 'welcome_v1');

  return res.json({ action: 'new_lead_created', market });
}

async function handleQualification(lead, message, res) {
  const lower = (message || '').toLowerCase();
  let matchedProgram = null;

  for (const route of KEYWORD_ROUTES) {
    if (route.keywords.some(kw => lower.includes(kw))) {
      matchedProgram = route.program;
      break;
    }
  }

  if (!matchedProgram) {
    return res.json({ action: 'no_keyword_match', status: 'new' });
  }

  const programInfo = PROGRAMS[matchedProgram];
  await supabase.from('leads').update({
    status: 'qualified',
    program_interest: matchedProgram,
    last_msg_at: new Date().toISOString()
  }).eq('id', lead.id);

  const market = lead.market || 'GLOBAL';
  const priceStr = '$' + (programInfo.price / 100);
  const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${lead.id}`;
  const intakeUrl = `https://fitnessbymaddy.com/intake?lead=${lead.id}`;

  const msg = isHinglish(market)
    ? `${programInfo.name} - bilkul sahi choice! Price: ${priceStr}\n\nCheckout: ${checkoutUrl}\n\nPehle ye short form bhar do taaki hum aapke liye best plan bana sake:\n${intakeUrl}`
    : `Great choice - ${programInfo.name}! Price: ${priceStr}\n\nCheckout here: ${checkoutUrl}\n\nPlease fill this quick intake form so we can build the best plan for you:\n${intakeUrl}`;

  await sendWhatsApp(lead.phone, msg, 'program_offer');

  return res.json({ action: 'qualified', program: matchedProgram });
}

function parsePayload(body) {
  if (!body) return {};
  if (body.phone) return body;
  if (body.data) {
    return {
      phone: body.data.from || body.data.phone,
      message: body.data.text || body.data.message || body.data.body,
      name: body.data.name || body.data.pushName
    };
  }
  if (body.entry) {
    const change = body.entry?.[0]?.changes?.[0]?.value;
    const msg = change?.messages?.[0];
    const contact = change?.contacts?.[0];
    return {
      phone: msg?.from ? '+' + msg.from : null,
      message: msg?.text?.body || '',
      name: contact?.profile?.name || null
    };
  }
  return body;
}
