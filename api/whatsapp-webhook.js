const { getSupabase } = require('./lib/supabase');
const { sendWhatsApp, maskPhone, detectMarket } = require('./lib/whatsapp');
const { needsEscalation, escalateToMaddy } = require('./lib/escalation');
const { qualifyLead, buildCheckoutUrl, buildIntakeUrl } = require('./lib/qualify');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const db = getSupabase();

  try {
    const { mobile: phone, text: message, name } = parseWebhookBody(req.body);

    if (!phone || !message) {
      return res.status(400).json({ error: 'Missing phone or message' });
    }

    await db.from('messages').insert({
      phone,
      direction: 'in',
      body: message,
    });

    if (isOptOut(message)) {
      await db.from('leads').update({ opted_out: true, status: 'dropped' }).eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(message)) {
      await escalateToMaddy('Sensitive keyword detected', { phone, message });
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .limit(1)
      .single();

    if (existingLead && existingLead.opted_out) {
      return res.status(200).json({ action: 'ignored_opted_out' });
    }

    if (!existingLead) {
      return await handleNewLead(db, phone, message, name, res);
    }

    if (existingLead.status === 'new') {
      return await handleLeadReply(db, existingLead, message, res);
    }

    return res.status(200).json({ action: 'logged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function handleNewLead(db, phone, message, name, res) {
  const market = detectMarket(phone);

  const { data: lead } = await db.from('leads').insert({
    phone,
    name: name || null,
    source: 'whatsapp',
    status: 'new',
    first_msg: message,
    last_msg_at: new Date().toISOString(),
    market,
  }).select().single();

  const welcomeParams = market === 'IN'
    ? ['Hi! Maddy\'s team here. Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?']
    : ['Hi! Maddy\'s team here. What\'s your goal — fat loss, PCOS management, strength, or 40+ fitness? Or try a trial session first?'];

  await sendWhatsApp(phone, 'welcome_v1', welcomeParams);

  return res.status(200).json({ action: 'new_lead', leadId: lead.id });
}

async function handleLeadReply(db, lead, message, res) {
  await db.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('id', lead.id);

  const match = qualifyLead(message);

  if (!match) {
    return res.status(200).json({ action: 'unmatched_reply' });
  }

  await db.from('leads').update({
    status: 'qualified',
    program_interest: match.program,
  }).eq('id', lead.id);

  const checkoutUrl = buildCheckoutUrl(match.checkoutPath);
  const intakeUrl = buildIntakeUrl(lead.id);

  const isHinglish = lead.market === 'IN';

  const params = isHinglish
    ? [
        lead.name || 'there',
        match.label,
        match.price,
        checkoutUrl,
        intakeUrl,
      ]
    : [
        lead.name || 'there',
        match.label,
        match.price,
        checkoutUrl,
        intakeUrl,
      ];

  await sendWhatsApp(lead.phone, 'program_recommendation', params);

  return res.status(200).json({ action: 'qualified', program: match.program });
}

function parseWebhookBody(body) {
  if (!body) return {};

  if (body.mobile && body.text) {
    return { mobile: body.mobile, text: body.text, name: body.name };
  }

  if (body.entry) {
    const changes = body.entry?.[0]?.changes?.[0]?.value;
    const msg = changes?.messages?.[0];
    const contact = changes?.contacts?.[0];
    if (msg) {
      return {
        mobile: msg.from,
        text: msg.text?.body || '',
        name: contact?.profile?.name,
      };
    }
  }

  return {};
}

function isOptOut(message) {
  const lower = (message || '').toLowerCase().trim();
  return ['stop', 'unsubscribe', 'opt out', 'optout', 'cancel'].includes(lower);
}
