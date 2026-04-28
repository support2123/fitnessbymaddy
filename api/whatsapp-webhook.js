const { supabase } = require('./lib/supabase');
const { sendTemplate } = require('./lib/whatsapp');
const { detectMarket, classifyIntent, needsEscalation, isOptOut } = require('./lib/helpers');
const { notifyMaddy } = require('./lib/escalate');

module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
    return res.status(200).json({ status: 'webhook active' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const payload = req.body;
    const phone = payload.senderPhone || payload.waId || payload.from;
    const message = payload.text || payload.message || payload.body || '';
    const senderName = payload.senderName || payload.pushName || null;

    if (!phone) {
      return res.status(400).json({ error: 'No phone number in payload' });
    }

    await supabase.from('messages').insert({
      phone,
      direction: 'in',
      body: message,
    });

    if (isOptOut(message)) {
      await supabase
        .from('leads')
        .update({ status: 'dropped', last_msg_at: new Date().toISOString() })
        .eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(message)) {
      await notifyMaddy('Keyword trigger in message', {
        name: senderName,
        phone,
        details: message.slice(0, 200),
      });
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      return await handleNewLead(res, phone, message, senderName);
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'ignored_dropped' });
    }

    return await handleExistingLead(res, existingLead, message);
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function handleNewLead(res, phone, message, name) {
  const market = detectMarket(phone);

  const { data: lead } = await supabase
    .from('leads')
    .insert({
      phone,
      name,
      source: 'whatsapp',
      status: 'new',
      first_msg: message,
      market,
    })
    .select()
    .single();

  const intent = classifyIntent(message);
  if (intent) {
    await supabase
      .from('leads')
      .update({ program_interest: intent.program, status: 'qualified' })
      .eq('id', lead.id);

    await sendTemplate(phone, 'program_match', {
      name: name || 'there',
      templateParams: [
        name || 'there',
        intent.label,
        `https://fitnessbymaddyy.exlyapp.com/checkout/${intent.program}`,
        `https://fitnessbymaddy.com/intake.html?lead=${lead.id}`,
      ],
    });

    return res.status(200).json({ action: 'qualified', program: intent.program });
  }

  const welcomeTemplate = market === 'IN' ? 'welcome_v1_hi' : 'welcome_v1_en';
  await sendTemplate(phone, welcomeTemplate, {
    name: name || 'there',
    templateParams: [name || 'there'],
  });

  return res.status(200).json({ action: 'new_lead', id: lead.id });
}

async function handleExistingLead(res, lead, message) {
  await supabase
    .from('leads')
    .update({ last_msg_at: new Date().toISOString() })
    .eq('id', lead.id);

  if (lead.status === 'new' || lead.status === 'qualified') {
    const intent = classifyIntent(message);
    if (intent) {
      await supabase
        .from('leads')
        .update({ program_interest: intent.program, status: 'qualified' })
        .eq('id', lead.id);

      await sendTemplate(lead.phone, 'program_match', {
        name: lead.name || 'there',
        templateParams: [
          lead.name || 'there',
          intent.label,
          `https://fitnessbymaddyy.exlyapp.com/checkout/${intent.program}`,
          `https://fitnessbymaddy.com/intake.html?lead=${lead.id}`,
        ],
      });

      return res.status(200).json({ action: 'qualified', program: intent.program });
    }
  }

  return res.status(200).json({ action: 'message_logged' });
}
