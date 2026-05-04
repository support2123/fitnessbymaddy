const { supabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { detectMarket, isHinglish, maskPhone } = require('../lib/market');
const { needsEscalation, escalate } = require('../lib/escalation');

const PROGRAM_ROUTES = {
  'fat loss':  { program: '6wk_gym', name: '6-Week Burn & Build', price: 97, checkoutSlug: '6-week-shred' },
  'weight':    { program: '6wk_gym', name: '6-Week Burn & Build', price: 97, checkoutSlug: '6-week-shred' },
  'shred':     { program: '6wk_gym', name: '6-Week Burn & Build', price: 97, checkoutSlug: '6-week-shred' },
  'pcos':      { program: 'pcos',    name: 'PCOS Warrior', price: 45, checkoutSlug: 'pcos-warrior' },
  'hormonal':  { program: 'pcos',    name: 'PCOS Warrior', price: 45, checkoutSlug: 'pcos-warrior' },
  '40':        { program: '40plus',  name: '40+ Strong', price: 50, checkoutSlug: '40-plus-strong' },
  'menopause': { program: '40plus',  name: '40+ Strong', price: 50, checkoutSlug: '40-plus-strong' },
  'joints':    { program: '40plus',  name: '40+ Strong', price: 50, checkoutSlug: '40-plus-strong' },
  'custom':    { program: '12wk',    name: '12-Week Flagship', price: 200, checkoutSlug: '12-week-custom' },
  '12 week':   { program: '12wk',    name: '12-Week Flagship', price: 200, checkoutSlug: '12-week-custom' },
  'serious':   { program: '12wk',    name: '12-Week Flagship', price: 200, checkoutSlug: '12-week-custom' },
  'trial':     { program: 'zoom_trial', name: 'Zoom Trial', price: 20, checkoutSlug: 'zoom-trial' },
  'zoom':      { program: 'zoom_trial', name: 'Zoom Trial', price: 20, checkoutSlug: 'zoom-trial' },
  'not sure':  { program: 'zoom_trial', name: 'Zoom Trial', price: 20, checkoutSlug: 'zoom-trial' }
};

const OPT_OUT_WORDS = ['stop', 'unsubscribe', 'opt out', 'optout'];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { phone, message, name } = parseWebhookPayload(req.body);

    if (!phone || !message) {
      return res.status(400).json({ error: 'Missing phone or message' });
    }

    await supabase.from('messages').insert({
      phone,
      direction: 'in',
      body: message.substring(0, 2000)
    });

    if (OPT_OUT_WORDS.some(w => message.toLowerCase().includes(w))) {
      await supabase
        .from('leads')
        .update({ status: 'dropped' })
        .eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(message)) {
      await escalate({ phone, reason: 'keyword_trigger', messageBody: message });
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      return await handleNewLead(phone, message, name, res);
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'ignored_dropped' });
    }

    if (existingLead.status === 'new') {
      return await handleQualification(existingLead, message, res);
    }

    await supabase
      .from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('id', existingLead.id);

    return res.status(200).json({ action: 'noted' });

  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function handleNewLead(phone, message, name, res) {
  const market = detectMarket(phone);

  const { data: lead } = await supabase
    .from('leads')
    .insert({
      phone,
      name: name || null,
      source: 'whatsapp',
      status: 'new',
      first_msg: message.substring(0, 500),
      market
    })
    .select()
    .single();

  const hinglish = isHinglish(market);

  if (hinglish) {
    await sendWhatsApp({
      phone,
      templateName: 'welcome_v1',
      params: [name || 'there']
    });
  } else {
    await sendWhatsApp({
      phone,
      templateName: 'welcome_v1_en',
      params: [name || 'there']
    });
  }

  return res.status(200).json({ action: 'new_lead', leadId: lead.id });
}

async function handleQualification(lead, message, res) {
  const lower = message.toLowerCase();
  let matched = null;

  for (const [keyword, route] of Object.entries(PROGRAM_ROUTES)) {
    if (lower.includes(keyword)) {
      matched = route;
      break;
    }
  }

  if (!matched) {
    return res.status(200).json({ action: 'unmatched_reply' });
  }

  await supabase
    .from('leads')
    .update({
      status: 'qualified',
      program_interest: matched.program,
      last_msg_at: new Date().toISOString()
    })
    .eq('id', lead.id);

  const hinglish = isHinglish(lead.market);
  const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${matched.checkoutSlug}`;
  const intakeUrl = `https://fitnessbymaddy.com/intake.html?lead=${lead.id}`;

  if (hinglish) {
    await sendWhatsApp({
      phone: lead.phone,
      templateName: 'program_offer',
      params: [
        matched.name,
        `$${matched.price}`,
        checkoutUrl,
        intakeUrl
      ]
    });
  } else {
    await sendWhatsApp({
      phone: lead.phone,
      templateName: 'program_offer_en',
      params: [
        matched.name,
        `$${matched.price}`,
        checkoutUrl,
        intakeUrl
      ]
    });
  }

  return res.status(200).json({ action: 'qualified', program: matched.program });
}

function parseWebhookPayload(body) {
  if (!body) return {};

  if (body.phone && body.message) {
    return { phone: body.phone, message: body.message, name: body.name };
  }

  if (body.entry) {
    try {
      const change = body.entry[0].changes[0].value;
      const msg = change.messages && change.messages[0];
      if (msg) {
        const contact = change.contacts && change.contacts[0];
        return {
          phone: '+' + msg.from,
          message: msg.text ? msg.text.body : '',
          name: contact ? contact.profile.name : null
        };
      }
    } catch (e) { /* fallthrough */ }
  }

  return {};
}
