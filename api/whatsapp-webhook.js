const { supabase } = require('./lib/supabase');
const { sendWhatsApp, detectMarket, classifyIntent, needsEscalation, maskPhone } = require('./lib/whatsapp');
const { escalateToMaddy } = require('./lib/escalate');

module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
    const challenge = req.query['hub.challenge'];
    if (challenge) return res.status(200).send(challenge);
    return res.status(200).json({ status: 'ok' });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = req.body;
    const message = extractMessage(body);
    if (!message) return res.status(200).json({ status: 'no_message' });

    const { phone, text, name } = message;

    await supabase.from('messages').insert({
      phone: maskPhone(phone),
      direction: 'in',
      body: text,
      sent_at: new Date().toISOString(),
      status: 'received'
    });

    if (/^(stop|unsubscribe|opt.?out)$/i.test(text.trim())) {
      await supabase.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.status(200).json({ status: 'opted_out' });
    }

    if (needsEscalation(text)) {
      await escalateToMaddy('Keyword trigger in message', {
        name, phone, details: text.slice(0, 200)
      });
    }

    const { data: existingClient } = await supabase
      .from('clients')
      .select('id, status')
      .eq('phone', phone)
      .eq('status', 'active')
      .limit(1);

    if (existingClient && existingClient.length > 0) {
      return res.status(200).json({ status: 'active_client', handled: 'pass_to_support' });
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('id, status')
      .eq('phone', phone)
      .limit(1);

    if (existingLead && existingLead.length > 0) {
      const lead = existingLead[0];
      if (lead.status === 'dropped') {
        return res.status(200).json({ status: 'dropped_lead' });
      }
      await handleReturningLead(lead, text, phone);
      return res.status(200).json({ status: 'returning_lead_handled' });
    }

    const market = detectMarket(phone);
    const { data: newLead } = await supabase.from('leads').insert({
      phone,
      name: name || null,
      source: 'whatsapp',
      status: 'new',
      first_msg: text,
      last_msg_at: new Date().toISOString(),
      market,
      created_at: new Date().toISOString()
    }).select().single();

    const welcomeTemplate = market === 'IN' ? 'welcome_v1_hindi' : 'welcome_v1';
    await sendWhatsApp(phone, welcomeTemplate, {
      name: name || 'there',
      templateParams: [name || 'there']
    });

    return res.status(200).json({ status: 'new_lead_created', id: newLead?.id });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function handleReturningLead(lead, text, phone) {
  const intent = classifyIntent(text);

  await supabase.from('leads').update({
    last_msg_at: new Date().toISOString(),
    program_interest: intent,
    status: 'qualified'
  }).eq('id', lead.id);

  if (intent) {
    const checkoutLinks = {
      '6wk_gym': 'https://fitnessbymaddyy.exlyapp.com/checkout/6wk-shred',
      '6wk_home': 'https://fitnessbymaddyy.exlyapp.com/checkout/6wk-home',
      '12wk': 'https://fitnessbymaddyy.exlyapp.com/checkout/12wk-custom',
      'pcos': 'https://fitnessbymaddyy.exlyapp.com/checkout/pcos-warrior',
      '40plus': 'https://fitnessbymaddyy.exlyapp.com/checkout/40plus-strong',
      'zoom_trial': 'https://fitnessbymaddyy.exlyapp.com/checkout/zoom-trial'
    };

    await sendWhatsApp(phone, 'program_link', {
      templateParams: [
        checkoutLinks[intent] || checkoutLinks['zoom_trial'],
        `https://fitnessbymaddy.com/intake?lead=${lead.id}`
      ]
    }, true);
  }
}

function extractMessage(body) {
  if (body.entry) {
    const entry = body.entry[0];
    const changes = entry?.changes?.[0];
    const msg = changes?.value?.messages?.[0];
    if (!msg) return null;
    return {
      phone: msg.from,
      text: msg.text?.body || '',
      name: changes?.value?.contacts?.[0]?.profile?.name || ''
    };
  }

  if (body.phone || body.mobile) {
    return {
      phone: body.phone || body.mobile,
      text: body.message || body.text || '',
      name: body.name || ''
    };
  }

  return null;
}
