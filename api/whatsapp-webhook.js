const { supabase } = require('../lib/supabase');
const { sendWhatsApp, detectMarket, maskPhone } = require('../lib/whatsapp');
const { needsEscalation, escalateToMaddy } = require('../lib/escalation');

const PROGRAM_MAP = {
  'fat loss': '6wk_gym', 'weight': '6wk_gym', 'shred': '6wk_gym', 'weight loss': '6wk_gym',
  'pcos': 'pcos', 'hormonal': 'pcos', 'pcod': 'pcos',
  '40': '40plus', 'menopause': '40plus', 'joints': '40plus', '40+': '40plus',
  'custom': '12wk', '12 week': '12wk', 'serious': '12wk', 'personalised': '12wk', 'personalized': '12wk',
  'trial': 'zoom_trial', 'zoom': 'zoom_trial', 'not sure': 'zoom_trial', 'try': 'zoom_trial'
};

const CHECKOUT_URLS = {
  '6wk_gym': 'https://fitnessbymaddyy.exlyapp.com/checkout/6wk-burn',
  '6wk_home': 'https://fitnessbymaddyy.exlyapp.com/checkout/6wk-home',
  '12wk': 'https://fitnessbymaddyy.exlyapp.com/checkout/12wk-flagship',
  'pcos': 'https://fitnessbymaddyy.exlyapp.com/checkout/pcos-warrior',
  '40plus': 'https://fitnessbymaddyy.exlyapp.com/checkout/40plus-strong',
  'zoom_trial': 'https://fitnessbymaddyy.exlyapp.com/checkout/zoom-trial'
};

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { phone, message, name } = parseWebhookBody(req.body);
    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    // Log inbound message
    await supabase.from('messages').insert({
      phone, direction: 'in', body: message
    });

    const lower = (message || '').toLowerCase().trim();

    // STOP handling
    if (lower === 'stop' || lower === 'unsubscribe') {
      await supabase.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.json({ action: 'opted_out' });
    }

    // Escalation check
    if (needsEscalation(message)) {
      await escalateToMaddy({
        reason: 'Keyword trigger in message',
        phone,
        context: message?.substring(0, 200)
      });
    }

    // Check existing lead
    const { data: existing } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existing) {
      // New lead
      const market = detectMarket(phone);
      await supabase.from('leads').insert({
        phone,
        name: name || null,
        source: 'whatsapp',
        status: 'new',
        first_msg: message,
        market
      });

      await sendWhatsApp({
        phone,
        templateName: 'welcome_v1',
        params: [name || 'there'],
        bypassRateLimit: true
      });

      return res.json({ action: 'new_lead', market });
    }

    if (existing.status === 'dropped') {
      return res.json({ action: 'ignored_dropped' });
    }

    // Update last_msg_at
    await supabase.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('id', existing.id);

    // Qualification routing
    if (existing.status === 'new') {
      const program = matchProgram(lower);
      if (program) {
        await supabase.from('leads').update({
          status: 'qualified',
          program_interest: program
        }).eq('id', existing.id);

        const checkoutUrl = CHECKOUT_URLS[program] || CHECKOUT_URLS['zoom_trial'];
        const intakeUrl = `https://fitnessbymaddy.com/intake?lead=${existing.id}`;

        const market = existing.market || 'IN';
        const msgParams = market === 'IN'
          ? [name || 'there', checkoutUrl, intakeUrl]
          : [name || 'there', checkoutUrl, intakeUrl];

        await sendWhatsApp({
          phone,
          templateName: 'qualified_checkout',
          params: msgParams,
          bypassRateLimit: true
        });

        return res.json({ action: 'qualified', program });
      }
    }

    return res.json({ action: 'message_logged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function parseWebhookBody(body) {
  // AiSensy webhook format
  if (body?.phone) return { phone: body.phone, message: body.message, name: body.name };
  // Meta Cloud API format
  if (body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]) {
    const msg = body.entry[0].changes[0].value.messages[0];
    const contact = body.entry[0].changes[0].value.contacts?.[0];
    return {
      phone: '+' + msg.from,
      message: msg.text?.body || '',
      name: contact?.profile?.name
    };
  }
  return { phone: body?.from, message: body?.text || body?.body, name: body?.name };
}

function matchProgram(text) {
  for (const [keyword, program] of Object.entries(PROGRAM_MAP)) {
    if (text.includes(keyword)) return program;
  }
  return null;
}
