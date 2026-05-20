import crypto from 'crypto';
import { getSupabase } from './_lib/supabase.js';
import { sendTemplate, sendSessionMessage, maskPhone } from './_lib/whatsapp.js';
import { needsEscalation, isOptOut, handleEscalation, detectProgram } from './_lib/escalation.js';
import { detectMarket, getWelcome, getNudge, getProgramName } from './_lib/market.js';

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && token === process.env.WA_VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }
    return res.status(403).json({ error: 'Forbidden' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const signature = req.headers['x-hub-signature-256'];
  if (process.env.WA_APP_SECRET && signature) {
    const rawBody = JSON.stringify(req.body);
    const expected = 'sha256=' + crypto
      .createHmac('sha256', process.env.WA_APP_SECRET)
      .update(rawBody)
      .digest('hex');
    if (signature !== expected) {
      return res.status(401).json({ error: 'Invalid signature' });
    }
  }

  try {
    const messages = extractMessages(req.body);

    for (const msg of messages) {
      await processMessage(msg);
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
}

function extractMessages(body) {
  const messages = [];

  if (body?.entry) {
    for (const entry of body.entry) {
      for (const change of entry.changes || []) {
        const value = change.value || {};
        const contacts = value.contacts || [];
        for (const m of value.messages || []) {
          const contact = contacts.find(c => c.wa_id === m.from) || {};
          messages.push({
            phone: m.from,
            name: contact.profile?.name || null,
            body: m.text?.body || m.button?.text || '',
            type: m.type || 'text',
            timestamp: m.timestamp
          });
        }
      }
    }
  } else if (body?.phone && body?.message) {
    messages.push({
      phone: body.phone,
      name: body.name || null,
      body: body.message,
      type: 'text',
      timestamp: body.timestamp
    });
  }

  return messages;
}

async function processMessage({ phone, name, body: text }) {
  const db = getSupabase();

  await db.from('messages').insert({
    phone,
    direction: 'in',
    body: text,
    status: 'received'
  });

  if (isOptOut(text)) {
    await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
    await db.from('clients').update({ status: 'paused' }).eq('phone', phone).eq('status', 'active');
    console.log(`Opt-out: ${maskPhone(phone)}`);
    return;
  }

  const escalationReason = needsEscalation(text);
  if (escalationReason) {
    await handleEscalation(phone, text, escalationReason);
  }

  const { data: existingClient } = await db
    .from('clients')
    .select('id, status, program')
    .eq('phone', phone)
    .eq('status', 'active')
    .maybeSingle();

  if (existingClient) {
    return;
  }

  const { data: existingLead } = await db
    .from('leads')
    .select('*')
    .eq('phone', phone)
    .maybeSingle();

  if (!existingLead) {
    await handleNewLead(phone, name, text);
  } else if (existingLead.status === 'new') {
    await handleLeadReply(existingLead, text);
  } else if (existingLead.status === 'dropped') {
    console.log(`Dropped lead messaged: ${maskPhone(phone)} — ignoring`);
  }
}

async function handleNewLead(phone, name, text) {
  const db = getSupabase();
  const market = detectMarket(phone);

  await db.from('leads').insert({
    phone,
    name,
    source: 'whatsapp',
    status: 'new',
    first_msg: text,
    last_msg_at: new Date().toISOString(),
    market
  });

  const welcome = getWelcome(market);
  await sendTemplate(phone, 'welcome_v1', [name || 'there']);

  console.log(`New lead: ${maskPhone(phone)} (${market})`);
}

async function handleLeadReply(lead, text) {
  const db = getSupabase();

  await db.from('leads')
    .update({ last_msg_at: new Date().toISOString() })
    .eq('id', lead.id);

  const program = detectProgram(text);

  if (program) {
    await db.from('leads')
      .update({ status: 'qualified', program_interest: program })
      .eq('id', lead.id);

    const programName = getProgramName(program);
    const market = lead.market || 'GLOBAL';

    const checkoutMsg = market === 'IN'
      ? `Great choice! ${programName} ke liye yeh raha checkout link:`
      : `Great choice! Here's the checkout link for ${programName}:`;

    await sendSessionMessage(lead.phone, checkoutMsg);

    await sendSessionMessage(
      lead.phone,
      `https://fitnessbymaddyy.exlyapp.com/checkout/${lead.id}`
    );

    await sendSessionMessage(
      lead.phone,
      `Intake form bhi fill karo: https://fitnessbymaddy.com/intake?lead=${lead.id}`
    );

    console.log(`Lead qualified: ${maskPhone(lead.phone)} → ${program}`);
  } else {
    const market = lead.market || 'GLOBAL';
    const clarify = market === 'IN'
      ? "Samajh nahi aaya — kya goal hai? Fat loss, PCOS, strength, 40+ fitness, ya trial?"
      : "I didn't quite catch that — what's your goal? Fat loss, PCOS, strength, 40+ fitness, or a trial?";
    await sendSessionMessage(lead.phone, clarify);
  }
}
