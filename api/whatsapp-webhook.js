const { supabase } = require('./_lib/supabase');
const { sendWithRateLimit } = require('./_lib/whatsapp');
const { detectMarket, isHinglish, maskPhone } = require('./_lib/market');
const { needsEscalation, isOptOut, escalate, handleOptOut } = require('./_lib/escalation');

const PROGRAM_ROUTES = [
  { keywords: ['fat loss', 'weight', 'shred', 'lose', 'slim'], program: '6wk_gym', label: '6-Week Burn & Build' },
  { keywords: ['pcos', 'hormonal', 'hormone'], program: 'pcos', label: 'PCOS Warrior' },
  { keywords: ['40', 'menopause', 'joints', 'joint', 'senior'], program: '40plus', label: '40+ Strong' },
  { keywords: ['custom', '12 week', 'serious', 'flagship', 'personalised'], program: '12wk', label: '12-Week Custom' },
  { keywords: ['trial', 'zoom', 'not sure', 'try', 'test'], program: 'zoom_trial', label: 'Zoom Trial' }
];

function routeToProgram(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  for (const route of PROGRAM_ROUTES) {
    for (const kw of route.keywords) {
      if (lower.includes(kw)) return route;
    }
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
    const body = req.body;
    const phone = body.mobile || body.phone || body.from || '';
    const text = body.text || body.message || body.body || '';
    const senderName = body.name || body.pushName || '';

    if (!phone) {
      return res.status(400).json({ error: 'No phone number' });
    }

    const cleanPhone = phone.startsWith('+') ? phone : '+' + phone;
    const market = detectMarket(cleanPhone);
    const hinglish = isHinglish(market);

    await supabase.from('messages').insert({
      phone: cleanPhone,
      direction: 'in',
      body: text,
      status: 'received'
    });

    if (isOptOut(text)) {
      await handleOptOut(cleanPhone);
      return res.status(200).json({ action: 'opted_out' });
    }

    const escalationReason = needsEscalation(text);
    if (escalationReason) {
      await escalate(cleanPhone, escalationReason, text);
    }

    const { data: existingClient } = await supabase
      .from('clients')
      .select('id, status')
      .eq('phone', cleanPhone)
      .eq('status', 'active')
      .limit(1)
      .maybeSingle();

    if (existingClient) {
      return res.status(200).json({ action: 'active_client', escalated: !!escalationReason });
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('id, status')
      .eq('phone', cleanPhone)
      .maybeSingle();

    if (existingLead) {
      await supabase
        .from('leads')
        .update({ last_msg_at: new Date().toISOString(), first_msg: existingLead.first_msg || text })
        .eq('id', existingLead.id);

      if (existingLead.status === 'dropped') {
        return res.status(200).json({ action: 'dropped_lead_ignored' });
      }

      const route = routeToProgram(text);
      if (route) {
        await supabase
          .from('leads')
          .update({ status: 'qualified', program_interest: route.program })
          .eq('id', existingLead.id);

        const checkoutMsg = hinglish
          ? `${route.label} aapke liye perfect hai! Yeh raha checkout link:`
          : `${route.label} sounds perfect for you! Here's your checkout link:`;

        await sendWithRateLimit(cleanPhone, 'program_checkout', [
          route.label,
          `https://fitnessbymaddyy.exlyapp.com/checkout/${existingLead.id}`,
          `https://fitnessbymaddy.com/intake.html?lead=${existingLead.id}`
        ]);

        return res.status(200).json({ action: 'qualified', program: route.program });
      }

      return res.status(200).json({ action: 'existing_lead_updated' });
    }

    const { data: newLead } = await supabase
      .from('leads')
      .insert({
        phone: cleanPhone,
        name: senderName,
        source: 'whatsapp',
        status: 'new',
        first_msg: text,
        last_msg_at: new Date().toISOString(),
        market
      })
      .select()
      .single();

    const welcomeTemplate = hinglish ? 'welcome_v1_hi' : 'welcome_v1';
    await sendWithRateLimit(cleanPhone, welcomeTemplate, [senderName || 'there']);

    const route = routeToProgram(text);
    if (route) {
      await supabase
        .from('leads')
        .update({ status: 'qualified', program_interest: route.program })
        .eq('id', newLead.id);

      await sendWithRateLimit(cleanPhone, 'program_checkout', [
        route.label,
        `https://fitnessbymaddyy.exlyapp.com/checkout/${newLead.id}`,
        `https://fitnessbymaddy.com/intake.html?lead=${newLead.id}`
      ]);
    }

    return res.status(200).json({ action: 'new_lead', id: newLead.id });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
