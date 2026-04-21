import supabase from '../lib/supabase.js';
import { sendTemplate } from '../lib/whatsapp.js';
import { detectMarket, isHinglish } from '../lib/market.js';
import { needsEscalation, escalateToMaddy } from '../lib/escalation.js';
import { routeToProgram, getCheckoutUrl, PROGRAM_MAP } from '../lib/programs.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { phone, name, message, type } = parseWebhookPayload(req.body);

    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    await supabase.from('messages').insert({
      phone,
      direction: 'in',
      body: message,
      sent_at: new Date().toISOString(),
      status: 'received',
    });

    const lower = (message || '').toLowerCase().trim();

    if (/^(stop|unsubscribe|opt.?out)$/i.test(lower)) {
      await supabase.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(message)) {
      await escalateToMaddy('Keyword trigger in message', { phone, name, message });
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      return await handleNewLead(phone, name, message, res);
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'ignored_dropped' });
    }

    if (existingLead.status === 'new') {
      return await handleQualification(existingLead, message, res);
    }

    const { data: existingClient } = await supabase
      .from('clients')
      .select('*')
      .eq('phone', phone)
      .eq('status', 'active')
      .single();

    if (existingClient) {
      return res.status(200).json({ action: 'active_client_message_logged' });
    }

    return res.status(200).json({ action: 'message_logged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
}

async function handleNewLead(phone, name, message, res) {
  const market = detectMarket(phone);
  const hinglish = isHinglish(market);

  await supabase.from('leads').insert({
    phone,
    name: name || null,
    source: 'whatsapp',
    status: 'new',
    first_msg: message,
    last_msg_at: new Date().toISOString(),
    market,
  });

  const welcomeParams = hinglish
    ? [name || 'there']
    : [name || 'there'];

  await sendTemplate(phone, 'welcome_v1', welcomeParams);

  return res.status(200).json({ action: 'new_lead_welcomed' });
}

async function handleQualification(lead, message, res) {
  const programKey = routeToProgram(message);

  if (!programKey) {
    await supabase
      .from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('id', lead.id);

    return res.status(200).json({ action: 'unrecognized_reply' });
  }

  const program = PROGRAM_MAP[programKey];
  const checkoutUrl = getCheckoutUrl(programKey);
  const market = lead.market || detectMarket(lead.phone);
  const hinglish = isHinglish(market);

  await supabase
    .from('leads')
    .update({
      status: 'qualified',
      program_interest: programKey,
      last_msg_at: new Date().toISOString(),
    })
    .eq('id', lead.id);

  const templateParams = [
    lead.name || 'there',
    program.name,
    `$${program.price}`,
    checkoutUrl,
  ];

  await sendTemplate(lead.phone, 'program_offer', templateParams);

  const intakeUrl = `https://fitnessbymaddy.com/intake?lead=${lead.id}`;
  await sendTemplate(lead.phone, 'intake_form', [lead.name || 'there', intakeUrl]);

  return res.status(200).json({ action: 'lead_qualified', program: programKey });
}

function parseWebhookPayload(body) {
  if (!body) return {};

  // AiSensy webhook format
  if (body.phone || body.mobile) {
    return {
      phone: body.phone || body.mobile,
      name: body.name || body.userName || body.pushName || null,
      message: body.message || body.text || body.body || '',
      type: body.type || 'text',
    };
  }

  // Meta Cloud API format (fallback)
  const entry = body.entry?.[0];
  const change = entry?.changes?.[0];
  const msg = change?.value?.messages?.[0];
  const contact = change?.value?.contacts?.[0];

  if (msg) {
    return {
      phone: msg.from,
      name: contact?.profile?.name || null,
      message: msg.text?.body || msg.button?.text || '',
      type: msg.type || 'text',
    };
  }

  return {};
}
