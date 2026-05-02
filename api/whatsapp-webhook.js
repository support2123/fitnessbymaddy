const { getSupabase } = require('./_lib/supabase');
const { sendTemplate, sendTextMessage, logMessage, notifyMaddy } = require('./_lib/whatsapp');
const {
  maskPhone, detectMarket, isHinglishMarket,
  checkEscalation, checkOptOut, matchProgram,
  programDisplayName, programPrice, handleCors
} = require('./_lib/utils');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const payload = req.body;
    const phone = extractPhone(payload);
    const text = extractText(payload);
    const senderName = extractName(payload);

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    console.log(`Incoming from ${maskPhone(phone)}: ${text ? text.slice(0, 50) : '[no text]'}`);

    await logMessage(phone, 'in', text, null);

    if (checkOptOut(text)) {
      await handleOptOut(phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (checkEscalation(text)) {
      await notifyMaddy(
        `Escalation from ${maskPhone(phone)}`,
        `Message: ${text}\nName: ${senderName || 'Unknown'}`
      );
    }

    const db = getSupabase();

    const { data: existingClient } = await db
      .from('clients')
      .select('*')
      .eq('phone', phone)
      .eq('status', 'active')
      .single();

    if (existingClient) {
      await handleClientMessage(existingClient, text, phone);
      return res.status(200).json({ action: 'client_reply' });
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (existingLead) {
      if (existingLead.status === 'dropped') {
        await db.from('leads').update({ status: 'new', last_msg_at: new Date().toISOString() }).eq('id', existingLead.id);
      }
      await handleLeadReply(existingLead, text, phone);
      return res.status(200).json({ action: 'lead_qualified' });
    }

    await handleNewLead(phone, text, senderName);
    return res.status(200).json({ action: 'new_lead' });

  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function extractPhone(payload) {
  return payload?.phone || payload?.mobile || payload?.from ||
    payload?.contact?.phone || payload?.sender?.phone ||
    payload?.data?.phone || payload?.data?.from || null;
}

function extractText(payload) {
  return payload?.text || payload?.message || payload?.body ||
    payload?.data?.text || payload?.data?.message ||
    payload?.data?.body || '';
}

function extractName(payload) {
  return payload?.name || payload?.sender?.name ||
    payload?.contact?.name || payload?.data?.name || null;
}

async function handleNewLead(phone, text, name) {
  const db = getSupabase();
  const market = detectMarket(phone);

  await db.from('leads').insert({
    phone,
    name: name || null,
    source: 'whatsapp',
    status: 'new',
    first_msg: text,
    last_msg_at: new Date().toISOString(),
    market
  });

  if (isHinglishMarket(market)) {
    await sendTemplate(phone, 'welcome_v1', [name || 'there']);
  } else {
    await sendTemplate(phone, 'welcome_v1_en', [name || 'there']);
  }

  scheduleNudge(phone, market);
}

async function handleLeadReply(lead, text, phone) {
  const db = getSupabase();
  const program = matchProgram(text);

  if (program) {
    await db.from('leads').update({
      status: 'qualified',
      program_interest: program,
      last_msg_at: new Date().toISOString()
    }).eq('id', lead.id);

    const price = programPrice(program);
    const displayName = programDisplayName(program);
    const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${lead.id}`;
    const intakeUrl = `https://fitnessbymaddy.com/intake.html?lead=${lead.id}`;

    if (isHinglishMarket(lead.market)) {
      await sendTemplate(phone, 'program_offer', [
        displayName,
        `$${price}`,
        checkoutUrl,
        intakeUrl
      ]);
    } else {
      await sendTemplate(phone, 'program_offer_en', [
        displayName,
        `$${price}`,
        checkoutUrl,
        intakeUrl
      ]);
    }
  } else {
    await db.from('leads').update({
      last_msg_at: new Date().toISOString()
    }).eq('id', lead.id);
  }
}

async function handleClientMessage(client, text, phone) {
  if (checkEscalation(text)) return;

  const db = getSupabase();
  const missedCheckins = await getMissedCheckins(client.id);

  if (missedCheckins >= 2) {
    await notifyMaddy(
      `2 missed check-ins: ${maskPhone(phone)}`,
      `Client: ${client.name || maskPhone(phone)}\nProgram: ${client.program}\nMissed: ${missedCheckins} weeks`
    );
  }
}

async function getMissedCheckins(clientId) {
  const db = getSupabase();
  const { data: client } = await db.from('clients').select('program_started_at').eq('id', clientId).single();
  if (!client) return 0;

  const startDate = new Date(client.program_started_at);
  const now = new Date();
  const weeksSinceStart = Math.floor((now - startDate) / (7 * 24 * 60 * 60 * 1000));

  const { count } = await db
    .from('checkins')
    .select('*', { count: 'exact', head: true })
    .eq('client_id', clientId);

  return Math.max(0, weeksSinceStart - (count || 0));
}

async function handleOptOut(phone) {
  const db = getSupabase();
  await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
  await db.from('clients').update({ status: 'paused' }).eq('phone', phone);
}

function scheduleNudge(phone, market) {
  // Nudges handled by cron/nudge-dropped.js checking last_msg_at timestamps
}
