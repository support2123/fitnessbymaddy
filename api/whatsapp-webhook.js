const { supabase } = require('./lib/supabase');
const { sendTemplate, detectMarket, maskPhone } = require('./lib/whatsapp');
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
  '6wk_gym': 'https://fitnessbymaddyy.exlyapp.com/checkout/6wk-burn-build',
  '6wk_home': 'https://fitnessbymaddyy.exlyapp.com/checkout/6wk-home',
  '12wk': 'https://fitnessbymaddyy.exlyapp.com/checkout/12wk-flagship',
  'pcos': 'https://fitnessbymaddyy.exlyapp.com/checkout/pcos-warrior',
  '40plus': 'https://fitnessbymaddyy.exlyapp.com/checkout/40plus-strong',
  'zoom_trial': 'https://fitnessbymaddyy.exlyapp.com/checkout/zoom-trial',
  'zoom_pack': 'https://fitnessbymaddyy.exlyapp.com/checkout/zoom-pack'
};

function classifyMessage(text) {
  const lower = (text || '').toLowerCase();
  for (const [keyword, program] of Object.entries(PROGRAM_ROUTES)) {
    if (lower.includes(keyword)) return program;
  }
  return null;
}

function isOptOut(text) {
  const lower = (text || '').toLowerCase().trim();
  return ['stop', 'unsubscribe', 'opt out', 'optout', 'cancel'].includes(lower);
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { phone, message, name, timestamp } = parseWebhookPayload(req.body);

    if (!phone) {
      return res.status(400).json({ error: 'Missing phone number' });
    }

    // Log incoming message
    await supabase.from('messages').insert({
      phone,
      direction: 'in',
      body: message,
      sent_at: timestamp || new Date().toISOString()
    });

    // Handle opt-out immediately
    if (isOptOut(message)) {
      await supabase
        .from('leads')
        .update({ status: 'dropped' })
        .eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    // Check for escalation keywords
    if (needsEscalation(message)) {
      await escalateToMaddy('Keyword trigger in message', {
        phone: maskPhone(phone),
        details: message.slice(0, 100)
      });
    }

    // Check if this is an existing lead
    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    // Check if already a client
    const { data: existingClient } = await supabase
      .from('clients')
      .select('id')
      .eq('phone', phone)
      .eq('status', 'active')
      .single();

    if (existingClient) {
      // Active client messaging — don't run lead flow
      return res.status(200).json({ action: 'active_client', client_id: existingClient.id });
    }

    if (!existingLead) {
      // FLOW A: New lead
      const market = detectMarket(phone);
      const { data: newLead } = await supabase
        .from('leads')
        .insert({
          phone,
          name: name || null,
          source: 'whatsapp',
          status: 'new',
          first_msg: message,
          last_msg_at: new Date().toISOString(),
          market
        })
        .select()
        .single();

      // Send welcome template
      const welcomeTemplate = market === 'IN' ? 'welcome_v1_hindi' : 'welcome_v1';
      await sendTemplate(phone, welcomeTemplate, [name || 'there']);

      return res.status(200).json({ action: 'new_lead', lead_id: newLead.id });
    }

    // Existing lead — update last message
    await supabase
      .from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('id', existingLead.id);

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'lead_dropped', note: 'No further messages' });
    }

    // FLOW B: Qualify based on reply
    const program = classifyMessage(message);
    if (program) {
      await supabase
        .from('leads')
        .update({ status: 'qualified', program_interest: program })
        .eq('id', existingLead.id);

      const market = existingLead.market || 'IN';
      const checkoutLink = CHECKOUT_LINKS[program];
      const intakeLink = `https://fitnessbymaddy.com/intake?lead=${existingLead.id}`;

      // Send checkout + intake links
      const templateName = market === 'IN' ? 'program_link_hindi' : 'program_link';
      await sendTemplate(phone, templateName, [checkoutLink, intakeLink]);

      return res.status(200).json({ action: 'qualified', program, lead_id: existingLead.id });
    }

    return res.status(200).json({ action: 'no_match', lead_id: existingLead.id });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function parseWebhookPayload(body) {
  // AiSensy webhook format
  if (body.phone_number) {
    return {
      phone: body.phone_number,
      message: body.message || body.text || '',
      name: body.name || body.pushName || null,
      timestamp: body.timestamp || null
    };
  }
  // Meta Cloud API format (fallback)
  if (body.entry && body.entry[0]) {
    const change = body.entry[0].changes?.[0]?.value;
    const msg = change?.messages?.[0];
    if (msg) {
      const contact = change.contacts?.[0];
      return {
        phone: '+' + msg.from,
        message: msg.text?.body || '',
        name: contact?.profile?.name || null,
        timestamp: msg.timestamp ? new Date(parseInt(msg.timestamp) * 1000).toISOString() : null
      };
    }
  }
  // Generic fallback
  return {
    phone: body.phone || body.from || null,
    message: body.message || body.text || body.body || '',
    name: body.name || null,
    timestamp: null
  };
}
