const { getSupabase } = require('./_lib/supabase');
const { sendWhatsApp, logMessage } = require('./_lib/whatsapp');
const { detectMarket, isHinglish } = require('./_lib/market');
const { qualifyLead, isOptOut } = require('./_lib/qualify');
const { needsEscalation, escalateToMaddy } = require('./_lib/escalation');
const { maskPhone } = require('./_lib/masking');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const payload = req.body;
    const phone = extractPhone(payload);
    const messageText = extractMessage(payload);
    const senderName = extractName(payload);

    if (!phone) return res.status(400).json({ error: 'No phone number found' });

    await logMessage({
      phone,
      direction: 'in',
      body: messageText,
      template_name: null,
      status: 'received',
    });

    if (isOptOut(messageText)) {
      await handleOptOut(phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(messageText)) {
      await escalateToMaddy({
        reason: 'Keyword trigger in incoming message',
        phone: maskPhone(phone),
        message: messageText,
      });
    }

    const db = getSupabase();
    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .order('created_at', { ascending: false })
      .limit(1);

    if (existingLead && existingLead.length > 0) {
      await handleExistingLead(existingLead[0], messageText, phone);
    } else {
      await handleNewLead(phone, messageText, senderName);
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Webhook error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

async function handleNewLead(phone, messageText, name) {
  const db = getSupabase();
  const market = detectMarket(phone);

  const { data: lead } = await db.from('leads').insert({
    phone,
    name: name || null,
    source: 'whatsapp',
    status: 'new',
    first_msg: messageText,
    last_msg_at: new Date().toISOString(),
    market,
  }).select().single();

  const hinglish = isHinglish(market);

  await sendWhatsApp({
    phone,
    templateName: 'welcome_v1',
    bodyValues: hinglish
      ? [name || 'there']
      : [name || 'there'],
  });

  const qualification = qualifyLead(messageText);
  if (qualification) {
    await db.from('leads').update({
      status: 'qualified',
      program_interest: qualification.program,
    }).eq('id', lead.id);

    await sendProgramLink(phone, qualification, lead.id, hinglish);
  }
}

async function handleExistingLead(lead, messageText, phone) {
  const db = getSupabase();

  await db.from('leads').update({
    last_msg_at: new Date().toISOString(),
  }).eq('id', lead.id);

  if (lead.status === 'dropped') {
    return;
  }

  if (lead.status === 'new' || lead.status === 'qualified') {
    const qualification = qualifyLead(messageText);
    if (qualification) {
      const hinglish = isHinglish(lead.market);
      await db.from('leads').update({
        status: 'qualified',
        program_interest: qualification.program,
      }).eq('id', lead.id);
      await sendProgramLink(phone, qualification, lead.id, hinglish);
    }
  }
}

async function sendProgramLink(phone, qualification, leadId, hinglish) {
  const checkoutSlug = getCheckoutSlug(qualification.program);
  const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${checkoutSlug}`;
  const intakeUrl = `https://fitnessbymaddy.com/intake.html?lead=${leadId}`;

  await sendWhatsApp({
    phone,
    templateName: 'program_link',
    bodyValues: [
      qualification.label,
      checkoutUrl,
      intakeUrl,
    ],
  });
}

function getCheckoutSlug(program) {
  const slugs = {
    '6wk_gym': '6-week-burn-build',
    '6wk_home': '6-week-home',
    '12wk': '12-week-custom',
    'pcos': 'pcos-warrior',
    '40plus': '40plus-strong',
    'zoom_trial': 'zoom-trial',
    'zoom_pack': 'zoom-pack',
  };
  return slugs[program] || program;
}

async function handleOptOut(phone) {
  const db = getSupabase();
  await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
  await db.from('clients').update({ status: 'paused' }).eq('phone', phone).eq('status', 'active');
}

function extractPhone(payload) {
  if (payload?.contact?.phone) return '+' + payload.contact.phone;
  if (payload?.waId) return '+' + payload.waId;
  if (payload?.from) return payload.from.startsWith('+') ? payload.from : '+' + payload.from;
  if (payload?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.from) {
    return '+' + payload.entry[0].changes[0].value.messages[0].from;
  }
  return null;
}

function extractMessage(payload) {
  if (payload?.text) return payload.text;
  if (payload?.message?.text) return payload.message.text;
  if (payload?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.text?.body) {
    return payload.entry[0].changes[0].value.messages[0].text.body;
  }
  return '';
}

function extractName(payload) {
  if (payload?.contact?.name) return payload.contact.name;
  if (payload?.profileName) return payload.profileName;
  if (payload?.entry?.[0]?.changes?.[0]?.value?.contacts?.[0]?.profile?.name) {
    return payload.entry[0].changes[0].value.contacts[0].profile.name;
  }
  return null;
}
