const { supabase } = require('./lib/supabase');
const { sendWhatsApp, detectMarket, maskPhone } = require('./lib/whatsapp');
const { checkEscalation } = require('./lib/escalation');

const PROGRAM_ROUTES = {
  'fat loss': '6wk_gym', 'weight': '6wk_gym', 'shred': '6wk_gym',
  'lose': '6wk_gym', 'slim': '6wk_gym', 'burn': '6wk_gym',
  'pcos': 'pcos', 'hormonal': 'pcos', 'hormone': 'pcos',
  '40': '40plus', 'menopause': '40plus', 'joints': '40plus', 'joint': '40plus',
  'custom': '12wk', '12 week': '12wk', 'serious': '12wk', 'flagship': '12wk',
  'trial': 'zoom_trial', 'zoom': 'zoom_trial', 'not sure': 'zoom_trial', 'try': 'zoom_trial'
};

const PROGRAM_LINKS = {
  '6wk_gym': 'https://fitnessbymaddyy.exlyapp.com/checkout/6wk-burn-build',
  'pcos': 'https://fitnessbymaddyy.exlyapp.com/checkout/pcos-warrior',
  '40plus': 'https://fitnessbymaddyy.exlyapp.com/checkout/40plus-strong',
  '12wk': 'https://fitnessbymaddyy.exlyapp.com/checkout/12wk-flagship',
  'zoom_trial': 'https://fitnessbymaddyy.exlyapp.com/checkout/zoom-trial'
};

const PROGRAM_NAMES = {
  '6wk_gym': '6-Week Burn & Build',
  'pcos': 'PCOS Warrior Program',
  '40plus': '40+ Strong Program',
  '12wk': '12-Week Custom Flagship',
  'zoom_trial': '$20 Zoom Trial Session'
};

function routeToProgram(message) {
  const lower = message.toLowerCase();
  for (const [keyword, program] of Object.entries(PROGRAM_ROUTES)) {
    if (lower.includes(keyword)) return program;
  }
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
    return res.status(200).json({ status: 'webhook active' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { phone, message, name } = parseWebhookPayload(req.body);

    if (!phone || !message) {
      return res.status(400).json({ error: 'Missing phone or message' });
    }

    await supabase.from('messages').insert({
      phone, direction: 'in', body: message
    });

    if (/^(stop|unsubscribe|opt.?out)$/i.test(message.trim())) {
      await supabase.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (checkEscalation(message, phone)) {
      return res.status(200).json({ action: 'escalated' });
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .limit(1);

    if (!existingLead || existingLead.length === 0) {
      const market = detectMarket(phone);
      await supabase.from('leads').insert({
        phone, name: name || null, source: 'whatsapp',
        status: 'new', first_msg: message, market
      });

      const greeting = market === 'IN'
        ? 'Hi! Maddy\'s team here 👋 Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?'
        : 'Hi! Maddy\'s team here 👋 What\'s your goal — fat loss, PCOS management, strength, or 40+ fitness? Or try a trial session first?';

      await sendWhatsApp({ phone, templateName: 'welcome_v1', body: greeting });
      return res.status(200).json({ action: 'new_lead_greeted' });
    }

    const lead = existingLead[0];
    if (lead.status === 'dropped') {
      return res.status(200).json({ action: 'lead_dropped_ignored' });
    }

    await supabase.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('id', lead.id);

    const program = routeToProgram(message);
    if (program) {
      await supabase.from('leads').update({
        status: 'qualified', program_interest: program
      }).eq('id', lead.id);

      const market = lead.market || 'IN';
      const link = PROGRAM_LINKS[program];
      const programName = PROGRAM_NAMES[program];
      const intakeLink = `https://fitnessbymaddy.com/intake?lead=${lead.id}`;

      const reply = market === 'IN'
        ? `Perfect! 🔥 ${programName} tere liye best rahega.\n\n` +
          `👉 Checkout: ${link}\n` +
          `📋 Intake form bhar do: ${intakeLink}\n\n` +
          `Payment ke baad turant program start ho jayega!`
        : `Perfect! 🔥 ${programName} is ideal for you.\n\n` +
          `👉 Checkout: ${link}\n` +
          `📋 Fill your intake form: ${intakeLink}\n\n` +
          `Your program starts immediately after payment!`;

      await sendWhatsApp({ phone, body: reply, templateName: 'program_offer' });
      return res.status(200).json({ action: 'qualified', program });
    }

    return res.status(200).json({ action: 'message_logged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function parseWebhookPayload(body) {
  if (body.payload && body.payload.payload) {
    const msg = body.payload.payload;
    return {
      phone: msg.sender?.phone || msg.waId || '',
      message: msg.text || msg.body || '',
      name: msg.sender?.name || msg.pushName || ''
    };
  }
  if (body.entry) {
    const change = body.entry[0]?.changes?.[0]?.value;
    const msg = change?.messages?.[0];
    const contact = change?.contacts?.[0];
    return {
      phone: '+' + (msg?.from || ''),
      message: msg?.text?.body || '',
      name: contact?.profile?.name || ''
    };
  }
  return {
    phone: body.phone || body.from || '',
    message: body.message || body.text || body.body || '',
    name: body.name || ''
  };
}
