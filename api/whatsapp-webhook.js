const { supabase } = require('./_lib/supabase');
const { sendTemplate, logMessage, notifyMaddy } = require('./_lib/whatsapp');
const { detectMarket, isHinglish, maskPhone } = require('./_lib/market');
const { checkEscalation, checkOptOut } = require('./_lib/escalation');

const PROGRAM_ROUTES = [
  { keywords: ['fat loss', 'weight loss', 'weight', 'shred', 'slim', 'lean', 'patla'], program: '6wk_gym', label: '6-Week Burn & Build', price: 97 },
  { keywords: ['pcos', 'hormonal', 'pcod', 'hormone'], program: 'pcos', label: 'PCOS Warrior', price: 45 },
  { keywords: ['40', 'menopause', 'joints', 'joint', 'senior', 'older'], program: '40plus', label: '40+ Strong', price: 50 },
  { keywords: ['custom', '12 week', '12-week', 'serious', 'full program', 'flagship', 'personalised'], program: '12wk', label: '12-Week Flagship', price: 200 },
  { keywords: ['trial', 'zoom', 'not sure', 'try', 'test', 'pehle', 'dekhna'], program: 'zoom_trial', label: 'Zoom Trial', price: 20 },
  { keywords: ['home', 'ghar', 'no gym', 'without gym', 'bodyweight'], program: '6wk_home', label: '6-Week Home Burn', price: 97 },
];

function routeToProgram(message) {
  const lower = (message || '').toLowerCase();
  for (const route of PROGRAM_ROUTES) {
    if (route.keywords.some(k => lower.includes(k))) return route;
  }
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = req.body || {};
    const phone = (body.from || body.senderPhone || body.waId || '').replace(/\s+/g, '');
    const text = body.text || body.message || body.body || '';
    const msgType = body.type || 'text';

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    await logMessage(phone, 'in', text, null);

    if (checkOptOut(text)) {
      await supabase.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      console.log(`Opt-out: ${maskPhone(phone)}`);
      return res.status(200).json({ action: 'opted_out' });
    }

    const escalation = checkEscalation(text);
    if (escalation.shouldEscalate) {
      await notifyMaddy(
        `Lead message flagged`,
        `Phone: ${maskPhone(phone)}\nKeywords: ${escalation.keywords.join(', ')}\nMessage: ${text.substring(0, 300)}`
      );
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    const { data: existingClient } = await supabase
      .from('clients')
      .select('*')
      .eq('phone', phone)
      .eq('status', 'active')
      .single();

    if (existingClient) {
      await supabase.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('phone', phone);
      return res.status(200).json({ action: 'active_client', client_id: existingClient.id });
    }

    if (existingLead && existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'dropped_lead' });
    }

    const market = detectMarket(phone);
    const hinglish = isHinglish(market);

    if (!existingLead) {
      const { data: newLead } = await supabase.from('leads').insert({
        phone,
        name: body.senderName || body.pushName || null,
        source: 'whatsapp',
        status: 'new',
        first_msg: text.substring(0, 500),
        last_msg_at: new Date().toISOString(),
        market
      }).select().single();

      if (hinglish) {
        await sendTemplate(phone, 'welcome_v1', [
          newLead?.name || 'there'
        ], true);
      } else {
        await sendTemplate(phone, 'welcome_v1_en', [
          newLead?.name || 'there'
        ], true);
      }

      return res.status(200).json({ action: 'new_lead', lead_id: newLead?.id });
    }

    const route = routeToProgram(text);
    if (route) {
      await supabase.from('leads').update({
        status: 'qualified',
        program_interest: route.program,
        last_msg_at: new Date().toISOString()
      }).eq('phone', phone);

      const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${route.program}`;
      const intakeUrl = `https://fitnessbymaddy.com/intake?lead=${existingLead.id}`;

      const templateName = hinglish ? 'program_offer_hi' : 'program_offer_en';
      await sendTemplate(phone, templateName, [
        existingLead.name || 'there',
        route.label,
        `$${route.price}`,
        checkoutUrl,
        intakeUrl
      ], true);

      return res.status(200).json({ action: 'qualified', program: route.program });
    }

    await supabase.from('leads').update({
      last_msg_at: new Date().toISOString()
    }).eq('phone', phone);

    return res.status(200).json({ action: 'message_logged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
