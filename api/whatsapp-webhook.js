const { supabase } = require('./_lib/supabase');
const { sendWhatsApp } = require('./_lib/whatsapp');
const { detectMarket, isHinglishMarket, maskPhone } = require('./_lib/market');
const { needsEscalation, isOptOut, escalateToMaddy } = require('./_lib/escalation');

const PROGRAM_ROUTES = {
  fat_loss: { program: '6wk_gym', name: '6 Week Burn & Build', price: '$97' },
  pcos: { program: 'pcos', name: 'PCOS Warrior', price: '$45' },
  '40plus': { program: '40plus', name: '40+ Strong', price: '$50' },
  flagship: { program: '12wk', name: '12-Week Custom Program', price: '$200' },
  trial: { program: 'zoom_trial', name: 'Zoom Trial Session', price: '$20' }
};

function classifyIntent(message) {
  if (!message) return null;
  const lower = message.toLowerCase();
  if (/fat\s*loss|weight|shred|lean|cut/i.test(lower)) return 'fat_loss';
  if (/pcos|hormonal|hormone/i.test(lower)) return 'pcos';
  if (/40|menopause|joints|senior|older/i.test(lower)) return '40plus';
  if (/custom|12\s*week|serious|flagship|transform/i.test(lower)) return 'flagship';
  if (/trial|zoom|not sure|try|test/i.test(lower)) return 'trial';
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { phone, message, name } = parseWebhookPayload(req.body);

    if (!phone) {
      return res.status(400).json({ error: 'Missing phone number' });
    }

    await supabase.from('messages').insert({
      phone,
      direction: 'in',
      body: message,
      status: 'received'
    });

    if (isOptOut(message)) {
      await supabase
        .from('leads')
        .update({ status: 'dropped' })
        .eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(message)) {
      await escalateToMaddy({
        reason: 'Flagged keyword in message',
        phone,
        clientName: name,
        details: message
      });
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    const market = detectMarket(phone);
    const hinglish = isHinglishMarket(market);

    if (!existingLead) {
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

      const welcomeTemplate = hinglish ? 'welcome_v1_hi' : 'welcome_v1';
      await sendWhatsApp({
        phone,
        templateName: welcomeTemplate,
        params: [name || 'there']
      });

      return res.status(200).json({ action: 'new_lead_created', lead_id: newLead.id });
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'lead_dropped_ignored' });
    }

    await supabase
      .from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('id', existingLead.id);

    const intent = classifyIntent(message);
    if (intent && existingLead.status === 'new') {
      const route = PROGRAM_ROUTES[intent];

      await supabase
        .from('leads')
        .update({
          status: 'qualified',
          program_interest: route.program
        })
        .eq('id', existingLead.id);

      const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${existingLead.id}`;
      const intakeUrl = `https://fitnessbymaddy.com/intake?lead=${existingLead.id}`;

      if (hinglish) {
        await sendWhatsApp({
          phone,
          templateName: 'program_match_hi',
          params: [
            name || 'there',
            route.name,
            route.price,
            checkoutUrl,
            intakeUrl
          ]
        });
      } else {
        await sendWhatsApp({
          phone,
          templateName: 'program_match',
          params: [
            name || 'there',
            route.name,
            route.price,
            checkoutUrl,
            intakeUrl
          ]
        });
      }

      return res.status(200).json({
        action: 'qualified',
        program: route.program,
        lead_id: existingLead.id
      });
    }

    return res.status(200).json({ action: 'message_logged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

function parseWebhookPayload(body) {
  if (!body) return {};

  if (body.phone) {
    return {
      phone: body.phone,
      message: body.message || body.text || '',
      name: body.name || body.pushName || null
    };
  }

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

  return {};
}
