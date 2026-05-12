const { supabase } = require('./lib/supabase');
const { sendTemplate } = require('./lib/whatsapp');
const { detectMarket, isHinglish } = require('./lib/market');
const { needsEscalation, escalateToMaddy, isOptOut, maskPhone } = require('./lib/escalation');

const PROGRAM_ROUTES = [
  { keywords: ['fat loss', 'weight', 'shred', 'fat', 'lose weight', 'slim'], program: '6wk_gym', name: '6-Week Burn & Build', price: '$97' },
  { keywords: ['pcos', 'hormonal', 'hormone', 'pcod'], program: 'pcos', name: 'PCOS Warrior', price: '$45' },
  { keywords: ['40', 'menopause', 'joints', 'joint', 'senior', '40+', 'forty'], program: '40plus', name: '40+ Strong', price: '$50' },
  { keywords: ['custom', '12 week', 'serious', 'flagship', 'personalised', 'personalized', '12wk'], program: '12wk', name: '12-Week Flagship', price: '$200' },
  { keywords: ['trial', 'zoom', 'not sure', 'try', 'test'], program: 'zoom_trial', name: 'Zoom Trial', price: '$20' }
];

function matchProgram(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  for (const route of PROGRAM_ROUTES) {
    if (route.keywords.some(kw => lower.includes(kw))) return route;
  }
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
    return res.status(200).json({ status: 'whatsapp webhook active' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const payload = req.body;
    const phone = payload.phone || payload.from || payload.senderPhone || '';
    const text = payload.text || payload.message || payload.body || '';
    const name = payload.name || payload.senderName || '';

    if (!phone) {
      return res.status(400).json({ error: 'No phone number' });
    }

    await supabase.from('messages').insert({
      phone,
      direction: 'in',
      body: text
    });

    if (isOptOut(text)) {
      await supabase
        .from('leads')
        .update({ status: 'dropped' })
        .eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(text)) {
      await escalateToMaddy(
        'Lead/Client message flagged',
        `Phone: ${maskPhone(phone)}\nMessage: ${text.slice(0, 300)}`
      );
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .limit(1)
      .single();

    if (!existingLead) {
      const market = detectMarket(phone);
      const { data: newLead } = await supabase
        .from('leads')
        .insert({
          phone,
          name: name || null,
          source: 'whatsapp',
          status: 'new',
          first_msg: text,
          market
        })
        .select()
        .single();

      const templateName = isHinglish(market) ? 'welcome_v1_hi' : 'welcome_v1';
      await sendTemplate(phone, templateName, {
        name: name || 'there',
        templateParams: [name || 'there']
      });

      return res.status(200).json({ action: 'new_lead', lead_id: newLead?.id });
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'ignored_dropped' });
    }

    await supabase
      .from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('id', existingLead.id);

    if (existingLead.status === 'new') {
      const matched = matchProgram(text);

      if (matched) {
        await supabase
          .from('leads')
          .update({
            status: 'qualified',
            program_interest: matched.program
          })
          .eq('id', existingLead.id);

        const market = existingLead.market || detectMarket(phone);
        const lang = isHinglish(market);

        const checkoutMsg = lang
          ? `${matched.name} - ${matched.price} mein start karo! Checkout: https://fitnessbymaddyy.exlyapp.com/checkout/${matched.program}`
          : `Great choice! ${matched.name} - ${matched.price}. Checkout here: https://fitnessbymaddyy.exlyapp.com/checkout/${matched.program}`;

        await sendTemplate(phone, 'program_checkout', {
          name: existingLead.name || 'there',
          templateParams: [
            existingLead.name || 'there',
            matched.name,
            matched.price,
            `https://fitnessbymaddyy.exlyapp.com/checkout/${matched.program}`
          ]
        });

        await sendTemplate(phone, 'intake_form_link', {
          templateParams: [
            existingLead.name || 'there',
            `https://fitnessbymaddy.com/intake?lead=${existingLead.id}`
          ]
        });

        return res.status(200).json({
          action: 'qualified',
          program: matched.program,
          lead_id: existingLead.id
        });
      }

      return res.status(200).json({ action: 'awaiting_qualification' });
    }

    return res.status(200).json({ action: 'message_logged' });

  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
