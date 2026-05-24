const { supabase } = require('./lib/supabase');
const { sendWhatsApp, canSendMessage, detectMarket, maskPhone } = require('./lib/whatsapp');
const { needsEscalation, escalateToMaddy } = require('./lib/escalation');

const PROGRAM_ROUTES = {
  'fat loss': '6wk_gym', 'weight': '6wk_gym', 'shred': '6wk_gym',
  'lose': '6wk_gym', 'slim': '6wk_gym', 'burn': '6wk_gym',
  'pcos': 'pcos', 'hormonal': 'pcos', 'hormone': 'pcos',
  '40': '40plus', 'menopause': '40plus', 'joints': '40plus', 'joint': '40plus',
  'custom': '12wk', '12 week': '12wk', 'serious': '12wk', 'personali': '12wk',
  'trial': 'zoom_trial', 'zoom': 'zoom_trial', 'not sure': 'zoom_trial', 'try': 'zoom_trial'
};

const CHECKOUT_LINKS = {
  '6wk_gym': 'https://fitnessbymaddyy.exlyapp.com/checkout/6wk-shred',
  '6wk_home': 'https://fitnessbymaddyy.exlyapp.com/checkout/6wk-home',
  '12wk': 'https://fitnessbymaddyy.exlyapp.com/checkout/12wk-custom',
  'pcos': 'https://fitnessbymaddyy.exlyapp.com/checkout/pcos-warrior',
  '40plus': 'https://fitnessbymaddyy.exlyapp.com/checkout/40plus-strong',
  'zoom_trial': 'https://fitnessbymaddyy.exlyapp.com/checkout/zoom-trial',
  'zoom_pack': 'https://fitnessbymaddyy.exlyapp.com/checkout/zoom-pack'
};

function routeToProgram(message) {
  const lower = (message || '').toLowerCase();
  for (const [keyword, program] of Object.entries(PROGRAM_ROUTES)) {
    if (lower.includes(keyword)) return program;
  }
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
    return res.status(200).json({ status: 'ok', endpoint: 'whatsapp-webhook' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { phone, message, name } = parseWebhookPayload(req.body);

    if (!phone) {
      return res.status(400).json({ error: 'No phone number in payload' });
    }

    // Handle opt-out
    const lower = (message || '').toLowerCase().trim();
    if (lower === 'stop' || lower === 'unsubscribe') {
      await supabase.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    // Log incoming message
    await supabase.from('messages').insert({
      phone,
      direction: 'in',
      body: message
    });

    // Check escalation
    if (needsEscalation(message)) {
      await escalateToMaddy('Escalation keyword detected', { phone: maskPhone(phone), message });
      return res.status(200).json({ action: 'escalated' });
    }

    // Check if existing lead
    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      // FLOW A — New lead
      const market = detectMarket(phone);
      await supabase.from('leads').insert({
        phone,
        name: name || null,
        first_msg: message,
        market,
        status: 'new'
      });

      if (await canSendMessage(phone)) {
        await sendWhatsApp(phone, 'welcome_v1', {
          name: name || 'there',
          templateParams: [name || 'there']
        });
      }

      return res.status(200).json({ action: 'new_lead_greeted' });
    }

    // FLOW B — Qualification for existing leads
    await supabase.from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('phone', phone);

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'ignored_dropped' });
    }

    const program = routeToProgram(message);
    if (program) {
      await supabase.from('leads')
        .update({ status: 'qualified', program_interest: program })
        .eq('phone', phone);

      if (await canSendMessage(phone)) {
        const checkoutUrl = CHECKOUT_LINKS[program];
        const intakeUrl = `https://www.fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;

        const market = existingLead.market || detectMarket(phone);
        const msg = market === 'IN'
          ? `Perfect! Yeh raha aapka program link: ${checkoutUrl}\n\nPayment ke baad yeh form fill karo: ${intakeUrl}`
          : `Perfect! Here's your program link: ${checkoutUrl}\n\nAfter payment, fill this form: ${intakeUrl}`;

        await sendWhatsApp(phone, 'program_link', {
          name: existingLead.name || 'there',
          templateParams: [existingLead.name || 'there', checkoutUrl, intakeUrl]
        });
      }

      return res.status(200).json({ action: 'qualified', program });
    }

    return res.status(200).json({ action: 'message_logged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function parseWebhookPayload(body) {
  // AiSensy webhook format
  if (body.phone && body.text) {
    return { phone: body.phone, message: body.text, name: body.name };
  }
  // Meta Cloud API format
  if (body.entry && body.entry[0]) {
    const change = body.entry[0].changes?.[0]?.value;
    if (change?.messages?.[0]) {
      const msg = change.messages[0];
      const contact = change.contacts?.[0];
      return {
        phone: '+' + msg.from,
        message: msg.text?.body || '',
        name: contact?.profile?.name || null
      };
    }
  }
  // Fallback
  return { phone: body.phone || body.from, message: body.message || body.text || body.body, name: body.name };
}
