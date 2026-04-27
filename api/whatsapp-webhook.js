const { supabase } = require('./lib/supabase');
const { sendTemplate, sendText, detectMarket, maskPhone } = require('./lib/whatsapp');
const { needsEscalation, escalate } = require('./lib/escalation');

const PROGRAM_ROUTES = {
  'fat loss': '6wk_gym', 'weight': '6wk_gym', 'shred': '6wk_gym',
  'lose': '6wk_gym', 'slim': '6wk_gym', 'burn': '6wk_gym',
  'pcos': 'pcos', 'hormonal': 'pcos', 'hormone': 'pcos',
  '40': '40plus', 'menopause': '40plus', 'joints': '40plus', 'joint': '40plus',
  'custom': '12wk', '12 week': '12wk', 'serious': '12wk', 'flagship': '12wk',
  'trial': 'zoom_trial', 'zoom': 'zoom_trial', 'not sure': 'zoom_trial', 'try': 'zoom_trial',
};

const CHECKOUT_LINKS = {
  '6wk_gym': 'https://fitnessbymaddyy.exlyapp.com/checkout/6wk-burn-build',
  '6wk_home': 'https://fitnessbymaddyy.exlyapp.com/checkout/6wk-home',
  '12wk': 'https://fitnessbymaddyy.exlyapp.com/checkout/12wk-flagship',
  'pcos': 'https://fitnessbymaddyy.exlyapp.com/checkout/pcos-warrior',
  '40plus': 'https://fitnessbymaddyy.exlyapp.com/checkout/40plus-strong',
  'zoom_trial': 'https://fitnessbymaddyy.exlyapp.com/checkout/zoom-trial',
};

function routeToProgram(message) {
  const lower = message.toLowerCase();
  for (const [keyword, program] of Object.entries(PROGRAM_ROUTES)) {
    if (lower.includes(keyword)) return program;
  }
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const payload = req.body;
  const phone = payload?.phone || payload?.waId || payload?.from;
  const message = payload?.text || payload?.body || payload?.message || '';
  const name = payload?.name || payload?.pushName || null;

  if (!phone) return res.status(400).json({ error: 'No phone number' });

  await supabase.from('messages').insert({
    phone, direction: 'in', body: message,
  });

  if (/^(stop|unsubscribe|opt.?out)$/i.test(message.trim())) {
    await supabase.from('leads').update({ status: 'dropped' }).eq('phone', phone);
    return res.status(200).json({ action: 'opted_out' });
  }

  if (needsEscalation(message)) {
    await escalate(phone, 'Keyword trigger in message', message.slice(0, 200));
  }

  const { data: existingLead } = await supabase
    .from('leads')
    .select('*')
    .eq('phone', phone)
    .single();

  if (!existingLead) {
    const market = detectMarket(phone);
    await supabase.from('leads').insert({
      phone, name, source: 'whatsapp', status: 'new',
      first_msg: message, last_msg_at: new Date().toISOString(), market,
    });

    await sendTemplate(phone, 'welcome_v1');
    return res.status(200).json({ action: 'new_lead_welcomed' });
  }

  await supabase.from('leads')
    .update({ last_msg_at: new Date().toISOString() })
    .eq('phone', phone);

  if (existingLead.status === 'dropped') {
    return res.status(200).json({ action: 'ignored_dropped' });
  }

  if (existingLead.status === 'new') {
    const program = routeToProgram(message);
    if (program) {
      await supabase.from('leads')
        .update({ status: 'qualified', program_interest: program })
        .eq('phone', phone);

      const checkoutLink = CHECKOUT_LINKS[program];
      const market = existingLead.market;
      const lang = market === 'IN' ? 'hi' : 'en';

      if (lang === 'hi') {
        await sendText(phone,
          `Perfect! Tumhare liye best program mil gaya 💪\n\n` +
          `Checkout: ${checkoutLink}\n\n` +
          `Payment ke baad, ye form bhi fill karo:\n` +
          `https://fitnessbymaddy.com/intake.html?lead=${existingLead.id}`
        );
      } else {
        await sendText(phone,
          `Perfect! I've found the best program for you 💪\n\n` +
          `Checkout: ${checkoutLink}\n\n` +
          `After payment, fill this intake form:\n` +
          `https://fitnessbymaddy.com/intake.html?lead=${existingLead.id}`
        );
      }

      return res.status(200).json({ action: 'qualified', program });
    }

    await sendText(phone,
      existingLead.market === 'IN'
        ? 'Koi dikkat nahi! Batao kaun sa goal hai — fat loss, PCOS management, 40+ fitness, ya full custom 12-week program?'
        : 'No worries! Tell me your goal — fat loss, PCOS management, 40+ fitness, or a full custom 12-week program?'
    );
    return res.status(200).json({ action: 'asked_again' });
  }

  return res.status(200).json({ action: 'no_action', status: existingLead.status });
};
