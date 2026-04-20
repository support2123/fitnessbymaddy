import supabase from './_lib/supabase.js';
import { sendWhatsApp } from './_lib/whatsapp.js';
import { detectMarket, isHinglish } from './_lib/market.js';
import { needsEscalation, escalateToMaddy, getEscalationReason } from './_lib/escalation.js';
import { matchProgram, getProgramInfo, isOptOut } from './_lib/keywords.js';
import { maskPhone } from './_lib/mask.js';

const BASE_URL = 'https://fitnessbymaddy.com';
const EXLY_BASE = 'https://fitnessbymaddyy.exlyapp.com/checkout';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = req.body;
    const phone = normalizePhone(body.phone || body.mobile || body.from);
    const message = body.message || body.text || body.body || '';
    const name = body.name || body.pushName || '';

    if (!phone) return res.status(400).json({ error: 'Missing phone number' });

    await supabase.from('messages').insert({
      phone,
      direction: 'in',
      body: message.substring(0, 1000),
      template_name: null,
      sent_at: new Date().toISOString(),
      status: 'received',
    });

    if (isOptOut(message)) {
      await handleOptOut(phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(message)) {
      const reasons = getEscalationReason(message);
      await escalateToMaddy(reasons.join(', '), phone, message);
    }

    const { data: existingClient } = await supabase
      .from('clients')
      .select('id, status')
      .eq('phone', phone)
      .eq('status', 'active')
      .maybeSingle();

    if (existingClient) {
      return res.status(200).json({ action: 'active_client', client_id: existingClient.id });
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('id, status')
      .eq('phone', phone)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingLead && existingLead.status !== 'dropped') {
      await handleReturningLead(existingLead, phone, message);
      return res.status(200).json({ action: 'returning_lead', lead_id: existingLead.id });
    }

    const lead = await createNewLead(phone, name, message);
    await sendWelcomeMessage(phone);
    await scheduleNudges(lead.id, phone);

    return res.status(200).json({ action: 'new_lead', lead_id: lead.id });
  } catch (err) {
    console.error(`Webhook error for ${maskPhone(req.body?.phone)}: ${err.message}`);
    return res.status(500).json({ error: 'Internal error' });
  }
}

function normalizePhone(phone) {
  if (!phone) return null;
  let cleaned = phone.replace(/[^0-9+]/g, '');
  if (!cleaned.startsWith('+')) cleaned = '+' + cleaned;
  return cleaned;
}

async function createNewLead(phone, name, message) {
  const market = detectMarket(phone);
  const programInterest = matchProgram(message);

  const { data, error } = await supabase
    .from('leads')
    .insert({
      phone,
      name: name || null,
      source: 'whatsapp',
      status: 'new',
      first_msg: message.substring(0, 500),
      last_msg_at: new Date().toISOString(),
      program_interest: programInterest,
      market,
      created_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

async function sendWelcomeMessage(phone) {
  const hinglish = isHinglish(phone);
  const template = hinglish ? 'welcome_v1_hi' : 'welcome_v1_en';
  const params = hinglish
    ? ['Hi! Maddy\'s team here 👋 Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?']
    : ['Hi! Maddy\'s team here 👋 What\'s your goal — fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?'];

  await sendWhatsApp(phone, template, params);
}

async function handleReturningLead(lead, phone, message) {
  const programKey = matchProgram(message);

  await supabase
    .from('leads')
    .update({
      last_msg_at: new Date().toISOString(),
      status: 'qualified',
      program_interest: programKey || lead.program_interest,
    })
    .eq('id', lead.id);

  if (programKey) {
    const info = getProgramInfo(programKey);
    if (info) {
      const hinglish = isHinglish(phone);
      const checkoutUrl = `${EXLY_BASE}/${info.checkout}`;
      const intakeUrl = `${BASE_URL}/intake?lead=${lead.id}`;

      const params = hinglish
        ? [
            `${info.name} — perfect choice! 💪`,
            `Price: $${info.price}`,
            `Checkout: ${checkoutUrl}`,
            `Intake form bhi fill kardo: ${intakeUrl}`,
          ]
        : [
            `${info.name} — great choice! 💪`,
            `Price: $${info.price}`,
            `Checkout: ${checkoutUrl}`,
            `Please also fill the intake form: ${intakeUrl}`,
          ];

      await sendWhatsApp(phone, 'program_recommendation', params, false);
    }
  }
}

async function handleOptOut(phone) {
  await supabase
    .from('leads')
    .update({ status: 'dropped' })
    .eq('phone', phone);

  await supabase
    .from('clients')
    .update({ status: 'paused' })
    .eq('phone', phone)
    .eq('status', 'active');
}

async function scheduleNudges(leadId, phone) {
  // Nudges are handled by the cron/nudge-dropped endpoint
  // which checks leads with status=new and no reply within 2hrs/24hrs
}
