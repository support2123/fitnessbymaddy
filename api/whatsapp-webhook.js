const { supabase } = require('./lib/supabase');
const { sendTemplate, sendText } = require('./lib/whatsapp');
const { detectMarket, isHinglishMarket } = require('./lib/market');
const { needsEscalation, escalateToMaddy } = require('./lib/escalation');
const { canSendTo } = require('./lib/rate-limit');

const PROGRAM_MAP = {
  'fat loss': '6wk_gym', 'weight': '6wk_gym', 'shred': '6wk_gym',
  'lose': '6wk_gym', 'slim': '6wk_gym', 'burn': '6wk_gym',
  'pcos': 'pcos', 'hormonal': 'pcos', 'hormone': 'pcos',
  '40': '40plus', 'menopause': '40plus', 'joints': '40plus', 'joint': '40plus',
  'custom': '12wk', '12 week': '12wk', 'serious': '12wk', 'flagship': '12wk',
  'trial': 'zoom_trial', 'zoom': 'zoom_trial', 'not sure': 'zoom_trial', 'try': 'zoom_trial',
  'home': '6wk_home',
};

const PROGRAM_NAMES = {
  '6wk_gym': '6-Week Burn & Build (Gym)',
  '6wk_home': '6-Week Burn & Build (Home)',
  '12wk': '12-Week Custom Flagship',
  'pcos': 'PCOS Warrior Program',
  '40plus': '40+ Strong Program',
  'zoom_trial': 'Zoom Trial Session',
  'zoom_pack': 'Zoom Session Pack',
};

const CHECKOUT_URLS = {
  '6wk_gym': 'https://fitnessbymaddyy.exlyapp.com/checkout/6wk-gym',
  '6wk_home': 'https://fitnessbymaddyy.exlyapp.com/checkout/6wk-home',
  '12wk': 'https://fitnessbymaddyy.exlyapp.com/checkout/12wk',
  'pcos': 'https://fitnessbymaddyy.exlyapp.com/checkout/pcos',
  '40plus': 'https://fitnessbymaddyy.exlyapp.com/checkout/40plus',
  'zoom_trial': 'https://fitnessbymaddyy.exlyapp.com/checkout/zoom-trial',
};

function detectProgram(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  for (const [keyword, program] of Object.entries(PROGRAM_MAP)) {
    if (lower.includes(keyword)) return program;
  }
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const payload = req.body;
    const phone = payload.phone || payload.from || payload.waId || '';
    const text = payload.text || payload.body || payload.message || '';
    const name = payload.name || payload.pushName || '';

    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    await supabase.from('messages').insert({
      phone, direction: 'in', body: text,
    });

    const stopWords = ['stop', 'unsubscribe', 'opt out', 'optout'];
    if (stopWords.some(w => text.toLowerCase().includes(w))) {
      await supabase.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(text)) {
      await escalateToMaddy('Medical/safety concern in message', phone, text);
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (existingLead && existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'lead_dropped_no_reply' });
    }

    const { data: existingClient } = await supabase
      .from('clients')
      .select('id, status')
      .eq('phone', phone)
      .single();

    if (existingClient && existingClient.status === 'active') {
      return res.status(200).json({ action: 'active_client_pass_through' });
    }

    const market = detectMarket(phone);

    if (!existingLead) {
      await supabase.from('leads').insert({
        phone, name, source: 'whatsapp',
        status: 'new', first_msg: text,
        last_msg_at: new Date().toISOString(),
        market,
      });

      if (await canSendTo(phone)) {
        const greeting = isHinglishMarket(market)
          ? 'welcome_v1_hi'
          : 'welcome_v1_en';
        await sendTemplate(phone, greeting);
      }

      return res.status(200).json({ action: 'new_lead_greeted' });
    }

    await supabase.from('leads')
      .update({ last_msg_at: new Date().toISOString(), name: name || existingLead.name })
      .eq('id', existingLead.id);

    if (existingLead.status === 'new' || existingLead.status === 'qualified') {
      const program = detectProgram(text);
      if (program) {
        await supabase.from('leads')
          .update({ status: 'qualified', program_interest: program })
          .eq('id', existingLead.id);

        if (await canSendTo(phone)) {
          const programName = PROGRAM_NAMES[program];
          const checkoutUrl = CHECKOUT_URLS[program];
          const intakeUrl = `https://fitnessbymaddy.com/intake?lead=${existingLead.id}`;

          if (isHinglishMarket(market)) {
            await sendText(phone,
              `Perfect choice! 🔥 ${programName} aapke liye best rahega.\n\n` +
              `Checkout: ${checkoutUrl}\n\n` +
              `Pehle ye intake form bhar do: ${intakeUrl}\n\n` +
              `Koi bhi sawal ho toh poochho!`
            );
          } else {
            await sendText(phone,
              `Great choice! 🔥 The ${programName} is perfect for your goals.\n\n` +
              `Checkout here: ${checkoutUrl}\n\n` +
              `Please fill this intake form first: ${intakeUrl}\n\n` +
              `Any questions? Just ask!`
            );
          }
        }

        return res.status(200).json({ action: 'qualified', program });
      }
    }

    return res.status(200).json({ action: 'message_logged' });
  } catch (err) {
    console.error('[whatsapp-webhook]', err);
    return res.status(500).json({ error: 'Internal error' });
  }
};
