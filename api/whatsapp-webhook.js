const { getSupabase } = require('./lib/supabase');
const { detectMarket, isHinglish } = require('./lib/market');
const { needsEscalation, getEscalationReason, maskPhone } = require('./lib/escalation');
const { sendTemplate, logMessage, notifyMaddy } = require('./lib/whatsapp');

const PROGRAM_ROUTES = {
  'fat loss': '6wk_gym', 'weight': '6wk_gym', 'shred': '6wk_gym',
  'weight loss': '6wk_gym', 'lose weight': '6wk_gym', 'patla': '6wk_gym',
  'pcos': 'pcos', 'hormonal': 'pcos', 'pcod': 'pcos',
  '40': '40plus', 'menopause': '40plus', 'joints': '40plus', '40+': '40plus',
  'custom': '12wk', '12 week': '12wk', 'serious': '12wk', 'flagship': '12wk',
  'trial': 'zoom_trial', 'zoom': 'zoom_trial', 'not sure': 'zoom_trial', 'try': 'zoom_trial'
};

const PROGRAM_NAMES = {
  '6wk_gym': '6-Week Burn & Build',
  '6wk_home': '6-Week Home Shred',
  '12wk': '12-Week Flagship Program',
  'pcos': 'PCOS Warrior Program',
  '40plus': '40+ Strong Program',
  'zoom_trial': 'Zoom Trial Session',
  'zoom_pack': 'Zoom Session Pack'
};

const PROGRAM_PRICES = {
  '6wk_gym': '$97', '6wk_home': '$97', '12wk': '$200',
  'pcos': '$45', '40plus': '$50', 'zoom_trial': '$20', 'zoom_pack': '$99'
};

const OPT_OUT_KEYWORDS = ['stop', 'unsubscribe', 'opt out', 'cancel', 'quit'];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = req.body;
    const phone = extractPhone(body);
    const name = extractName(body);
    const messageBody = extractMessage(body);

    if (!phone || !messageBody) {
      return res.status(400).json({ error: 'Missing phone or message' });
    }

    await logMessage(phone, 'in', messageBody, null);

    if (isOptOut(messageBody)) {
      await handleOptOut(phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(messageBody)) {
      const reasons = getEscalationReason(messageBody);
      await notifyMaddy(
        'Lead/Client needs attention',
        `Phone: ${maskPhone(phone)}\nMessage: ${messageBody.substring(0, 300)}\nFlags: ${reasons.join(', ')}`
      );
    }

    const supabase = getSupabase();
    const { data: existingClient } = await supabase
      .from('clients')
      .select('id, status')
      .eq('phone', phone)
      .eq('status', 'active')
      .limit(1)
      .single();

    if (existingClient) {
      return res.status(200).json({ action: 'client_message_logged' });
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .limit(1)
      .single();

    if (existingLead) {
      if (existingLead.status === 'dropped') {
        return res.status(200).json({ action: 'dropped_lead_ignored' });
      }
      await handleExistingLead(supabase, existingLead, messageBody, phone);
      return res.status(200).json({ action: 'lead_qualified' });
    }

    await handleNewLead(supabase, phone, name, messageBody);
    return res.status(200).json({ action: 'new_lead_created' });

  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function extractPhone(body) {
  return body?.phone || body?.mobile || body?.from || body?.sender?.phone || body?.contact?.phone || '';
}

function extractName(body) {
  return body?.name || body?.sender?.name || body?.contact?.name || '';
}

function extractMessage(body) {
  return body?.message || body?.text || body?.body || body?.message?.text || '';
}

function isOptOut(msg) {
  const lower = msg.toLowerCase().trim();
  return OPT_OUT_KEYWORDS.some(kw => lower === kw || lower.startsWith(kw));
}

async function handleOptOut(phone) {
  const supabase = getSupabase();
  await supabase.from('leads').update({ status: 'dropped' }).eq('phone', phone);
}

async function handleNewLead(supabase, phone, name, message) {
  const market = detectMarket(phone);

  await supabase.from('leads').insert({
    phone,
    name: name || null,
    source: 'whatsapp',
    status: 'new',
    first_msg: message.substring(0, 1000),
    last_msg_at: new Date().toISOString(),
    market
  });

  if (isHinglish(market)) {
    await sendTemplate(phone, 'welcome_v1', {
      name: name || 'there',
      templateParams: [name || 'there']
    });
  } else {
    await sendTemplate(phone, 'welcome_v1_en', {
      name: name || 'there',
      templateParams: [name || 'there']
    });
  }
}

async function handleExistingLead(supabase, lead, message, phone) {
  const lower = message.toLowerCase();
  let matchedProgram = null;

  for (const [keyword, program] of Object.entries(PROGRAM_ROUTES)) {
    if (lower.includes(keyword)) {
      matchedProgram = program;
      break;
    }
  }

  if (!matchedProgram) return;

  await supabase.from('leads').update({
    status: 'qualified',
    program_interest: matchedProgram,
    last_msg_at: new Date().toISOString()
  }).eq('id', lead.id);

  const market = detectMarket(phone);
  const programName = PROGRAM_NAMES[matchedProgram];
  const price = PROGRAM_PRICES[matchedProgram];
  const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${matchedProgram}`;
  const intakeUrl = `https://www.fitnessbymaddy.com/intake.html?lead=${lead.id}`;

  if (isHinglish(market)) {
    await sendTemplate(phone, 'program_match', {
      name: lead.name || 'there',
      templateParams: [
        lead.name || 'there',
        programName,
        price,
        checkoutUrl,
        intakeUrl
      ]
    });
  } else {
    await sendTemplate(phone, 'program_match_en', {
      name: lead.name || 'there',
      templateParams: [
        lead.name || 'there',
        programName,
        price,
        checkoutUrl,
        intakeUrl
      ]
    });
  }
}
