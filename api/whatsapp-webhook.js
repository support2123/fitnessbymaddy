const { getSupabase } = require('./_lib/supabase');
const { sendWhatsApp, canSendMessage, notifyMaddy } = require('./_lib/whatsapp');
const { detectMarket, isHinglish } = require('./_lib/market');
const { needsEscalation, maskPhone } = require('./_lib/escalation');

const PROGRAM_ROUTES = [
  { keywords: ['fat loss', 'weight', 'shred', 'lean', 'cut'], program: '6wk_gym', label: '6-Week Burn & Build' },
  { keywords: ['home', 'no gym', 'bodyweight', 'at home'], program: '6wk_home', label: '6-Week Home Program' },
  { keywords: ['pcos', 'hormonal', 'hormone', 'irregular period'], program: 'pcos', label: 'PCOS Warrior' },
  { keywords: ['40', 'menopause', 'joints', 'senior', 'over 40'], program: '40plus', label: '40+ Strong' },
  { keywords: ['custom', '12 week', 'serious', 'flagship', 'full program'], program: '12wk', label: '12-Week Custom' },
  { keywords: ['trial', 'zoom', 'not sure', 'try', 'test'], program: 'zoom_trial', label: '$20 Zoom Trial' },
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
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const payload = req.body;
    const phone = payload.mobile || payload.from || payload.senderMobile;
    const text = payload.text || payload.message || payload.body || '';
    const name = payload.name || payload.pushName || '';

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    const db = getSupabase();
    const market = detectMarket(phone);
    const hinglish = isHinglish(market);

    await db.from('messages').insert({
      phone,
      direction: 'in',
      body: text,
      sent_at: new Date().toISOString(),
      status: 'received'
    });

    const stopWords = ['stop', 'unsubscribe', 'opt out', 'optout'];
    if (stopWords.some(w => text.toLowerCase().includes(w))) {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      await db.from('clients').update({ status: 'paused' }).eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    const esc = needsEscalation(text);
    if (esc.escalate) {
      await notifyMaddy(
        'Lead/Client Escalation',
        `Phone: ${maskPhone(phone)}\nMessage: ${text}\nTriggers: ${esc.reasons.join(', ')}`
      );
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      await db.from('leads').insert({
        phone,
        name: name || null,
        source: 'whatsapp',
        status: 'new',
        first_msg: text,
        last_msg_at: new Date().toISOString(),
        market,
        created_at: new Date().toISOString()
      });

      const canSend = await canSendMessage(phone, false);
      if (canSend) {
        const welcomeBody = hinglish
          ? "Hi! Maddy's team here. Kaun sa goal hai - fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?"
          : "Hi! Maddy's team here. What's your goal - fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?";

        await sendWhatsApp({
          phone,
          templateName: 'welcome_v1',
          body: welcomeBody,
          params: [name || 'there']
        });
      }

      return res.status(200).json({ action: 'new_lead_welcomed' });
    }

    await db.from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('phone', phone);

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'lead_dropped_ignored' });
    }

    const route = routeProgram(text);
    if (route) {
      await db.from('leads')
        .update({ status: 'qualified', program_interest: route.program })
        .eq('phone', phone);

      const canSend = await canSendMessage(phone, false);
      if (canSend) {
        const checkoutBase = 'https://fitnessbymaddyy.exlyapp.com/checkout';
        const intakeUrl = `https://fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;

        const msgBody = hinglish
          ? `Great choice! ${route.label} program perfect hai aapke liye.\n\nCheckout: ${checkoutBase}/${route.program}\n\nPehle ye intake form fill karo: ${intakeUrl}`
          : `Great choice! The ${route.label} program is perfect for you.\n\nCheckout: ${checkoutBase}/${route.program}\n\nPlease fill this intake form first: ${intakeUrl}`;

        await sendWhatsApp({
          phone,
          templateName: 'program_offer',
          body: msgBody,
          params: [name || 'there', route.label]
        });
      }

      return res.status(200).json({ action: 'lead_qualified', program: route.program });
    }

    const { data: existingClient } = await db
      .from('clients')
      .select('*')
      .eq('phone', phone)
      .eq('status', 'active')
      .single();

    if (existingClient) {
      return res.status(200).json({ action: 'active_client_msg_logged' });
    }

    return res.status(200).json({ action: 'message_logged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
