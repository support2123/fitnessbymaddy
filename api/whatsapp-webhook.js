const { supabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { detectMarket, detectProgramInterest, needsEscalation, isOptOut, isHinglish, maskPhone, PROGRAM_LABELS } = require('../lib/helpers');
const { createEscalation } = require('../lib/escalation');

const VERIFY_TOKEN = process.env.WEBHOOK_VERIFY_TOKEN || 'fitnessbymaddy_verify';

const WELCOME_MSG_IN = "Hi! Maddy's team here 👋 Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?";
const WELCOME_MSG_EN = "Hi! Maddy's team here 👋 What's your goal — fat loss, PCOS management, strength, or 40+ fitness? Or try a trial session first?";

function corsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://fitnessbymaddy.com');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
}

module.exports = async function handler(req, res) {
  corsHeaders(res);

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  // GET — webhook verification (AiSensy / WhatsApp Cloud API challenge)
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      console.log('[Webhook] Verification successful');
      return res.status(200).send(challenge);
    }
    return res.status(403).json({ error: 'Verification failed' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // POST — incoming message
  try {
    const { phone, name, message, timestamp } = req.body || {};

    if (!phone || !message) {
      return res.status(400).json({ error: 'Missing phone or message' });
    }

    const cleanPhone = phone.replace(/\D/g, '');
    const market = detectMarket(cleanPhone);
    const now = new Date().toISOString();

    console.log(`[Webhook] Incoming from ${maskPhone(cleanPhone)}: "${message.slice(0, 80)}"`);

    // Log the inbound message
    await supabase.from('messages').insert({
      phone: cleanPhone,
      direction: 'in',
      body: message,
      status: 'received',
    });

    // ── Opt-out check ──────────────────────────────────────────────
    if (isOptOut(message)) {
      await supabase
        .from('leads')
        .update({ status: 'dropped', last_msg_at: now })
        .eq('phone', cleanPhone);

      console.log(`[Webhook] Opt-out processed for ${maskPhone(cleanPhone)}`);
      return res.status(200).json({ action: 'opt_out' });
    }

    // ── Check if this is an existing client ────────────────────────
    const { data: existingClient } = await supabase
      .from('clients')
      .select('id, phone, program, status')
      .eq('phone', cleanPhone)
      .eq('status', 'active')
      .maybeSingle();

    if (existingClient) {
      return await handleExistingClient(existingClient, cleanPhone, message, now, res);
    }

    // ── Lead flow ──────────────────────────────────────────────────
    // Check if lead already exists
    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', cleanPhone)
      .maybeSingle();

    if (existingLead) {
      return await handleExistingLead(existingLead, cleanPhone, message, market, now, res);
    }

    // ── New lead ───────────────────────────────────────────────────
    return await handleNewLead(cleanPhone, name, message, market, now, res);

  } catch (err) {
    console.error('[Webhook] Unhandled error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

// ────────────────────────────────────────────────────────────────────
// New lead: insert + welcome message
// ────────────────────────────────────────────────────────────────────
async function handleNewLead(phone, name, message, market, now, res) {
  const programInterest = detectProgramInterest(message);

  const { data: lead, error } = await supabase.from('leads').insert({
    phone,
    name: name || null,
    source: 'whatsapp',
    status: 'new',
    first_msg: message,
    last_msg_at: now,
    program_interest: programInterest,
    market,
  }).select().single();

  if (error) {
    console.error('[Webhook] Lead insert failed:', error.message);
    return res.status(500).json({ error: 'Failed to create lead' });
  }

  console.log(`[Webhook] New lead created: ${lead.id} (${maskPhone(phone)})`);

  // Escalation check even for new leads
  if (needsEscalation(message)) {
    await createEscalation({
      phone,
      clientId: null,
      reason: 'medical/refund keyword in first message',
      messageBody: message,
    });
  }

  // If program interest detected right away, fast-track to qualification
  if (programInterest) {
    await supabase.from('leads').update({
      status: 'qualified',
      program_interest: programInterest,
    }).eq('id', lead.id);

    const label = PROGRAM_LABELS[programInterest] || programInterest;
    const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${lead.id}`;
    const intakeUrl = `https://fitnessbymaddy.com/intake?lead=${lead.id}`;

    await sendWhatsApp({
      phone,
      templateName: 'program_interest',
      params: [name || 'there', label, checkoutUrl, intakeUrl],
    });

    return res.status(200).json({ action: 'new_lead_qualified', lead_id: lead.id, program: programInterest });
  }

  // Send welcome message
  const welcomeMsg = isHinglish(market) ? WELCOME_MSG_IN : WELCOME_MSG_EN;
  await sendWhatsApp({
    phone,
    templateName: 'welcome_lead',
    params: [name || 'there'],
    body: welcomeMsg,
  });

  // Schedule a nudge flag — the cron job will send it after 2 hours if no reply
  await supabase.from('leads').update({ nudge_pending: true }).eq('id', lead.id);

  return res.status(200).json({ action: 'new_lead', lead_id: lead.id });
}

// ────────────────────────────────────────────────────────────────────
// Existing lead: qualification, escalation, nudge reset
// ────────────────────────────────────────────────────────────────────
async function handleExistingLead(lead, phone, message, market, now, res) {
  // Reset nudge flag since they replied
  await supabase.from('leads').update({
    last_msg_at: now,
    nudge_pending: false,
  }).eq('id', lead.id);

  // Escalation check
  if (needsEscalation(message)) {
    await createEscalation({
      phone,
      clientId: null,
      reason: 'medical/refund keyword from lead',
      messageBody: message,
    });
    return res.status(200).json({ action: 'escalation_created', lead_id: lead.id });
  }

  // Detect program interest if not yet qualified
  const programInterest = detectProgramInterest(message);

  if (programInterest && lead.status !== 'qualified' && lead.status !== 'converted') {
    await supabase.from('leads').update({
      status: 'qualified',
      program_interest: programInterest,
    }).eq('id', lead.id);

    const label = PROGRAM_LABELS[programInterest] || programInterest;
    const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${lead.id}`;
    const intakeUrl = `https://fitnessbymaddy.com/intake?lead=${lead.id}`;

    await sendWhatsApp({
      phone,
      templateName: 'program_interest',
      params: [lead.name || 'there', label, checkoutUrl, intakeUrl],
    });

    return res.status(200).json({ action: 'lead_qualified', lead_id: lead.id, program: programInterest });
  }

  // Schedule nudge at 2hrs if no further reply
  await supabase.from('leads').update({ nudge_pending: true }).eq('id', lead.id);

  return res.status(200).json({ action: 'lead_message_logged', lead_id: lead.id });
}

// ────────────────────────────────────────────────────────────────────
// Existing client: log message, check for escalation / check-in reply
// ────────────────────────────────────────────────────────────────────
async function handleExistingClient(client, phone, message, now, res) {
  // Escalation check
  if (needsEscalation(message)) {
    await createEscalation({
      phone,
      clientId: client.id,
      reason: 'medical/refund keyword from active client',
      messageBody: message,
    });
    return res.status(200).json({ action: 'client_escalation', client_id: client.id });
  }

  // Update last contact timestamp on the corresponding lead
  await supabase
    .from('leads')
    .update({ last_msg_at: now })
    .eq('phone', phone);

  return res.status(200).json({ action: 'client_message_logged', client_id: client.id });
}
