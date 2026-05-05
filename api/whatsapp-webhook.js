const { getSupabase } = require('../lib/supabase');
const { sendTemplate, checkRateLimit, maskPhone } = require('../lib/whatsapp');
const { detectMarket, isHinglish } = require('../lib/market');
const { needsEscalation, escalateToMaddy, isOptOut } = require('../lib/escalation');
const { qualifyLead } = require('../lib/qualify');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const db = getSupabase();

  try {
    const { mobile, text, name } = parsePayload(req.body);
    if (!mobile) return res.status(400).json({ error: 'Missing phone' });

    await db.from('messages').insert({
      phone: mobile,
      direction: 'in',
      body: text,
    });

    if (isOptOut(text)) {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', mobile);
      return res.json({ action: 'opted_out' });
    }

    if (needsEscalation(text)) {
      await escalateToMaddy('Keyword trigger in incoming message', mobile, text);
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', mobile)
      .single();

    if (!existingLead) {
      return await handleNewLead(db, mobile, name, text, res);
    }

    if (existingLead.status === 'dropped') {
      return res.json({ action: 'ignored_dropped' });
    }

    return await handleReply(db, existingLead, text, res);
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function parsePayload(body) {
  if (!body) return {};
  // AiSensy webhook format
  if (body.mobile) return { mobile: body.mobile, text: body.text || '', name: body.name || '' };
  // Meta Cloud API format
  const entry = body.entry?.[0]?.changes?.[0]?.value;
  if (entry?.messages?.[0]) {
    const msg = entry.messages[0];
    const contact = entry.contacts?.[0];
    return {
      mobile: msg.from,
      text: msg.text?.body || '',
      name: contact?.profile?.name || '',
    };
  }
  return {};
}

function isOptOut(text) {
  if (!text) return false;
  const lower = text.trim().toLowerCase();
  return lower === 'stop' || lower === 'unsubscribe';
}

async function handleNewLead(db, phone, name, text, res) {
  const market = detectMarket(phone);

  const { data: lead } = await db.from('leads').insert({
    phone,
    name: name || null,
    first_msg: text,
    last_msg_at: new Date().toISOString(),
    market,
    status: 'new',
  }).select().single();

  const templateName = isHinglish(market) ? 'welcome_v1_hi' : 'welcome_v1';
  await sendTemplate(phone, templateName, [name || 'there']);

  return res.json({ action: 'new_lead', lead_id: lead.id });
}

async function handleReply(db, lead, text, res) {
  await db.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('id', lead.id);

  if (lead.status === 'new' || lead.status === 'qualified') {
    const match = qualifyLead(text);
    if (match) {
      await db.from('leads').update({
        status: 'qualified',
        program_interest: match.program,
      }).eq('id', lead.id);

      const canSend = await checkRateLimit(lead.phone);
      if (canSend) {
        const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${match.program}`;
        const intakeUrl = `https://fitnessbymaddy.com/intake.html?lead=${lead.id}`;

        const msg = isHinglish(lead.market)
          ? `${match.label} — perfect choice! Yahan se book karo: ${checkoutUrl}\n\nPehle ye form bhi fill kardo: ${intakeUrl}`
          : `${match.label} — great choice! Book here: ${checkoutUrl}\n\nAlso fill this quick form: ${intakeUrl}`;

        await sendTemplate(lead.phone, 'program_link', [match.label, checkoutUrl, intakeUrl]);
      }

      return res.json({ action: 'qualified', program: match.program });
    }
  }

  return res.json({ action: 'noted' });
}
