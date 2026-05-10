const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp, logMessage, maskPhone } = require('../lib/whatsapp');
const {
  detectMarket, matchProgram, needsEscalation, isOptOut,
  getCheckoutUrl, getIntakeUrl, PROGRAM_NAMES,
} = require('../lib/helpers');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method === 'GET') return res.status(200).json({ status: 'webhook active' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = req.body;
    const phone = extractPhone(body);
    const messageText = extractMessage(body);
    const senderName = extractName(body);

    if (!phone) return res.status(200).json({ ok: true, skipped: 'no phone' });

    const db = getSupabase();

    await logMessage(phone, 'in', messageText, null);

    if (isOptOut(messageText)) {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      console.log(`Opt-out: ${maskPhone(phone)}`);
      return res.status(200).json({ ok: true, action: 'opted_out' });
    }

    if (needsEscalation(messageText)) {
      await notifyMaddy(phone, messageText, 'escalation_keyword');
      return res.status(200).json({ ok: true, action: 'escalated' });
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      return await handleNewLead(db, phone, senderName, messageText, res);
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ ok: true, skipped: 'dropped_lead' });
    }

    if (existingLead.status === 'new') {
      return await handleLeadReply(db, existingLead, messageText, res);
    }

    await db.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('id', existingLead.id);
    return res.status(200).json({ ok: true, action: 'updated_timestamp' });

  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(200).json({ ok: false, error: 'internal' });
  }
};

async function handleNewLead(db, phone, name, messageText, res) {
  const market = detectMarket(phone);

  const { data: lead, error } = await db.from('leads').insert({
    phone,
    name: name || null,
    source: 'whatsapp',
    status: 'new',
    first_msg: messageText,
    last_msg_at: new Date().toISOString(),
    market,
  }).select().single();

  if (error) {
    console.error('Insert lead error:', error.message);
    return res.status(200).json({ ok: false, error: 'insert_failed' });
  }

  const welcomeParams = market === 'IN'
    ? [name || 'there']
    : [name || 'there'];

  await sendWhatsApp(phone, 'welcome_v1', welcomeParams);

  const programMatch = matchProgram(messageText);
  if (programMatch) {
    await db.from('leads').update({
      status: 'qualified',
      program_interest: programMatch,
    }).eq('id', lead.id);

    const checkoutUrl = getCheckoutUrl(programMatch);
    const intakeUrl = getIntakeUrl(lead.id);
    const programName = PROGRAM_NAMES[programMatch];

    await sendWhatsApp(phone, 'program_match_v1', [
      name || 'there',
      programName,
      checkoutUrl,
      intakeUrl,
    ]);
  }

  return res.status(200).json({ ok: true, action: 'new_lead', leadId: lead.id });
}

async function handleLeadReply(db, lead, messageText, res) {
  const programMatch = matchProgram(messageText);

  if (programMatch) {
    await db.from('leads').update({
      status: 'qualified',
      program_interest: programMatch,
      last_msg_at: new Date().toISOString(),
    }).eq('id', lead.id);

    const checkoutUrl = getCheckoutUrl(programMatch);
    const intakeUrl = getIntakeUrl(lead.id);
    const programName = PROGRAM_NAMES[programMatch];

    await sendWhatsApp(lead.phone, 'program_match_v1', [
      lead.name || 'there',
      programName,
      checkoutUrl,
      intakeUrl,
    ]);

    return res.status(200).json({ ok: true, action: 'qualified', program: programMatch });
  }

  await db.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('id', lead.id);
  return res.status(200).json({ ok: true, action: 'reply_logged' });
}

async function notifyMaddy(phone, messageText, reason) {
  const masked = maskPhone(phone);
  const truncated = messageText ? messageText.substring(0, 200) : '(no text)';

  await sendWhatsApp(
    process.env.MADDY_PHONE || '+917082478374',
    'escalation_alert',
    [reason, masked, truncated]
  );
}

function extractPhone(body) {
  if (body?.mobile) return body.mobile;
  if (body?.waId) return body.waId;
  if (body?.entry?.[0]?.changes?.[0]?.value?.contacts?.[0]?.wa_id) {
    return body.entry[0].changes[0].value.contacts[0].wa_id;
  }
  if (body?.phone) return body.phone;
  return null;
}

function extractMessage(body) {
  if (body?.text) return body.text;
  if (body?.message) return body.message;
  if (body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.text?.body) {
    return body.entry[0].changes[0].value.messages[0].text.body;
  }
  return null;
}

function extractName(body) {
  if (body?.name) return body.name;
  if (body?.pushName) return body.pushName;
  if (body?.entry?.[0]?.changes?.[0]?.value?.contacts?.[0]?.profile?.name) {
    return body.entry[0].changes[0].value.contacts[0].profile.name;
  }
  return null;
}
