const { supabase } = require('../lib/supabase');
const { sendTemplate, logMessage, notifyMaddy } = require('../lib/whatsapp');
const { detectMarket, maskPhone } = require('../lib/market');
const { checkEscalation, checkOptOut } = require('../lib/escalation');

const PROGRAM_KEYWORDS = {
  '6wk_gym': ['fat loss', 'weight loss', 'weight', 'shred', 'burn', 'lean', 'fat'],
  'pcos': ['pcos', 'hormonal', 'hormone', 'irregular period'],
  '40plus': ['40', 'forty', 'menopause', 'joints', 'joint pain', 'over 40'],
  '12wk': ['custom', '12 week', 'twelve week', 'serious', 'personali', 'flagship'],
  'zoom_trial': ['trial', 'zoom', 'not sure', 'try', 'test'],
};

const PROGRAM_NAMES = {
  '6wk_gym': '6-Week Burn & Build',
  'pcos': 'PCOS Warrior Program',
  '40plus': '40+ Strong Program',
  '12wk': '12-Week Flagship Program',
  'zoom_trial': 'Zoom Trial Session',
};

module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && token === process.env.WA_VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }
    return res.status(403).json({ error: 'Verification failed' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { phone, name, message } = extractMessage(req.body);
    if (!phone || !message) {
      return res.status(200).json({ status: 'no_message' });
    }

    await logMessage(phone, 'in', message, null);

    if (checkOptOut(message)) {
      await supabase.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      console.log(`Opt-out: ${maskPhone(phone)}`);
      return res.status(200).json({ status: 'opted_out' });
    }

    const escalation = checkEscalation(message);
    if (escalation.escalate) {
      await notifyMaddy(escalation.reason, `Phone: ${maskPhone(phone)}, Message: ${message.slice(0, 200)}`);
    }

    const { data: existingClient } = await supabase
      .from('clients')
      .select('id, status')
      .eq('phone', phone)
      .eq('status', 'active')
      .limit(1)
      .single();

    if (existingClient) {
      if (escalation.escalate) {
        await notifyMaddy(
          `Active client escalation: ${escalation.reason}`,
          `Client ID: ${existingClient.id}, Message: ${message.slice(0, 200)}`
        );
      }
      return res.status(200).json({ status: 'client_message_logged' });
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .limit(1)
      .single();

    if (existingLead) {
      if (existingLead.status === 'dropped') {
        return res.status(200).json({ status: 'lead_dropped' });
      }
      await handleLeadReply(existingLead, message);
      return res.status(200).json({ status: 'lead_qualified' });
    }

    const market = detectMarket(phone);
    const { data: newLead } = await supabase.from('leads').insert({
      phone,
      name: name || null,
      source: 'whatsapp',
      status: 'new',
      first_msg: message.slice(0, 500),
      last_msg_at: new Date().toISOString(),
      market,
    }).select().single();

    await sendTemplate(phone, 'welcome_v1', [name || 'there']);

    if (escalation.escalate) {
      await notifyMaddy(escalation.reason, `New lead ${maskPhone(phone)}: ${message.slice(0, 200)}`);
    }

    return res.status(200).json({ status: 'new_lead', lead_id: newLead?.id });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(200).json({ status: 'error_handled' });
  }
};

function extractMessage(body) {
  if (body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]) {
    const val = body.entry[0].changes[0].value;
    const msg = val.messages[0];
    return {
      phone: msg.from,
      name: val.contacts?.[0]?.profile?.name || null,
      message: msg.text?.body || msg.button?.text || '',
    };
  }

  if (body?.phone && body?.message) {
    return { phone: body.phone, name: body.name || null, message: body.message };
  }

  if (body?.mobile && (body?.text || body?.message)) {
    return { phone: body.mobile, name: body.name || null, message: body.text || body.message };
  }

  return { phone: null, name: null, message: null };
}

async function handleLeadReply(lead, message) {
  const lower = message.toLowerCase();
  let matchedProgram = null;

  for (const [program, keywords] of Object.entries(PROGRAM_KEYWORDS)) {
    for (const kw of keywords) {
      if (lower.includes(kw)) {
        matchedProgram = program;
        break;
      }
    }
    if (matchedProgram) break;
  }

  if (!matchedProgram) matchedProgram = 'zoom_trial';

  await supabase.from('leads').update({
    status: 'qualified',
    program_interest: matchedProgram,
    last_msg_at: new Date().toISOString(),
  }).eq('id', lead.id);

  const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${matchedProgram}`;
  const intakeUrl = `https://fitnessbymaddy.com/intake.html?lead=${lead.id}`;
  const programName = PROGRAM_NAMES[matchedProgram];

  await sendTemplate(lead.phone, 'program_match', [
    lead.name || 'there',
    programName,
    checkoutUrl,
    intakeUrl,
  ]);
}
