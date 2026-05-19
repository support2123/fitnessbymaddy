const { supabase } = require('./_lib/supabase');
const { sendWhatsApp } = require('./_lib/whatsapp');
const { detectMarket, isHinglish, maskPhone } = require('./_lib/market');
const { needsEscalation, escalate } = require('./_lib/escalation');
const { matchProgram, getProgramDetails } = require('./_lib/programs');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { mobile, message, name } = parsePayload(req.body);
    if (!mobile) return res.status(400).json({ error: 'No phone number' });

    const phone = normalizePhone(mobile);
    const market = detectMarket(phone);
    const hinglish = isHinglish(market);

    await supabase.from('messages').insert({
      phone,
      direction: 'in',
      body: message,
      status: 'received'
    });

    if (isOptOut(message)) {
      await supabase.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.json({ action: 'opted_out' });
    }

    const trigger = needsEscalation(message);
    if (trigger) {
      await escalate(phone, trigger, message);
      const ackMsg = hinglish
        ? 'Aapka message Maddy ko forward kar diya hai. Woh jaldi se reply karengi.'
        : 'Your message has been forwarded to Maddy. She will respond personally.';
      await sendWhatsApp(phone, 'escalation_ack', [ackMsg]);
      return res.json({ action: 'escalated', trigger });
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .maybeSingle();

    if (!existingLead) {
      return await handleNewLead(phone, name, message, market, hinglish, res);
    }

    if (existingLead.status === 'dropped') {
      return res.json({ action: 'ignored_dropped' });
    }

    if (existingLead.status === 'new') {
      return await handleQualification(existingLead, message, hinglish, res);
    }

    await supabase.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('id', existingLead.id);
    return res.json({ action: 'logged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function handleNewLead(phone, name, message, market, hinglish, res) {
  await supabase.from('leads').insert({
    phone,
    name: name || null,
    source: 'whatsapp',
    status: 'new',
    first_msg: message,
    last_msg_at: new Date().toISOString(),
    market
  });

  const welcomeParams = hinglish
    ? ['Hi! Maddy ki team yahan se. Kaun sa goal hai - fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?']
    : ['Hi! Welcome to Fitness by Maddy. What is your goal - fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?'];

  await sendWhatsApp(phone, 'welcome_v1', welcomeParams);
  return res.json({ action: 'new_lead_welcomed' });
}

async function handleQualification(lead, message, hinglish, res) {
  const program = matchProgram(message);
  if (!program) {
    const clarifyParams = hinglish
      ? ['Kya aap bata sakte hain - fat loss, PCOS, 40+ fitness, ya 12-week custom program mein interest hai? Ya pehle $20 trial try karein?']
      : ['Could you tell me more - are you interested in fat loss, PCOS management, 40+ fitness, or a 12-week custom program? Or try a $20 trial first?'];
    await sendWhatsApp(lead.phone, 'clarify_goal', clarifyParams);
    return res.json({ action: 'asked_clarification' });
  }

  const details = getProgramDetails(program);

  await supabase.from('leads').update({
    status: 'qualified',
    program_interest: program,
    last_msg_at: new Date().toISOString()
  }).eq('id', lead.id);

  const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${lead.id}`;
  const intakeUrl = `https://www.fitnessbymaddy.com/intake?lead=${lead.id}`;

  const msgParams = hinglish
    ? [details.name, `$${details.price}`, checkoutUrl, intakeUrl]
    : [details.name, `$${details.price}`, checkoutUrl, intakeUrl];

  await sendWhatsApp(lead.phone, 'program_offer', msgParams);
  return res.json({ action: 'qualified', program });
}

function parsePayload(body) {
  if (!body) return {};
  if (body.mobile) return body;
  if (body.entry) {
    const change = body.entry?.[0]?.changes?.[0]?.value;
    const msg = change?.messages?.[0];
    if (msg) {
      return {
        mobile: msg.from,
        message: msg.text?.body || '',
        name: change.contacts?.[0]?.profile?.name || ''
      };
    }
  }
  return {};
}

function normalizePhone(phone) {
  return phone.replace(/[\s\-\(\)\+]/g, '').replace(/^0+/, '');
}

function isOptOut(message) {
  if (!message) return false;
  const lower = message.toLowerCase().trim();
  return ['stop', 'unsubscribe', 'opt out', 'cancel'].includes(lower);
}
