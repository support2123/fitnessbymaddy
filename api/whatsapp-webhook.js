import supabase from '../lib/supabase.js';
import { sendTemplate, sendText, canSendMessage, maskPhone } from '../lib/whatsapp.js';
import { detectMarket, isHinglish, classifyIntent, getProgramDetails, getCheckoutUrl, getIntakeUrl, jsonResponse, corsHeaders } from '../lib/helpers.js';
import { needsEscalation, escalateToMaddy, isOptOut } from '../lib/escalation.js';

export default async function handler(req, res) {
  if (corsHeaders(req, res)) return;
  if (req.method !== 'POST') return jsonResponse(res, { error: 'POST only' }, 405);

  try {
    const { phone, message, name } = parseWebhookPayload(req.body);
    if (!phone) return jsonResponse(res, { error: 'Missing phone' }, 400);

    await supabase.from('messages').insert({
      phone: maskPhone(phone),
      direction: 'in',
      body: (message || '').slice(0, 1000),
    });

    if (isOptOut(message)) {
      await supabase.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return jsonResponse(res, { action: 'opted_out' });
    }

    if (needsEscalation(message)) {
      await escalateToMaddy('Keyword trigger in message', { phone, message, name });
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      return await handleNewLead(res, phone, message, name);
    }

    if (existingLead.status === 'dropped') {
      return jsonResponse(res, { action: 'ignored_dropped' });
    }

    await supabase.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('id', existingLead.id);

    if (existingLead.status === 'new') {
      return await handleLeadQualification(res, existingLead, message);
    }

    return jsonResponse(res, { action: 'acknowledged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return jsonResponse(res, { error: 'Internal error' }, 500);
  }
}

async function handleNewLead(res, phone, message, name) {
  const market = detectMarket(phone);

  const { data: lead } = await supabase.from('leads').insert({
    phone,
    name: name || null,
    source: 'whatsapp',
    status: 'new',
    first_msg: (message || '').slice(0, 500),
    market,
  }).select().single();

  const hinglish = isHinglish(market);

  if (hinglish) {
    await sendTemplate(phone, 'welcome_v1', [
      name || 'there',
    ]);
  } else {
    await sendTemplate(phone, 'welcome_v1_en', [
      name || 'there',
    ]);
  }

  const intent = classifyIntent(message);
  if (intent) {
    await supabase.from('leads').update({ program_interest: intent, status: 'qualified' }).eq('id', lead.id);
    const details = getProgramDetails(intent);
    const checkoutUrl = getCheckoutUrl(intent);
    const intakeUrl = getIntakeUrl(lead.id);

    const replyMsg = hinglish
      ? `${details.name} perfect hai tere liye! Price: $${details.price}\n\nCheckout: ${checkoutUrl}\n\nPehle ye form fill kar: ${intakeUrl}`
      : `${details.name} is perfect for you! Price: $${details.price}\n\nCheckout: ${checkoutUrl}\n\nPlease fill this form first: ${intakeUrl}`;

    await sendText(phone, replyMsg);
    return jsonResponse(res, { action: 'qualified', program: intent });
  }

  return jsonResponse(res, { action: 'new_lead', lead_id: lead.id });
}

async function handleLeadQualification(res, lead, message) {
  const intent = classifyIntent(message);
  if (!intent) {
    return jsonResponse(res, { action: 'unclassified' });
  }

  const market = lead.market || detectMarket(lead.phone);
  const hinglish = isHinglish(market);

  await supabase.from('leads').update({
    program_interest: intent,
    status: 'qualified',
  }).eq('id', lead.id);

  const details = getProgramDetails(intent);
  const checkoutUrl = getCheckoutUrl(intent);
  const intakeUrl = getIntakeUrl(lead.id);

  if (await canSendMessage(lead.phone)) {
    const replyMsg = hinglish
      ? `${details.name} — $${details.price}\n\nCheckout karo: ${checkoutUrl}\n\nIntake form: ${intakeUrl}`
      : `${details.name} — $${details.price}\n\nCheckout here: ${checkoutUrl}\n\nIntake form: ${intakeUrl}`;

    await sendText(lead.phone, replyMsg);
  }

  return jsonResponse(res, { action: 'qualified', program: intent });
}

function parseWebhookPayload(body) {
  if (!body) return {};

  if (body.phone) return body;

  if (body.entry) {
    const entry = body.entry[0];
    const change = entry?.changes?.[0]?.value;
    const msg = change?.messages?.[0];
    if (msg) {
      return {
        phone: msg.from,
        message: msg.text?.body || '',
        name: change.contacts?.[0]?.profile?.name || '',
      };
    }
  }

  if (body.destination || body.campaignName) {
    return {
      phone: body.destination || body.phone,
      message: body.message || body.text || '',
      name: body.name || '',
    };
  }

  return {};
}
