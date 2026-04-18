const { supabase } = require('../lib/supabase');
const { sendMessage, logIncoming } = require('../lib/whatsapp');
const { detectMarket, isHinglish } = require('../lib/market');
const { needsEscalation, isOptOut, escalateToMaddy } = require('../lib/escalation');

const PROGRAM_MAP = {
  'fat loss': '6wk_gym',
  'weight': '6wk_gym',
  'shred': '6wk_gym',
  'weight loss': '6wk_gym',
  'lean': '6wk_gym',
  'burn': '6wk_gym',
  'pcos': 'pcos',
  'hormonal': 'pcos',
  'pcod': 'pcos',
  '40': '40plus',
  'menopause': '40plus',
  'joints': '40plus',
  'joint': '40plus',
  'custom': '12wk',
  '12 week': '12wk',
  'serious': '12wk',
  'flagship': '12wk',
  'personalised': '12wk',
  'personalized': '12wk',
  'trial': 'zoom_trial',
  'zoom': 'zoom_trial',
  'not sure': 'zoom_trial',
  'try': 'zoom_trial',
  'home': '6wk_home',
  'home workout': '6wk_home',
  'no gym': '6wk_home',
};

const PROGRAM_DETAILS = {
  '6wk_gym': { name: '6-Week Burn & Build (Gym)', price: 97, checkoutSlug: '6wk-gym' },
  '6wk_home': { name: '6-Week Burn & Build (Home)', price: 97, checkoutSlug: '6wk-home' },
  '12wk': { name: '12-Week Custom Flagship', price: 200, checkoutSlug: '12wk-custom' },
  'pcos': { name: 'PCOS Warrior Program', price: 45, checkoutSlug: 'pcos-warrior' },
  '40plus': { name: '40+ Strong Program', price: 50, checkoutSlug: '40plus-strong' },
  'zoom_trial': { name: 'Zoom Trial Session', price: 20, checkoutSlug: 'zoom-trial' },
  'zoom_pack': { name: 'Zoom Training Pack', price: 150, checkoutSlug: 'zoom-pack' },
};

function matchProgram(text) {
  const lower = text.toLowerCase();
  for (const [keyword, program] of Object.entries(PROGRAM_MAP)) {
    if (lower.includes(keyword)) return program;
  }
  return null;
}

module.exports = async function handler(req, res) {
  // Webhook verification (Meta/AiSensy GET challenge)
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && token === process.env.WA_VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }
    return res.status(403).send('Forbidden');
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const payload = req.body;

    // AiSensy webhook format
    const phone = payload.phone || payload.from || payload.waId || extractPhone(payload);
    const messageBody = payload.text || payload.message || payload.body || extractText(payload);

    if (!phone) return res.status(200).json({ ok: true, note: 'no phone' });

    const cleanPhone = phone.replace(/[^0-9]/g, '');
    await logIncoming(cleanPhone, messageBody);

    // Opt-out check
    if (isOptOut(messageBody)) {
      await supabase.from('leads').update({ status: 'dropped' }).eq('phone', cleanPhone);
      return res.status(200).json({ ok: true, action: 'opted_out' });
    }

    // Escalation check
    if (needsEscalation(messageBody)) {
      const { data: lead } = await supabase.from('leads').select('name').eq('phone', cleanPhone).single();
      await escalateToMaddy('Keyword trigger in message', {
        phone: cleanPhone,
        name: lead?.name,
        messageBody,
      });
    }

    // Check if existing lead or client
    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', cleanPhone)
      .single();

    const { data: existingClient } = await supabase
      .from('clients')
      .select('*')
      .eq('phone', cleanPhone)
      .eq('status', 'active')
      .single();

    // Active client — acknowledge and let Maddy handle
    if (existingClient) {
      await supabase.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('phone', cleanPhone);
      return res.status(200).json({ ok: true, action: 'client_message_logged' });
    }

    const market = detectMarket(cleanPhone);

    // New lead — Flow A
    if (!existingLead) {
      await supabase.from('leads').insert({
        phone: cleanPhone,
        first_msg: messageBody,
        market,
        status: 'new',
      });

      const welcomeMsg = isHinglish(market)
        ? 'Hi! Maddy\'s team here 👋 Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?'
        : 'Hi! Maddy\'s team here 👋 What\'s your goal — fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?';

      await sendMessage(cleanPhone, { template: 'welcome_v1', params: [], text: welcomeMsg });

      // Schedule nudge (handled by cron, but set timestamp)
      return res.status(200).json({ ok: true, action: 'new_lead_welcomed' });
    }

    // Existing lead — Flow B (qualification)
    if (existingLead.status === 'dropped') {
      return res.status(200).json({ ok: true, action: 'lead_dropped_ignored' });
    }

    await supabase.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('phone', cleanPhone);

    const matchedProgram = matchProgram(messageBody);

    if (matchedProgram) {
      const details = PROGRAM_DETAILS[matchedProgram];
      await supabase.from('leads').update({
        status: 'qualified',
        program_interest: matchedProgram,
      }).eq('phone', cleanPhone);

      const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${details.checkoutSlug}`;
      const intakeUrl = `https://fitnessbymaddy.com/intake?lead=${existingLead.id}`;

      const qualifyMsg = isHinglish(market)
        ? `Perfect choice! 🔥 ${details.name} — just $${details.price}.\n\n👉 Checkout: ${checkoutUrl}\n📋 Intake form bhi fill karo: ${intakeUrl}\n\nPayment ke baad hum turant start karenge!`
        : `Great choice! 🔥 ${details.name} — just $${details.price}.\n\n👉 Checkout: ${checkoutUrl}\n📋 Please fill your intake form: ${intakeUrl}\n\nWe'll get you started right after payment!`;

      await sendMessage(cleanPhone, { text: qualifyMsg });
      return res.status(200).json({ ok: true, action: 'lead_qualified', program: matchedProgram });
    }

    return res.status(200).json({ ok: true, action: 'message_logged' });
  } catch (err) {
    console.error('whatsapp-webhook error:', err.message);
    return res.status(200).json({ ok: true, note: 'error handled gracefully' });
  }
};

// Extract phone from Meta Cloud API nested format
function extractPhone(payload) {
  try {
    return payload.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.from;
  } catch { return null; }
}

// Extract text from Meta Cloud API nested format
function extractText(payload) {
  try {
    return payload.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.text?.body;
  } catch { return null; }
}
