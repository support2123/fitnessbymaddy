const { supabase } = require('../lib/supabase');
const { sendTemplate, sendText, logMessage, maskPhone } = require('../lib/whatsapp');
const { detectMarket } = require('../lib/market');
const { needsEscalation, escalateToMaddy } = require('../lib/escalation');

const PROGRAM_KEYWORDS = {
  '6wk_gym': ['fat loss', 'weight loss', 'weight', 'shred', 'burn', 'lean', 'cut'],
  'pcos': ['pcos', 'hormonal', 'hormone', 'pcod', 'thyroid'],
  '40plus': ['40', 'menopause', 'joints', 'joint', 'senior', '50', 'over 40'],
  '12wk': ['custom', '12 week', 'serious', 'transform', 'flagship', 'personalised', 'personalized'],
  'zoom_trial': ['trial', 'zoom', 'not sure', 'try', 'test']
};

const STOP_WORDS = ['stop', 'unsubscribe', 'opt out', 'optout', 'cancel'];

function classifyIntent(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  for (const [program, keywords] of Object.entries(PROGRAM_KEYWORDS)) {
    if (keywords.some(kw => lower.includes(kw))) return program;
  }
  return null;
}

function isOptOut(text) {
  if (!text) return false;
  const lower = text.toLowerCase().trim();
  return STOP_WORDS.some(w => lower.includes(w));
}

module.exports = async function handler(req, res) {
  // WhatsApp Cloud API verification (GET)
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && token === process.env.WA_VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }
    return res.status(403).json({ error: 'Forbidden' });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { phone, name, text } = extractMessage(req.body);
    if (!phone || !text) return res.status(200).json({ ok: true, skipped: 'no_message' });

    // Log incoming message
    await logMessage(phone, 'in', text, null, 'received');

    // Opt-out check
    if (isOptOut(text)) {
      await supabase.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      await supabase.from('clients').update({ status: 'paused' }).eq('phone', phone);
      console.log(`Opt-out: ${maskPhone(phone)}`);
      return res.status(200).json({ ok: true, action: 'opted_out' });
    }

    // Escalation check
    if (needsEscalation(text)) {
      await escalateToMaddy('Keyword trigger in message', { phone, name, details: text });
    }

    // Check if existing lead
    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    // Check if existing client
    const { data: existingClient } = await supabase
      .from('clients')
      .select('*')
      .eq('phone', phone)
      .single();

    if (existingClient && existingClient.status === 'active') {
      // Active client — respond conversationally or route to support
      await supabase.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('phone', phone);
      return res.status(200).json({ ok: true, action: 'active_client_message' });
    }

    if (!existingLead) {
      // NEW LEAD — Flow A
      const market = detectMarket(phone);
      await supabase.from('leads').insert({
        phone,
        name: name || null,
        source: 'whatsapp',
        status: 'new',
        first_msg: text,
        last_msg_at: new Date().toISOString(),
        market
      });

      // Send welcome template
      await sendTemplate(phone, 'welcome_v1', {
        name: name || 'there',
        templateParams: [name || 'there']
      });

      return res.status(200).json({ ok: true, action: 'new_lead_created' });
    }

    // Existing lead — Flow B qualification
    if (existingLead.status === 'new' || existingLead.status === 'qualified') {
      const program = classifyIntent(text);
      const updates = { last_msg_at: new Date().toISOString() };

      if (program) {
        updates.status = 'qualified';
        updates.program_interest = program;
        await supabase.from('leads').update(updates).eq('id', existingLead.id);

        // Send checkout link + intake form
        const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${existingLead.id}`;
        const intakeUrl = `https://fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;

        const market = existingLead.market || detectMarket(phone);
        let msg;
        if (market === 'IN') {
          msg = `Perfect ${name || ''}! Aapke liye ${formatProgram(program)} ready hai.\n\nCheckout: ${checkoutUrl}\n\nPehle ye form bhar do: ${intakeUrl}`;
        } else {
          msg = `Perfect ${name || ''}! The ${formatProgram(program)} is ideal for your goal.\n\nCheckout: ${checkoutUrl}\n\nPlease fill out this form first: ${intakeUrl}`;
        }
        await sendText(phone, msg);
      } else {
        await supabase.from('leads').update(updates).eq('id', existingLead.id);
      }

      return res.status(200).json({ ok: true, action: program ? 'qualified' : 'message_logged' });
    }

    // Dropped lead messaging back — re-engage
    if (existingLead.status === 'dropped') {
      await supabase.from('leads').update({
        status: 'new',
        last_msg_at: new Date().toISOString()
      }).eq('id', existingLead.id);

      await sendTemplate(phone, 'welcome_v1', {
        name: name || 'there',
        templateParams: [name || 'there']
      });

      return res.status(200).json({ ok: true, action: 're_engaged' });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(200).json({ ok: true, error: 'internal' });
  }
};

function extractMessage(body) {
  // Meta Cloud API format
  if (body.entry) {
    try {
      const value = body.entry[0].changes[0].value;
      if (!value.messages || !value.messages.length) return {};
      const msg = value.messages[0];
      const contact = value.contacts && value.contacts[0];
      return {
        phone: '+' + msg.from,
        name: contact ? contact.profile.name : null,
        text: msg.text ? msg.text.body : (msg.button ? msg.button.text : null)
      };
    } catch (e) { return {}; }
  }

  // AiSensy native format
  if (body.data) {
    try {
      const jid = body.data.key.remoteJid || '';
      const phone = '+' + jid.replace('@s.whatsapp.net', '');
      const text = body.data.message.conversation ||
        (body.data.message.extendedTextMessage && body.data.message.extendedTextMessage.text) || '';
      return { phone, name: body.data.pushName || null, text };
    } catch (e) { return {}; }
  }

  // Simple flat format (some providers)
  if (body.phone || body.from) {
    const phone = body.phone || body.from;
    return {
      phone: phone.startsWith('+') ? phone : '+' + phone,
      name: body.name || body.contactName || null,
      text: body.message || body.text || body.body || null
    };
  }

  return {};
}

function formatProgram(program) {
  const map = {
    '6wk_gym': '6-Week Burn & Build',
    'pcos': 'PCOS Warrior Program',
    '40plus': '40+ Strong Program',
    '12wk': '12-Week Custom Flagship',
    'zoom_trial': '$20 Zoom Trial'
  };
  return map[program] || program;
}
