const { getSupabase } = require('../lib/supabase');
const { detectMarket, isHinglish, maskPhone } = require('../lib/market');
const { canSend, sendTemplate, sendText } = require('../lib/whatsapp');
const { needsEscalation, isOptOut, escalate } = require('../lib/escalation');

const PROGRAM_ROUTES = [
  { keys: ['fat loss', 'weight loss', 'weight', 'shred', 'lean', 'burn'], program: '6wk_gym', label: '6-Week Burn & Build' },
  { keys: ['pcos', 'hormonal', 'hormone', 'pcod'], program: 'pcos', label: 'PCOS Warrior' },
  { keys: ['40', 'forty', 'menopause', 'joints', 'joint pain', 'senior'], program: '40plus', label: '40+ Strong' },
  { keys: ['custom', '12 week', '12wk', 'serious', 'flagship', 'personalise', 'personalize'], program: '12wk', label: '12-Week Flagship' },
  { keys: ['trial', 'zoom', 'not sure', 'try', 'test'], program: 'zoom_trial', label: 'Zoom Trial' },
  { keys: ['home', 'no gym', 'bodyweight', 'home workout'], program: '6wk_home', label: '6-Week Home Shred' },
];

function routeProgram(text) {
  const lower = (text || '').toLowerCase();
  for (const route of PROGRAM_ROUTES) {
    for (const key of route.keys) {
      if (lower.includes(key)) return route;
    }
  }
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const db = getSupabase();

  try {
    const body = req.body;
    const phone = body.mobile || body.phone || body.from || '';
    const messageText = body.text || body.message || body.body || '';
    const senderName = body.name || body.pushName || '';

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    await db.from('messages').insert({
      phone,
      direction: 'in',
      body: messageText
    });

    if (isOptOut(messageText)) {
      await db.from('leads').upsert(
        { phone, status: 'dropped', opted_out: true, last_msg_at: new Date().toISOString() },
        { onConflict: 'phone' }
      );
      console.log(`Opt-out: ${maskPhone(phone)}`);
      return res.status(200).json({ action: 'opted_out' });
    }

    const escalationTrigger = needsEscalation(messageText);
    if (escalationTrigger) {
      await escalate(phone, escalationTrigger, messageText);
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    const { data: existingClient } = await db
      .from('clients')
      .select('id')
      .eq('phone', phone)
      .eq('status', 'active')
      .single();

    if (existingClient) {
      return res.status(200).json({ action: 'active_client', note: 'Routed to support' });
    }

    const market = detectMarket(phone);
    const hinglish = isHinglish(market);

    if (!existingLead) {
      await db.from('leads').insert({
        phone,
        name: senderName,
        source: 'whatsapp',
        status: 'new',
        first_msg: messageText,
        last_msg_at: new Date().toISOString(),
        market
      });

      if (await canSend(phone, false)) {
        const welcomeMsg = hinglish
          ? "Hi! Maddy's team here 👋 Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?"
          : "Hi! Maddy's team here 👋 What's your fitness goal — fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?";
        await sendTemplate(phone, 'welcome_v1', [senderName || 'there']);
      }

      return res.status(200).json({ action: 'new_lead_greeted' });
    }

    if (existingLead.opted_out) {
      return res.status(200).json({ action: 'opted_out_ignored' });
    }

    await db.from('leads').update({
      last_msg_at: new Date().toISOString(),
      name: senderName || existingLead.name
    }).eq('phone', phone);

    if (existingLead.status === 'new' || existingLead.status === 'qualified') {
      const route = routeProgram(messageText);

      if (route) {
        await db.from('leads').update({
          status: 'qualified',
          program_interest: route.program
        }).eq('phone', phone);

        if (await canSend(phone, false)) {
          const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${existingLead.id}`;
          const intakeUrl = `https://www.fitnessbymaddy.com/intake?lead=${existingLead.id}`;

          const msg = hinglish
            ? `Perfect! ${route.label} aapke liye best rahega. Yahan se start karo:\n\n💳 Checkout: ${checkoutUrl}\n📋 Intake form: ${intakeUrl}\n\nKoi doubt ho toh poochho!`
            : `Perfect! ${route.label} sounds like the right fit for you.\n\n💳 Checkout: ${checkoutUrl}\n📋 Intake form: ${intakeUrl}\n\nAny questions, just ask!`;

          await sendText(phone, msg);
        }

        return res.status(200).json({ action: 'qualified', program: route.program });
      }
    }

    return res.status(200).json({ action: 'message_logged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
