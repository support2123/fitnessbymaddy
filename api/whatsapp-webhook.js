const { supabase } = require('./_lib/supabase');
const { sendWhatsApp, maskPhone, detectMarket } = require('./_lib/whatsapp');
const { needsEscalation, escalateToMaddy, isOptOut } = require('./_lib/escalation');
const { qualifyLead } = require('./_lib/qualify');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { phone, message, name } = parseWebhookPayload(req.body);

    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    await supabase.from('messages').insert({
      phone: maskPhone(phone),
      direction: 'in',
      body: (message || '').substring(0, 1000),
      sent_at: new Date().toISOString(),
      status: 'received',
    });

    if (isOptOut(message)) {
      await supabase.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(message)) {
      await escalateToMaddy('Keyword trigger in message', { phone, message });
      return res.status(200).json({ action: 'escalated' });
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .maybeSingle();

    if (!existingLead) {
      return await handleNewLead(phone, name, message, res);
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'ignored_dropped' });
    }

    if (existingLead.status === 'new') {
      return await handleQualification(existingLead, message, res);
    }

    return res.status(200).json({ action: 'logged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function handleNewLead(phone, name, message, res) {
  const market = detectMarket(phone);

  const { data: lead } = await supabase
    .from('leads')
    .insert({
      phone,
      name: name || null,
      source: 'whatsapp',
      status: 'new',
      first_msg: (message || '').substring(0, 500),
      last_msg_at: new Date().toISOString(),
      market,
      created_at: new Date().toISOString(),
    })
    .select()
    .single();

  const welcomeParams = market === 'IN'
    ? ['Hi! Maddy\'s team here. Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?']
    : ['Hi! Maddy\'s team here. What\'s your goal — fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?'];

  await sendWhatsApp(phone, 'welcome_v1', welcomeParams);

  const qualification = qualifyLead(message);
  if (qualification) {
    await supabase.from('leads').update({
      status: 'qualified',
      program_interest: qualification.program,
    }).eq('id', lead.id);

    const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${qualification.checkout}`;
    const intakeUrl = `https://fitnessbymaddy.com/intake.html?lead=${lead.id}`;

    const qualifyParams = market === 'IN'
      ? [qualification.name, `$${qualification.price}`, checkoutUrl, intakeUrl]
      : [qualification.name, `$${qualification.price}`, checkoutUrl, intakeUrl];

    await sendWhatsApp(phone, 'program_recommendation', qualifyParams);
    return res.status(200).json({ action: 'new_lead_qualified', program: qualification.program });
  }

  return res.status(200).json({ action: 'new_lead_welcomed', lead_id: lead.id });
}

async function handleQualification(lead, message, res) {
  const qualification = qualifyLead(message);

  if (!qualification) {
    await supabase.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('id', lead.id);
    return res.status(200).json({ action: 'awaiting_qualification' });
  }

  await supabase.from('leads').update({
    status: 'qualified',
    program_interest: qualification.program,
    last_msg_at: new Date().toISOString(),
  }).eq('id', lead.id);

  const market = lead.market || 'GLOBAL';
  const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${qualification.checkout}`;
  const intakeUrl = `https://fitnessbymaddy.com/intake.html?lead=${lead.id}`;

  await sendWhatsApp(lead.phone, 'program_recommendation', [
    qualification.name,
    `$${qualification.price}`,
    checkoutUrl,
    intakeUrl,
  ]);

  return res.status(200).json({ action: 'qualified', program: qualification.program });
}

function parseWebhookPayload(body) {
  if (body.entry) {
    const change = body.entry?.[0]?.changes?.[0]?.value;
    const msg = change?.messages?.[0];
    return {
      phone: msg?.from || '',
      message: msg?.text?.body || '',
      name: change?.contacts?.[0]?.profile?.name || '',
    };
  }

  return {
    phone: body.phone || body.mobile || body.from || '',
    message: body.message || body.text || body.body || '',
    name: body.name || body.customer_name || '',
  };
}
