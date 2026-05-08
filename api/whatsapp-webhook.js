const { supabase } = require('./lib/supabase');
const { sendTemplate, sendText } = require('./lib/whatsapp');
const { detectMarket, isHinglish } = require('./lib/market');
const { needsEscalation, escalateToMaddy } = require('./lib/escalation');
const { canSendTo } = require('./lib/rate-limiter');

const PROGRAM_ROUTES = [
  { keys: ['fat loss', 'weight', 'shred', 'lose', 'burn'], program: '6wk_gym', label: '6-Week Burn & Build', price: '$97' },
  { keys: ['pcos', 'hormonal', 'hormone'], program: 'pcos', label: 'PCOS Warrior', price: '$45' },
  { keys: ['40', 'menopause', 'joints', 'joint', 'senior'], program: '40plus', label: '40+ Strong', price: '$50' },
  { keys: ['custom', '12 week', 'serious', 'flagship', 'personalised', 'personalized'], program: '12wk', label: '12-Week Flagship', price: '$200' },
  { keys: ['trial', 'zoom', 'not sure', 'try', 'test'], program: 'zoom_trial', label: 'Zoom Trial Session', price: '$20' },
  { keys: ['home', 'bodyweight', 'no gym', 'home workout'], program: '6wk_home', label: '6-Week Home Burn', price: '$97' },
];

const STOP_WORDS = ['stop', 'unsubscribe', 'opt out', 'optout', 'cancel'];

function routeProgram(text) {
  const lower = (text || '').toLowerCase();
  for (const route of PROGRAM_ROUTES) {
    if (route.keys.some((k) => lower.includes(k))) return route;
  }
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const payload = req.body;
    const phone = payload.mobile || payload.from || payload.waId;
    const text = payload.text || payload.message?.text || payload.body || '';
    const name = payload.name || payload.pushName || null;

    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    await supabase.from('messages').insert({
      phone,
      direction: 'in',
      body: text,
    });

    if (STOP_WORDS.some((w) => text.toLowerCase().includes(w))) {
      await supabase
        .from('leads')
        .update({ status: 'dropped' })
        .eq('phone', phone);
      return res.json({ action: 'opted_out' });
    }

    if (needsEscalation(text)) {
      await escalateToMaddy('Keyword trigger in message', phone, text);
    }

    const { data: existingClient } = await supabase
      .from('clients')
      .select('id, status')
      .eq('phone', phone)
      .eq('status', 'active')
      .maybeSingle();

    if (existingClient) {
      return res.json({ action: 'active_client', client_id: existingClient.id });
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('id, status, created_at')
      .eq('phone', phone)
      .maybeSingle();

    if (existingLead) {
      await supabase
        .from('leads')
        .update({ last_msg_at: new Date().toISOString() })
        .eq('id', existingLead.id);

      if (existingLead.status === 'dropped') {
        return res.json({ action: 'dropped_lead' });
      }

      const route = routeProgram(text);
      if (route) {
        await supabase
          .from('leads')
          .update({ status: 'qualified', program_interest: route.program })
          .eq('id', existingLead.id);

        const market = detectMarket(phone);
        const hinglish = isHinglish(market);

        const checkoutMsg = hinglish
          ? `${route.label} — ${route.price}\nCheckout: https://fitnessbymaddyy.exlyapp.com/checkout/${existingLead.id}\n\nIntake form bhi fill kar do: https://www.fitnessbymaddy.com/intake?lead=${existingLead.id}`
          : `${route.label} — ${route.price}\nCheckout: https://fitnessbymaddyy.exlyapp.com/checkout/${existingLead.id}\n\nPlease also fill your intake form: https://www.fitnessbymaddy.com/intake?lead=${existingLead.id}`;

        if (await canSendTo(phone)) {
          await sendText(phone, checkoutMsg);
        }

        return res.json({ action: 'qualified', program: route.program });
      }

      return res.json({ action: 'existing_lead', lead_id: existingLead.id });
    }

    const market = detectMarket(phone);
    const { data: newLead } = await supabase
      .from('leads')
      .insert({
        phone,
        name,
        source: 'whatsapp',
        status: 'new',
        first_msg: text,
        last_msg_at: new Date().toISOString(),
        market,
      })
      .select('id')
      .single();

    const hinglish = isHinglish(market);
    const welcomeMsg = hinglish
      ? "Hi! Maddy's team here 👋 Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?"
      : "Hi! Maddy's team here 👋 What's your goal — fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?";

    await sendTemplate(phone, 'welcome_v1', [name || 'there']);

    return res.json({ action: 'new_lead', lead_id: newLead.id });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
