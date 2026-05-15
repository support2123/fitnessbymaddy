const { supabase } = require('../lib/supabase');
const { sendWhatsApp, logIncomingMessage } = require('../lib/whatsapp');
const { detectMarket, isHinglish } = require('../lib/market');
const { needsEscalation, getEscalationReason, escalateToMaddy } = require('../lib/escalation');

const PROGRAM_ROUTES = [
  { keywords: ['fat loss', 'weight loss', 'weight', 'shred', 'lose fat', 'slim'], program: '6wk_gym', label: '6-Week Burn & Build' },
  { keywords: ['pcos', 'hormonal', 'hormone', 'pcod'], program: 'pcos', label: 'PCOS Warrior' },
  { keywords: ['40', 'menopause', 'joints', 'joint pain', 'over 40', '40+', 'forty'], program: '40plus', label: '40+ Strong' },
  { keywords: ['custom', '12 week', '12-week', 'serious', 'flagship', 'personalised', 'personalized'], program: '12wk', label: '12-Week Flagship' },
  { keywords: ['trial', 'zoom', 'not sure', 'try', 'confused', 'test'], program: 'zoom_trial', label: 'Zoom Trial' },
  { keywords: ['home', 'ghar', 'no gym', 'home workout'], program: '6wk_home', label: '6-Week Home Burn' },
];

const OPT_OUT_KEYWORDS = ['stop', 'unsubscribe', 'opt out', 'optout', 'cancel messages'];

function routeProgram(message) {
  const lower = message.toLowerCase();
  for (const route of PROGRAM_ROUTES) {
    if (route.keywords.some(kw => lower.includes(kw))) return route;
  }
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = req.body;
    const phone = body.phone || body.from || body.sender?.phone;
    const message = body.message || body.text || body.body || '';
    const name = body.name || body.sender?.name || null;

    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    await logIncomingMessage(phone, message);

    // Opt-out check
    if (OPT_OUT_KEYWORDS.some(kw => message.toLowerCase().includes(kw))) {
      await supabase.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    // Escalation check
    if (needsEscalation(message)) {
      const { data: client } = await supabase
        .from('clients').select('id').eq('phone', phone).single();

      await escalateToMaddy({
        phone,
        clientId: client?.id,
        reason: getEscalationReason(message),
        messageBody: message,
      });
      return res.status(200).json({ action: 'escalated' });
    }

    // Check if existing lead
    const { data: existingLead } = await supabase
      .from('leads').select('*').eq('phone', phone).single();

    const market = detectMarket(phone);
    const hinglish = isHinglish(market);

    if (!existingLead) {
      // FLOW A: New lead
      const { data: lead } = await supabase.from('leads').insert({
        phone,
        name,
        source: 'whatsapp',
        status: 'new',
        first_msg: message,
        market,
      }).select().single();

      const welcomeMsg = hinglish
        ? ["Hi! Maddy's team here. Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?"]
        : ["Hi! Maddy's team here. What's your goal — fat loss, PCOS management, strength, or 40+ fitness? Or try a trial session first?"];

      await sendWhatsApp({
        phone,
        templateName: 'welcome_v1',
        bodyValues: welcomeMsg,
      });

      return res.status(200).json({ action: 'new_lead', leadId: lead.id });
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'lead_dropped_ignored' });
    }

    // FLOW B: Lead qualification
    const route = routeProgram(message);

    if (route) {
      await supabase.from('leads').update({
        status: 'qualified',
        program_interest: route.program,
        last_msg_at: new Date().toISOString(),
      }).eq('id', existingLead.id);

      const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${existingLead.id}`;
      const intakeUrl = `https://fitnessbymaddy.com/intake?lead=${existingLead.id}`;

      const qualifyMsg = hinglish
        ? [`${route.label} program perfect hai tere liye! Yahan se checkout karo: ${checkoutUrl} — Aur yeh intake form bhi fill karo: ${intakeUrl}`]
        : [`The ${route.label} program is perfect for you! Check out here: ${checkoutUrl} — Also fill this intake form: ${intakeUrl}`];

      await sendWhatsApp({
        phone,
        templateName: 'qualify_route',
        bodyValues: qualifyMsg,
      });

      return res.status(200).json({ action: 'qualified', program: route.program });
    }

    // Update last message timestamp
    await supabase.from('leads').update({
      last_msg_at: new Date().toISOString(),
    }).eq('id', existingLead.id);

    return res.status(200).json({ action: 'message_logged' });

  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
