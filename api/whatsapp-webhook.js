const { supabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');
const { detectMarket, isHinglish } = require('../lib/market');
const { shouldEscalate, getEscalationReason, escalate } = require('../lib/escalation');

const PROGRAM_ROUTES = {
  '6wk_gym': { keywords: ['fat loss', 'weight loss', 'weight', 'shred', 'fat', 'lean', 'cut'], price: 97 },
  'pcos': { keywords: ['pcos', 'hormonal', 'hormone', 'pcod', 'irregular period'], price: 45 },
  '40plus': { keywords: ['40', 'forty', 'menopause', 'joints', 'joint pain', 'senior'], price: 50 },
  '12wk': { keywords: ['custom', '12 week', '12wk', 'serious', 'flagship', 'personalised', 'personalized'], price: 200 },
  'zoom_trial': { keywords: ['trial', 'zoom', 'not sure', 'try', 'test', 'sample'], price: 20 },
};

const OPT_OUT_KEYWORDS = ['stop', 'unsubscribe', 'opt out', 'optout', 'cancel messages'];

function routeToProgram(message) {
  const lower = (message || '').toLowerCase();
  for (const [program, config] of Object.entries(PROGRAM_ROUTES)) {
    if (config.keywords.some(kw => lower.includes(kw))) {
      return { program, price: config.price };
    }
  }
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const payload = req.body;
    const phone = payload.phone || payload.from || payload.waId;
    const message = payload.text || payload.message || payload.body || '';
    const name = payload.name || payload.pushName || null;

    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    await supabase.from('messages').insert({
      phone,
      direction: 'in',
      body: message,
    });

    const lower = (message || '').toLowerCase();
    if (OPT_OUT_KEYWORDS.some(kw => lower.includes(kw))) {
      await supabase.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.json({ action: 'opted_out' });
    }

    if (shouldEscalate(message)) {
      const reason = getEscalationReason(message);
      const { data: client } = await supabase
        .from('clients').select('id').eq('phone', phone).single();
      await escalate(phone, reason, message, client?.id);
    }

    const { data: existingLead } = await supabase
      .from('leads').select('*').eq('phone', phone).single();

    if (!existingLead) {
      const market = detectMarket(phone);
      await supabase.from('leads').insert({
        phone,
        name,
        source: 'whatsapp',
        status: 'new',
        first_msg: message,
        market,
      });

      const welcomeTemplate = isHinglish(market) ? 'welcome_v1_hi' : 'welcome_v1_en';
      await sendTemplate(phone, welcomeTemplate, [name || 'there']);

      return res.json({ action: 'new_lead_welcomed', market });
    }

    if (existingLead.status === 'dropped') {
      return res.json({ action: 'ignored_dropped_lead' });
    }

    await supabase.from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('id', existingLead.id);

    const route = routeToProgram(message);
    if (route) {
      await supabase.from('leads')
        .update({ status: 'qualified', program_interest: route.program })
        .eq('id', existingLead.id);

      const market = existingLead.market || 'IN';
      const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${route.program}`;
      const intakeUrl = `https://www.fitnessbymaddy.com/intake?lead=${existingLead.id}`;

      if (isHinglish(market)) {
        await sendTemplate(phone, 'program_offer_hi', [
          name || existingLead.name || 'there',
          route.program,
          `$${route.price}`,
          checkoutUrl,
          intakeUrl,
        ]);
      } else {
        await sendTemplate(phone, 'program_offer_en', [
          name || existingLead.name || 'there',
          route.program,
          `$${route.price}`,
          checkoutUrl,
          intakeUrl,
        ]);
      }

      return res.json({ action: 'qualified', program: route.program });
    }

    return res.json({ action: 'message_logged' });
  } catch (err) {
    console.error('whatsapp-webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
