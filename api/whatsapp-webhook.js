const { getSupabase } = require('./_lib/supabase');
const { sendWhatsApp } = require('./_lib/whatsapp');
const { detectMarket, isHinglish, maskPhone } = require('./_lib/market');
const { needsEscalation, createEscalation } = require('./_lib/escalation');
const { qualifyLead } = require('./_lib/qualify');

module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
    return res.status(200).json({ status: 'whatsapp webhook active' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { phone, message, name } = parsePayload(req.body);
    if (!phone || !message) {
      return res.status(400).json({ error: 'Missing phone or message' });
    }

    const supabase = getSupabase();

    await supabase.from('messages').insert({
      phone,
      direction: 'in',
      body: message,
    });

    if (isOptOut(message)) {
      await handleOptOut(supabase, phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(message)) {
      await createEscalation(phone, detectEscalationReason(message), message);
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (existingLead && existingLead.opted_out) {
      return res.status(200).json({ action: 'opted_out_ignored' });
    }

    if (!existingLead) {
      return await handleNewLead(supabase, phone, message, name, res);
    }

    if (existingLead.status === 'new') {
      return await handleQualification(supabase, existingLead, message, res);
    }

    await supabase
      .from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('id', existingLead.id);

    return res.status(200).json({ action: 'message_logged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function parsePayload(body) {
  return {
    phone: body?.phone || body?.waNumber || body?.from,
    message: body?.message || body?.text || body?.body,
    name: body?.name || body?.pushName || body?.userName,
  };
}

function isOptOut(message) {
  const lower = (message || '').toLowerCase().trim();
  return lower === 'stop' || lower === 'unsubscribe' || lower === 'opt out';
}

async function handleOptOut(supabase, phone) {
  await supabase
    .from('leads')
    .update({ status: 'dropped', opted_out: true })
    .eq('phone', phone);
  console.log(`Opt-out: ${maskPhone(phone)}`);
}

async function handleNewLead(supabase, phone, message, name, res) {
  const market = detectMarket(phone);

  const { data: lead } = await supabase.from('leads').insert({
    phone,
    name: name || null,
    source: 'whatsapp',
    status: 'new',
    first_msg: message,
    market,
  }).select().single();

  const hinglish = isHinglish(market);
  const welcomeBody = hinglish
    ? "Hi! Maddy's team here \u{1F44B} Kaun sa goal hai \u2014 fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?"
    : "Hi! Maddy's team here \u{1F44B} What's your goal \u2014 fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial first?";

  await sendWhatsApp({
    phone,
    templateName: 'welcome_v1',
    body: welcomeBody,
    params: { name: name || 'there', templateParams: [name || 'there'] },
  });

  console.log(`New lead: ${maskPhone(phone)} market=${market}`);
  return res.status(200).json({ action: 'new_lead', leadId: lead?.id });
}

async function handleQualification(supabase, lead, message, res) {
  const match = qualifyLead(message);
  if (!match) {
    const hinglish = isHinglish(lead.market);
    const clarifyBody = hinglish
      ? "Thoda aur batao \u2014 kya goal hai? Fat loss, PCOS, 40+ fitness, ya 12-week custom program? Trial bhi try kar sakte ho!"
      : "Tell me more \u2014 are you looking for fat loss, PCOS management, 40+ fitness, or a full 12-week custom program? You can also try our trial!";

    await sendWhatsApp({
      phone: lead.phone,
      body: clarifyBody,
      params: { name: lead.name || 'there' },
    });

    return res.status(200).json({ action: 'clarification_sent' });
  }

  await supabase
    .from('leads')
    .update({
      status: 'qualified',
      program_interest: match.program,
      last_msg_at: new Date().toISOString(),
    })
    .eq('id', lead.id);

  const hinglish = isHinglish(lead.market);
  const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${match.program}`;
  const intakeUrl = `https://fitnessbymaddy.com/intake?lead=${lead.id}`;

  const body = hinglish
    ? `Perfect! ${match.label} program tumhare liye best rahega \u{1F4AA}\n\nPrice: $${match.price}\n\nCheckout: ${checkoutUrl}\n\nAur ye intake form bhi fill karo taaki hum tumhara personalized plan bana sakein:\n${intakeUrl}`
    : `Perfect! The ${match.label} program is a great fit for you \u{1F4AA}\n\nPrice: $${match.price}\n\nCheckout: ${checkoutUrl}\n\nAlso fill out this intake form so we can build your personalized plan:\n${intakeUrl}`;

  await sendWhatsApp({
    phone: lead.phone,
    body,
    params: { name: lead.name || 'there' },
  });

  console.log(`Qualified: ${maskPhone(lead.phone)} → ${match.program}`);
  return res.status(200).json({ action: 'qualified', program: match.program });
}

function detectEscalationReason(message) {
  const lower = message.toLowerCase();
  if (lower.includes('refund')) return 'Refund request';
  if (lower.includes('lawyer') || lower.includes('complaint')) return 'Legal concern';
  if (lower.includes('injury') || lower.includes('pain')) return 'Injury/pain reported';
  if (lower.includes('pregnant') || lower.includes('pregnancy')) return 'Pregnancy';
  if (lower.includes('medication') || lower.includes('surgery')) return 'Medical condition';
  if (lower.includes('dizz') || lower.includes('faint')) return 'Health concern';
  if (lower.includes('eating disorder') || lower.includes('anorex') || lower.includes('bulimi') || lower.includes('purge') || lower.includes('not eating')) return 'Disordered eating signals';
  return 'Flagged message';
}
