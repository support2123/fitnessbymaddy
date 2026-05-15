const supabase = require('./_lib/supabase');
const { sendTemplate, sendText, logMessage } = require('./_lib/whatsapp');
const { detectMarket, isHinglish, maskPhone } = require('./_lib/market');
const { checkEscalation, isOptOut, notifyMaddy } = require('./_lib/escalation');
const cors = require('./_lib/cors');

const PROGRAM_ROUTES = [
  { keys: ['fat loss', 'weight', 'shred', 'lose weight', 'slim'], program: '6wk_gym', label: '6-Week Burn & Build' },
  { keys: ['pcos', 'hormonal', 'hormone'], program: 'pcos', label: 'PCOS Warrior' },
  { keys: ['40', 'menopause', 'joints', 'joint pain', 'over 40'], program: '40plus', label: '40+ Strong' },
  { keys: ['custom', '12 week', 'serious', 'flagship', 'personalised', 'personalized'], program: '12wk', label: '12-Week Flagship' },
  { keys: ['trial', 'zoom', 'not sure', 'try', 'test'], program: 'zoom_trial', label: 'Zoom Trial' }
];

const CHECKOUT_BASE = 'https://fitnessbymaddyy.exlyapp.com/checkout';
const SITE_BASE = 'https://fitnessbymaddy.com';

module.exports = async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { senderName, senderMobile, message } = req.body;
    const phone = normalizePhone(senderMobile);
    if (!phone) return res.status(400).json({ error: 'missing phone' });

    await logMessage(phone, 'in', message, null);

    if (isOptOut(message)) {
      await supabase.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.json({ action: 'opted_out' });
    }

    const esc = checkEscalation(message);
    if (esc.escalate) {
      await notifyMaddy(
        `Escalation trigger: "${esc.trigger}"`,
        `Phone: ${maskPhone(phone)}\nMessage: ${message}`
      );
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      return await handleNewLead(phone, senderName, message, res);
    }

    await supabase.from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('phone', phone);

    if (existingLead.status === 'new') {
      return await handleQualification(phone, message, existingLead, res);
    }

    return res.json({ action: 'logged', status: existingLead.status });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'internal' });
  }
};

async function handleNewLead(phone, name, message, res) {
  const market = detectMarket(phone);

  await supabase.from('leads').insert({
    phone,
    name: name || null,
    source: 'whatsapp',
    status: 'new',
    first_msg: message,
    last_msg_at: new Date().toISOString(),
    market
  });

  if (isHinglish(market)) {
    await sendTemplate(phone, 'welcome_v1', [name || 'there']);
  } else {
    await sendTemplate(phone, 'welcome_v1_en', [name || 'there']);
  }

  return res.json({ action: 'new_lead', market });
}

async function handleQualification(phone, message, lead, res) {
  const lower = (message || '').toLowerCase();
  let matched = null;

  for (const route of PROGRAM_ROUTES) {
    if (route.keys.some(k => lower.includes(k))) {
      matched = route;
      break;
    }
  }

  if (!matched) {
    return res.json({ action: 'no_match', awaiting: 'keyword' });
  }

  await supabase.from('leads')
    .update({
      status: 'qualified',
      program_interest: matched.program
    })
    .eq('phone', phone);

  const market = lead.market || detectMarket(phone);
  const checkoutUrl = `${CHECKOUT_BASE}/${matched.program}`;
  const intakeUrl = `${SITE_BASE}/intake.html?lead=${lead.id}`;

  if (isHinglish(market)) {
    await sendText(phone,
      `Great choice! ${matched.label} program aapke liye perfect hai.\n\n` +
      `Payment link: ${checkoutUrl}\n\n` +
      `Aur ye intake form bhi fill kar do taaki hum aapka plan customize kar sakein:\n${intakeUrl}`
    );
  } else {
    await sendText(phone,
      `Great choice! The ${matched.label} program is perfect for your goals.\n\n` +
      `Payment link: ${checkoutUrl}\n\n` +
      `Please also fill out this intake form so we can customise your plan:\n${intakeUrl}`
    );
  }

  return res.json({ action: 'qualified', program: matched.program });
}

function normalizePhone(phone) {
  if (!phone) return null;
  let cleaned = phone.replace(/[^0-9+]/g, '');
  if (!cleaned.startsWith('+')) cleaned = '+' + cleaned;
  return cleaned;
}
