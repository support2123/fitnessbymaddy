const { getSupabase } = require('./lib/supabase');
const { sendTemplate, canSendToLead } = require('./lib/whatsapp');
const { detectMarket, isHinglish, maskPhone } = require('./lib/market');
const { needsEscalation, escalateToMaddy, checkOptOut } = require('./lib/escalation');

const PROGRAM_ROUTES = [
  { keywords: ['fat loss', 'weight', 'shred', 'lose', 'slim', 'burn'], program: '6wk_gym', label: '6-Week Burn & Build', price: '$97' },
  { keywords: ['pcos', 'hormonal', 'hormone', 'pcod'], program: 'pcos', label: 'PCOS Warrior', price: '$45' },
  { keywords: ['40', 'menopause', 'joints', 'joint', 'senior', '40+', 'forty'], program: '40plus', label: '40+ Strong', price: '$50' },
  { keywords: ['custom', '12 week', '12week', 'serious', 'flagship', 'personalised', 'personalized'], program: '12wk', label: '12-Week Flagship', price: '$200' },
  { keywords: ['trial', 'zoom', 'not sure', 'try', 'test'], program: 'zoom_trial', label: 'Zoom Trial', price: '$20' },
];

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
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = req.body;
    const phone = body.senderPhone || body.waId || body.from;
    const text = body.text || body.message || body.body || '';
    const senderName = body.senderName || body.pushName || '';

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    const db = getSupabase();
    const market = detectMarket(phone);
    const hinglish = isHinglish(market);

    await db.from('messages').insert({
      phone,
      direction: 'in',
      body: text,
    });

    if (checkOptOut(text)) {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      console.log(`Opt-out: ${maskPhone(phone)}`);
      return res.json({ action: 'opted_out' });
    }

    if (needsEscalation(text)) {
      await escalateToMaddy('Sensitive keyword detected in message', {
        phone,
        details: text.slice(0, 200),
      });
    }

    const { data: existingClient } = await db
      .from('clients')
      .select('id, status')
      .eq('phone', phone)
      .eq('status', 'active')
      .limit(1)
      .single();

    if (existingClient) {
      return res.json({ action: 'active_client', client_id: existingClient.id });
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('id, status, created_at')
      .eq('phone', phone)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (existingLead) {
      await db.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('id', existingLead.id);

      if (existingLead.status === 'dropped') {
        return res.json({ action: 'dropped_lead' });
      }

      const route = routeToProgram(text);
      if (route) {
        await db.from('leads').update({
          status: 'qualified',
          program_interest: route.program,
        }).eq('id', existingLead.id);

        const canSend = await canSendToLead(phone);
        if (canSend) {
          const checkoutMsg = hinglish
            ? `Great choice! ${route.label} (${route.price}) ke liye yeh link use karo:`
            : `Great choice! Here's the checkout link for ${route.label} (${route.price}):`;

          await sendTemplate(phone, 'program_checkout', [
            route.label,
            route.price,
            `https://fitnessbymaddyy.exlyapp.com/checkout/${route.program}`,
          ]);

          await sendTemplate(phone, 'intake_form', [
            `https://fitnessbymaddy.com/intake?lead=${existingLead.id}`,
          ]);
        }

        return res.json({ action: 'qualified', program: route.program });
      }

      return res.json({ action: 'existing_lead', lead_id: existingLead.id });
    }

    const { data: newLead } = await db.from('leads').insert({
      phone,
      name: senderName,
      source: 'whatsapp',
      status: 'new',
      first_msg: text,
      market,
    }).select('id').single();

    const welcomeTemplate = hinglish ? 'welcome_v1_hi' : 'welcome_v1';
    await sendTemplate(phone, welcomeTemplate, [senderName || 'there']);

    return res.json({ action: 'new_lead', lead_id: newLead?.id });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
