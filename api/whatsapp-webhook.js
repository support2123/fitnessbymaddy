import supabase from '../lib/supabase.js';
import { sendTemplate, logIncoming } from '../lib/whatsapp.js';
import { detectMarket, isHinglish } from '../lib/market.js';
import { needsEscalation, isOptOut, escalateToMaddy } from '../lib/escalation.js';
import { matchProgram, getProgramName, getCheckoutUrl, getIntakeUrl } from '../lib/qualify.js';

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const challenge = req.query['hub.challenge'];
    if (challenge) return res.status(200).send(challenge);
    return res.status(200).json({ status: 'ok' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const payload = req.body;
    const phone = extractPhone(payload);
    const text = extractText(payload);

    if (!phone) return res.status(200).json({ status: 'no_phone' });

    await logIncoming(phone, text || '');

    if (isOptOut(text)) {
      await handleOptOut(phone);
      return res.status(200).json({ status: 'opted_out' });
    }

    if (needsEscalation(text)) {
      await escalateToMaddy(phone, 'Keyword trigger in message', text || '');
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      await handleNewLead(phone, text);
    } else if (existingLead.status === 'new') {
      await handleQualification(existingLead, text);
    } else if (existingLead.status === 'dropped') {
      // Don't message dropped leads
    } else {
      await supabase
        .from('leads')
        .update({ last_msg_at: new Date().toISOString() })
        .eq('id', existingLead.id);
    }

    return res.status(200).json({ status: 'processed' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(200).json({ status: 'error' });
  }
}

async function handleNewLead(phone, text) {
  const market = detectMarket(phone);

  const { data: lead } = await supabase
    .from('leads')
    .insert({
      phone,
      status: 'new',
      first_msg: text,
      last_msg_at: new Date().toISOString(),
      market,
      source: 'whatsapp'
    })
    .select()
    .single();

  if (!lead) return;

  if (isHinglish(market)) {
    await sendTemplate(phone, 'welcome_v1', []);
  } else {
    await sendTemplate(phone, 'welcome_v1_en', []);
  }

  const program = matchProgram(text);
  if (program) {
    await handleQualification(lead, text);
  }
}

async function handleQualification(lead, text) {
  const program = matchProgram(text);
  if (!program) return;

  await supabase
    .from('leads')
    .update({
      status: 'qualified',
      program_interest: program,
      last_msg_at: new Date().toISOString()
    })
    .eq('id', lead.id);

  const market = lead.market || detectMarket(lead.phone);
  const programName = getProgramName(program);
  const checkoutUrl = getCheckoutUrl(lead.id);
  const intakeUrl = getIntakeUrl(lead.id);

  if (isHinglish(market)) {
    await sendTemplate(lead.phone, 'program_offer', [
      programName,
      checkoutUrl,
      intakeUrl
    ]);
  } else {
    await sendTemplate(lead.phone, 'program_offer_en', [
      programName,
      checkoutUrl,
      intakeUrl
    ]);
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

function extractPhone(payload) {
  if (payload?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.from) {
    return payload.entry[0].changes[0].value.messages[0].from;
  }
  if (payload?.phone || payload?.mobile) {
    return payload.phone || payload.mobile;
  }
  if (payload?.sender?.phone) {
    return payload.sender.phone;
  }
  return null;
}

function extractText(payload) {
  if (payload?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.text?.body) {
    return payload.entry[0].changes[0].value.messages[0].text.body;
  }
  if (payload?.text || payload?.message) {
    return payload.text || payload.message;
  }
  if (payload?.sender?.message) {
    return payload.sender.message;
  }
  return '';
}
