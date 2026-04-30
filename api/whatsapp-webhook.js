const { supabase } = require('../lib/supabase');
const { sendTemplate, logMessage } = require('../lib/whatsapp');
const { detectMarket, isHinglish } = require('../lib/market');
const { needsEscalation, escalateToMaddy } = require('../lib/escalation');

const PROGRAM_ROUTES = {
  'fat loss': '6wk_gym', weight: '6wk_gym', shred: '6wk_gym',
  pcos: 'pcos', hormonal: 'pcos',
  '40': '40plus', menopause: '40plus', joints: '40plus',
  custom: '12wk', '12 week': '12wk', serious: '12wk',
  trial: 'zoom_trial', zoom: 'zoom_trial', 'not sure': 'zoom_trial',
};

const CHECKOUT_URLS = {
  '6wk_gym': 'https://fitnessbymaddyy.exlyapp.com/checkout/6wk-shred',
  '6wk_home': 'https://fitnessbymaddyy.exlyapp.com/checkout/6wk-home',
  '12wk': 'https://fitnessbymaddyy.exlyapp.com/checkout/12wk-custom',
  pcos: 'https://fitnessbymaddyy.exlyapp.com/checkout/pcos-warrior',
  '40plus': 'https://fitnessbymaddyy.exlyapp.com/checkout/40plus-strong',
  zoom_trial: 'https://fitnessbymaddyy.exlyapp.com/checkout/zoom-trial',
  zoom_pack: 'https://fitnessbymaddyy.exlyapp.com/checkout/zoom-pack',
};

const PROGRAM_NAMES = {
  '6wk_gym': '6-Week Burn & Build (Gym)',
  '6wk_home': '6-Week Burn & Build (Home)',
  '12wk': '12-Week Custom Flagship',
  pcos: 'PCOS Warrior',
  '40plus': '40+ Strong',
  zoom_trial: 'Zoom Trial Session',
  zoom_pack: 'Zoom Pack',
};

const STOP_WORDS = ['stop', 'unsubscribe', 'cancel', 'opt out', 'optout'];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { mobile, message, name } = parsePayload(req.body);
    if (!mobile) return res.status(400).json({ error: 'No phone number' });

    const phone = normalizePhone(mobile);
    const msgBody = (message || '').trim();

    await logMessage(phone, 'in', msgBody, null);

    if (STOP_WORDS.some(w => msgBody.toLowerCase().includes(w))) {
      await supabase.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(msgBody)) {
      await escalateToMaddy('Keyword trigger in message', phone, msgBody);
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .limit(1)
      .single();

    if (!existingLead) {
      return await handleNewLead(phone, name, msgBody, res);
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'ignored_dropped' });
    }

    if (existingLead.status === 'new') {
      return await handleQualification(existingLead, msgBody, res);
    }

    await supabase
      .from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('id', existingLead.id);

    return res.status(200).json({ action: 'message_logged' });
  } catch (err) {
    console.error('[whatsapp-webhook]', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function handleNewLead(phone, name, firstMsg, res) {
  const market = detectMarket(phone);

  const { data: lead } = await supabase
    .from('leads')
    .insert({
      phone,
      name: name || null,
      source: 'whatsapp',
      status: 'new',
      first_msg: firstMsg,
      last_msg_at: new Date().toISOString(),
      market,
    })
    .select()
    .single();

  if (isHinglish(market)) {
    await sendTemplate(phone, 'welcome_v1', [name || 'there']);
  } else {
    await sendTemplate(phone, 'welcome_v1_en', [name || 'there']);
  }

  return res.status(200).json({ action: 'new_lead', leadId: lead?.id });
}

async function handleQualification(lead, msgBody, res) {
  const lower = msgBody.toLowerCase();
  let matchedProgram = null;

  for (const [keyword, program] of Object.entries(PROGRAM_ROUTES)) {
    if (lower.includes(keyword)) {
      matchedProgram = program;
      break;
    }
  }

  if (!matchedProgram) {
    return res.status(200).json({ action: 'awaiting_qualification' });
  }

  await supabase
    .from('leads')
    .update({
      status: 'qualified',
      program_interest: matchedProgram,
      last_msg_at: new Date().toISOString(),
    })
    .eq('id', lead.id);

  const checkoutUrl = CHECKOUT_URLS[matchedProgram];
  const programName = PROGRAM_NAMES[matchedProgram];
  const intakeUrl = `https://fitnessbymaddy.com/intake?lead=${lead.id}`;

  if (isHinglish(lead.market)) {
    await sendTemplate(lead.phone, 'program_qualified', [
      lead.name || 'there',
      programName,
      checkoutUrl,
      intakeUrl,
    ]);
  } else {
    await sendTemplate(lead.phone, 'program_qualified_en', [
      lead.name || 'there',
      programName,
      checkoutUrl,
      intakeUrl,
    ]);
  }

  return res.status(200).json({ action: 'qualified', program: matchedProgram });
}

function parsePayload(body) {
  if (body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]) {
    const msg = body.entry[0].changes[0].value.messages[0];
    const contact = body.entry[0].changes[0].value.contacts?.[0];
    return {
      mobile: msg.from,
      message: msg.text?.body || '',
      name: contact?.profile?.name || null,
    };
  }

  return {
    mobile: body?.mobile || body?.phone || body?.from,
    message: body?.message || body?.text || body?.body || '',
    name: body?.name || body?.pushName || null,
  };
}

function normalizePhone(phone) {
  return phone.replace(/\D/g, '').replace(/^0+/, '');
}
