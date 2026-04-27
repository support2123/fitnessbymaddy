const { getSupabase } = require('../lib/supabase');
const { sendTemplate, sendFreeform, canSendToLead, logMessage } = require('../lib/whatsapp');
const { detectMarket, isHinglish, maskPhone } = require('../lib/market');
const { needsEscalation, createEscalation } = require('../lib/escalation');

const PROGRAM_ROUTES = [
  { keywords: ['fat loss', 'weight', 'shred', 'lose', 'slim'], program: '6wk_gym', label: '6-Week Burn & Build' },
  { keywords: ['pcos', 'hormonal', 'hormone'], program: 'pcos', label: 'PCOS Warrior' },
  { keywords: ['40', 'menopause', 'joints', 'joint', 'age'], program: '40plus', label: '40+ Strong' },
  { keywords: ['custom', '12 week', 'serious', 'transform', 'advanced'], program: '12wk', label: '12-Week Flagship' },
  { keywords: ['trial', 'zoom', 'not sure', 'try', 'test'], program: 'zoom_trial', label: 'Zoom Trial' },
  { keywords: ['home', 'no gym', 'bodyweight'], program: '6wk_home', label: '6-Week Home' },
];

function routeToProgram(message) {
  const lower = (message || '').toLowerCase();
  for (const route of PROGRAM_ROUTES) {
    if (route.keywords.some((kw) => lower.includes(kw))) return route;
  }
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const sb = getSupabase();

  try {
    const payload = req.body;
    const phone = payload.mobile || payload.senderMobile || payload.from;
    const message = payload.text || payload.message || payload.body || '';
    const senderName = payload.senderName || payload.name || null;

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    console.log(`[WA-IN] From ${maskPhone(phone)}: ${message.slice(0, 80)}`);

    await logMessage(phone, 'in', message, null);

    // Check for opt-out
    const lowerMsg = message.toLowerCase().trim();
    if (lowerMsg === 'stop' || lowerMsg === 'unsubscribe') {
      await sb.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    // Check for escalation triggers
    const escalationKeyword = needsEscalation(message);
    if (escalationKeyword) {
      const { data: existingClient } = await sb.from('clients').select('id').eq('phone', phone).single();
      await createEscalation(phone, escalationKeyword, message, existingClient?.id);
    }

    // Check if this is an existing lead
    const { data: existingLead } = await sb.from('leads').select('*').eq('phone', phone).single();

    if (!existingLead) {
      // FLOW A: New lead
      const market = detectMarket(phone);
      const { data: newLead } = await sb
        .from('leads')
        .insert({
          phone,
          name: senderName,
          source: 'whatsapp',
          status: 'new',
          first_msg: message.slice(0, 500),
          last_msg_at: new Date().toISOString(),
          market,
        })
        .select()
        .single();

      // Send welcome message
      const hinglish = isHinglish(market);
      if (hinglish) {
        await sendTemplate(phone, 'welcome_v1', {
          name: senderName || 'there',
          templateParams: [senderName || 'there'],
        });
      } else {
        await sendTemplate(phone, 'welcome_v1_en', {
          name: senderName || 'there',
          templateParams: [senderName || 'there'],
        });
      }

      return res.status(200).json({ action: 'new_lead', id: newLead.id });
    }

    // Update last message timestamp
    await sb
      .from('leads')
      .update({ last_msg_at: new Date().toISOString(), name: senderName || existingLead.name })
      .eq('id', existingLead.id);

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'dropped_lead_ignored' });
    }

    // FLOW B: Lead qualification
    if (existingLead.status === 'new' || existingLead.status === 'qualified') {
      const route = routeToProgram(message);

      if (route) {
        await sb
          .from('leads')
          .update({ status: 'qualified', program_interest: route.program })
          .eq('id', existingLead.id);

        if (await canSendToLead(phone)) {
          const market = existingLead.market || detectMarket(phone);
          const hinglish = isHinglish(market);

          const checkoutMsg = hinglish
            ? `${route.label} program perfect rahega aapke liye! Checkout karo: https://fitnessbymaddyy.exlyapp.com/checkout/${route.program}\n\nIntake form bhi fill karo: https://fitnessbymaddy.com/intake.html?lead=${existingLead.id}`
            : `The ${route.label} program would be perfect for you! Checkout here: https://fitnessbymaddyy.exlyapp.com/checkout/${route.program}\n\nAlso fill out the intake form: https://fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;

          await sendFreeform(phone, checkoutMsg);
        }

        return res.status(200).json({ action: 'qualified', program: route.program });
      }

      // No keyword match — send a helpful nudge if rate limit allows
      if (await canSendToLead(phone)) {
        const market = existingLead.market || detectMarket(phone);
        const hinglish = isHinglish(market);

        const nudge = hinglish
          ? 'Aapka goal kya hai? Fat loss, strength, PCOS management, ya pehle trial try karna hai? Batao toh sahi program suggest karein!'
          : "What's your goal? Fat loss, strength, PCOS management, or would you like to try a trial first? Let us know and we'll suggest the right program!";

        await sendFreeform(phone, nudge);
      }

      return res.status(200).json({ action: 'awaiting_qualification' });
    }

    return res.status(200).json({ action: 'existing_lead', status: existingLead.status });
  } catch (err) {
    console.error(`[WA-WEBHOOK] Error: ${err.message}`);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
