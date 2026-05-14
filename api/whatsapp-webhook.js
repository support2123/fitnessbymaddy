const { supabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');
const { detectMarket, isHinglish, maskPhone } = require('../lib/market');
const { needsEscalation, escalateToMaddy, isOptOut } = require('../lib/escalation');

const PROGRAM_ROUTES = [
  { keywords: ['fat loss', 'weight loss', 'weight', 'shred', 'lean', 'cut'], program: '6wk_gym', label: '6-Week Burn & Build' },
  { keywords: ['pcos', 'hormonal', 'hormone', 'pcod'], program: 'pcos', label: 'PCOS Warrior' },
  { keywords: ['40', 'forty', 'menopause', 'joints', 'joint pain', 'senior'], program: '40plus', label: '40+ Strong' },
  { keywords: ['custom', '12 week', '12-week', 'serious', 'flagship', 'full program'], program: '12wk', label: '12-Week Custom Training' },
  { keywords: ['trial', 'zoom', 'not sure', 'try', 'test'], program: 'zoom_trial', label: 'Zoom Trial' }
];

const CHECKOUT_BASE = 'https://fitnessbymaddyy.exlyapp.com/checkout';

function routeToProgram(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  for (const route of PROGRAM_ROUTES) {
    if (route.keywords.some(kw => lower.includes(kw))) return route;
  }
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const payload = req.body;
    const phone = payload.phone || payload.from || payload.sender;
    const messageText = payload.text || payload.message || payload.body || '';

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    await supabase.from('messages').insert({
      phone,
      direction: 'in',
      body: messageText,
      sent_at: new Date().toISOString(),
      status: 'received'
    });

    if (isOptOut(messageText)) {
      await supabase.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      console.log(`Opt-out: ${maskPhone(phone)}`);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(messageText)) {
      await escalateToMaddy(
        'Keyword trigger in message',
        `Phone: ${maskPhone(phone)}\nMessage: ${messageText.slice(0, 200)}`
      );
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      const market = detectMarket(phone);
      const { data: newLead } = await supabase.from('leads').insert({
        phone,
        name: payload.name || null,
        source: 'whatsapp',
        status: 'new',
        first_msg: messageText,
        last_msg_at: new Date().toISOString(),
        market
      }).select().single();

      const hinglish = isHinglish(market);
      const templateName = hinglish ? 'welcome_v1_hi' : 'welcome_v1';

      await sendTemplate(phone, templateName, [
        newLead.name || 'there'
      ], true);

      return res.status(200).json({ action: 'new_lead', lead_id: newLead.id });
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'ignored_dropped' });
    }

    await supabase.from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('id', existingLead.id);

    if (existingLead.status === 'new') {
      const route = routeToProgram(messageText);
      if (route) {
        await supabase.from('leads')
          .update({ status: 'qualified', program_interest: route.program })
          .eq('id', existingLead.id);

        const market = existingLead.market || detectMarket(phone);
        const hinglish = isHinglish(market);

        const checkoutUrl = `${CHECKOUT_BASE}/${route.program}`;
        const intakeUrl = `https://www.fitnessbymaddy.com/intake?lead=${existingLead.id}`;

        const templateName = hinglish ? 'program_offer_hi' : 'program_offer';
        await sendTemplate(phone, templateName, [
          existingLead.name || 'there',
          route.label,
          checkoutUrl,
          intakeUrl
        ], true);

        return res.status(200).json({ action: 'qualified', program: route.program });
      }
    }

    return res.status(200).json({ action: 'message_logged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
