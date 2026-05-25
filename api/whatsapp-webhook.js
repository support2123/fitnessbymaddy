const { getClient } = require('../lib/supabase');
const { sendMessage, logIncoming } = require('../lib/whatsapp');
const { detectMarket, isHinglish } = require('../lib/market');
const { needsEscalation, escalateToMaddy } = require('../lib/escalation');

const PROGRAM_ROUTES = [
  { keywords: ['fat loss', 'weight', 'shred', 'lose', 'slim'], program: '6wk_gym', label: '6-Week Burn & Build' },
  { keywords: ['pcos', 'hormonal', 'hormone', 'pcod'], program: 'pcos', label: 'PCOS Warrior' },
  { keywords: ['40', 'menopause', 'joints', 'joint', 'knee'], program: '40plus', label: '40+ Strong' },
  { keywords: ['custom', '12 week', '12wk', 'serious', 'flagship', 'personalised'], program: '12wk', label: '12-Week Custom Program' },
  { keywords: ['trial', 'zoom', 'not sure', 'try', 'test'], program: 'zoom_trial', label: 'Zoom Trial Session' }
];

function routeProgram(text) {
  const lower = (text || '').toLowerCase();
  for (const route of PROGRAM_ROUTES) {
    if (route.keywords.some(kw => lower.includes(kw))) return route;
  }
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method === 'GET') return res.status(200).json({ status: 'ok', webhook: 'whatsapp' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const payload = req.body;
    const phone = payload.phone || payload.from || payload.waId || '';
    const text = payload.text || payload.message || payload.body || '';
    const name = payload.name || payload.pushName || '';

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    await logIncoming(phone, text);

    const db = getClient();
    const lower = text.toLowerCase().trim();

    if (lower === 'stop' || lower === 'unsubscribe') {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(text)) {
      await escalateToMaddy('Keyword trigger in message', { phone, name, message: text });
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (existingLead && existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'dropped_lead_ignored' });
    }

    const market = detectMarket(phone);
    const hinglish = isHinglish(market);

    if (!existingLead) {
      const { data: lead } = await db.from('leads').insert({
        phone,
        name: name || null,
        source: 'whatsapp',
        status: 'new',
        first_msg: text,
        last_msg_at: new Date().toISOString(),
        market
      }).select().single();

      const welcomeMsg = hinglish
        ? "Hi! Maddy's team here 👋 Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?"
        : "Hi! Maddy's team here 👋 What's your goal — fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?";

      await sendMessage(phone, welcomeMsg, {
        templateName: 'welcome_v1',
        params: { name: name || 'there', templateParams: [name || 'there'] }
      });

      return res.status(200).json({ action: 'new_lead', leadId: lead.id });
    }

    await db.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('id', existingLead.id);

    if (existingLead.status === 'new') {
      const route = routeProgram(text);

      if (route) {
        await db.from('leads').update({
          status: 'qualified',
          program_interest: route.program
        }).eq('id', existingLead.id);

        const siteBase = process.env.SITE_URL || 'https://fitnessbymaddy.com';
        const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${existingLead.id}`;
        const intakeUrl = `${siteBase}/intake?lead=${existingLead.id}`;

        const qualMsg = hinglish
          ? `Great choice! 🔥 ${route.label} is perfect for you.\n\nPayment link: ${checkoutUrl}\n\nSaath mein ye form bhi fill karo so Maddy can personalise your plan: ${intakeUrl}`
          : `Great choice! 🔥 ${route.label} is perfect for you.\n\nPayment link: ${checkoutUrl}\n\nAlso fill out this form so Maddy can personalise your plan: ${intakeUrl}`;

        await sendMessage(phone, qualMsg, {
          templateName: 'program_qualified',
          params: {
            name: existingLead.name || 'there',
            templateParams: [existingLead.name || 'there', route.label, checkoutUrl, intakeUrl]
          }
        });

        return res.status(200).json({ action: 'qualified', program: route.program });
      }

      const helpMsg = hinglish
        ? "Hmm, mujhe exactly samajh nahi aaya. Bata do — fat loss, PCOS, 40+ fitness, ya trial session? 🤔"
        : "I'd love to help you find the right program! Could you tell me — are you looking for fat loss, PCOS management, 40+ fitness, or a trial session? 🤔";

      await sendMessage(phone, helpMsg, { isClient: false });

      return res.status(200).json({ action: 'awaiting_qualification' });
    }

    return res.status(200).json({ action: 'existing_lead', status: existingLead.status });

  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
