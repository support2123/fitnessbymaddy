const { getSupabase } = require('../lib/supabase');
const { sendWhatsAppMessage, sendTemplate } = require('../lib/whatsapp');
const { detectMarket, isHinglish, maskPhone } = require('../lib/market');
const { needsEscalation, notifyMaddy } = require('../lib/escalation');

const PROGRAM_ROUTES = [
  { keywords: ['fat loss', 'weight loss', 'weight', 'shred', 'fat', 'lean', 'cut'], program: '6wk_gym', label: '6-Week Burn & Build' },
  { keywords: ['pcos', 'hormonal', 'hormone', 'irregular period'], program: 'pcos', label: 'PCOS Warrior' },
  { keywords: ['40', 'menopause', 'joints', 'joint pain', 'over 40', '40+', 'fifty'], program: '40plus', label: '40+ Strong' },
  { keywords: ['custom', '12 week', '12wk', 'serious', 'flagship', 'personalised', 'personalized'], program: '12wk', label: '12-Week Flagship' },
  { keywords: ['trial', 'zoom', 'not sure', 'try', 'test'], program: 'zoom_trial', label: 'Zoom Trial' }
];

const OPT_OUT_KEYWORDS = ['stop', 'unsubscribe', 'opt out', 'opt-out', 'cancel'];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const payload = req.body;
    const phone = normalizePhone(payload.phone || payload.from || payload.sender);
    const message = (payload.message || payload.text || payload.body || '').trim();
    const name = payload.name || payload.pushName || null;

    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    const db = getSupabase();

    await db.from('messages').insert({
      phone, direction: 'in', body: message
    });

    if (isOptOut(message)) {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    const esc = needsEscalation(message);
    if (esc.escalate) {
      await notifyMaddy(
        (p, b) => sendWhatsAppMessage(p, b, '_internal_escalation'),
        esc.trigger,
        `Phone: ${maskPhone(phone)} | Message: ${message.slice(0, 200)}`
      );
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

    await db.from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('id', existingLead.id);

    if (existingLead.status === 'new') {
      return await handleQualification(db, existingLead, message, res);
    }

    return res.status(200).json({ action: 'logged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function handleNewLead(db, phone, name, message, res) {
  const market = detectMarket(phone);

  const { data: lead, error } = await db.from('leads').insert({
    phone, name, source: 'whatsapp', status: 'new',
    first_msg: message, market
  }).select().single();

  if (error) {
    if (error.code === '23505') {
      return res.status(200).json({ action: 'duplicate' });
    }
    throw error;
  }

  const welcomeMsg = isHinglish(market)
    ? "Hi! Maddy's team here. Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?"
    : "Hi! Maddy's team here. What's your goal — fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?";

  await sendWhatsAppMessage(phone, welcomeMsg, 'welcome_v1');

  return res.status(200).json({ action: 'new_lead', lead_id: lead.id });
}

async function handleQualification(db, lead, message, res) {
  const lower = message.toLowerCase();

  let matched = null;
  for (const route of PROGRAM_ROUTES) {
    if (route.keywords.some(kw => lower.includes(kw))) {
      matched = route;
      break;
    }
  }

  if (!matched) {
    const market = lead.market || detectMarket(lead.phone);
    const clarifyMsg = isHinglish(market)
      ? "Got it! Thoda aur batao — fat loss chahiye, PCOS help, 40+ fitness, ya full custom 12-week program? Ya pehle ek trial class try karo for just $20!"
      : "Got it! Could you tell me more — are you looking for fat loss, PCOS support, 40+ fitness, or a full custom 12-week program? Or try a trial session first for just $20!";
    await sendWhatsAppMessage(lead.phone, clarifyMsg);
    return res.status(200).json({ action: 'clarification_sent' });
  }

  await db.from('leads')
    .update({ status: 'qualified', program_interest: matched.program })
    .eq('id', lead.id);

  const market = lead.market || detectMarket(lead.phone);
  const hinglish = isHinglish(market);

  const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${lead.id}`;
  const intakeUrl = `https://www.fitnessbymaddy.com/intake.html?lead=${lead.id}`;

  const qualifyMsg = hinglish
    ? `Perfect! ${matched.label} program tumhare liye best rahega.\n\nCheckout link: ${checkoutUrl}\n\nAur yeh intake form bhi fill karo taaki Maddy tumhara plan customize kar sake:\n${intakeUrl}`
    : `Perfect! The ${matched.label} program would be ideal for you.\n\nCheckout link: ${checkoutUrl}\n\nAlso please fill out this intake form so Maddy can customise your plan:\n${intakeUrl}`;

  await sendWhatsAppMessage(lead.phone, qualifyMsg);

  return res.status(200).json({ action: 'qualified', program: matched.program });
}

function normalizePhone(phone) {
  if (!phone) return null;
  let cleaned = phone.replace(/[^0-9+]/g, '');
  if (!cleaned.startsWith('+')) cleaned = '+' + cleaned;
  return cleaned;
}

function isOptOut(message) {
  if (!message) return false;
  const lower = message.toLowerCase().trim();
  return OPT_OUT_KEYWORDS.some(kw => lower === kw || lower.startsWith(kw));
}
