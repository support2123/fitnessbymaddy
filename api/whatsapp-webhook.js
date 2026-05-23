const { getSupabase } = require('./_lib/supabase');
const { sendWhatsApp } = require('./_lib/whatsapp');
const { detectMarket, isHinglish } = require('./_lib/market');
const { needsEscalation, escalate } = require('./_lib/escalation');
const { maskPhone } = require('./_lib/pii');

const PROGRAM_ROUTES = [
  { keywords: ['fat loss', 'weight', 'shred', 'fat', 'lose weight', 'slim'], program: '6wk_gym', label: '6-Week Burn & Build' },
  { keywords: ['pcos', 'hormonal', 'hormone', 'pcod'], program: 'pcos', label: 'PCOS Warrior' },
  { keywords: ['40', 'menopause', 'joints', 'joint pain', '40+', 'forty'], program: '40plus', label: '40+ Strong' },
  { keywords: ['custom', '12 week', 'serious', 'flagship', 'personalised', 'personalized'], program: '12wk', label: '12-Week Flagship' },
  { keywords: ['trial', 'zoom', 'not sure', 'try', 'test'], program: 'zoom_trial', label: '$20 Zoom Trial' }
];

const CHECKOUT_URLS = {
  '6wk_gym': 'https://fitnessbymaddyy.exlyapp.com/checkout/6wk-burn',
  '6wk_home': 'https://fitnessbymaddyy.exlyapp.com/checkout/6wk-home',
  '12wk': 'https://fitnessbymaddyy.exlyapp.com/checkout/12wk-flagship',
  'pcos': 'https://fitnessbymaddyy.exlyapp.com/checkout/pcos-warrior',
  '40plus': 'https://fitnessbymaddyy.exlyapp.com/checkout/40plus-strong',
  'zoom_trial': 'https://fitnessbymaddyy.exlyapp.com/checkout/zoom-trial',
  'zoom_pack': 'https://fitnessbymaddyy.exlyapp.com/checkout/zoom-pack'
};

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const body = req.body;
    const phone = body.mobile || body.phone || body.from || '';
    const text = (body.message || body.text || body.body || '').trim();
    const senderName = body.name || body.pushName || '';

    if (!phone) return res.status(400).json({ error: 'no phone' });

    const db = getSupabase();
    const market = detectMarket(phone);
    const hinglish = isHinglish(market);

    await db.from('messages').insert({
      phone, direction: 'in', body: text
    });

    const stopWords = ['stop', 'unsubscribe', 'opt out', 'optout'];
    if (stopWords.some(w => text.toLowerCase().includes(w))) {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    const escalationReason = needsEscalation(text);
    if (escalationReason) {
      await escalate(phone, escalationReason, text);
    }

    const { data: existingClient } = await db
      .from('clients')
      .select('id, status')
      .eq('phone', phone)
      .eq('status', 'active')
      .limit(1)
      .single();

    if (existingClient) {
      return res.status(200).json({ action: 'active_client', client_id: existingClient.id });
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('id, status, created_at')
      .eq('phone', phone)
      .limit(1)
      .single();

    if (!existingLead) {
      await db.from('leads').insert({
        phone,
        name: senderName,
        source: 'whatsapp',
        status: 'new',
        first_msg: text,
        last_msg_at: new Date().toISOString(),
        market
      });

      const welcome = hinglish
        ? "Hi! Maddy's team here. Kaun sa goal hai - fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?"
        : "Hi! Maddy's team here. What's your goal - fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?";

      await sendWhatsApp(phone, 'welcome_v1', welcome);
      console.log(`New lead created: ${maskPhone(phone)} [${market}]`);
      return res.status(200).json({ action: 'new_lead' });
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'dropped_lead' });
    }

    await db.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('id', existingLead.id);

    const matched = matchProgram(text);
    if (matched) {
      await db.from('leads').update({
        status: 'qualified',
        program_interest: matched.program
      }).eq('id', existingLead.id);

      const checkoutUrl = CHECKOUT_URLS[matched.program] || CHECKOUT_URLS['zoom_trial'];
      const intakeUrl = `https://www.fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;

      const msg = hinglish
        ? `Great choice! ${matched.label} perfect rahega tere liye.\n\nCheckout: ${checkoutUrl}\n\nPehle ye form bhar de:\n${intakeUrl}`
        : `Great choice! ${matched.label} would be perfect for you.\n\nCheckout here: ${checkoutUrl}\n\nPlease fill this intake form first:\n${intakeUrl}`;

      await sendWhatsApp(phone, null, msg);
      return res.status(200).json({ action: 'qualified', program: matched.program });
    }

    return res.status(200).json({ action: 'message_logged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'internal' });
  }
};

function matchProgram(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  for (const route of PROGRAM_ROUTES) {
    if (route.keywords.some(kw => lower.includes(kw))) {
      return route;
    }
  }
  return null;
}
