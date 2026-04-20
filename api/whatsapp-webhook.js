const { getSupabase } = require('../lib/supabase');
const { sendTemplate, sendText, logMessage } = require('../lib/whatsapp');
const { detectMarket, isHinglish, classifyIntent, needsEscalation, maskPhone, jsonResponse, programLabel } = require('../lib/utils');
const { escalateToMaddy } = require('../lib/escalation');

const CHECKOUT_BASE = 'https://fitnessbymaddyy.exlyapp.com/checkout';
const SITE_BASE = 'https://fitnessbymaddy.com';

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return jsonResponse(res, 200, { ok: true });
  if (req.method !== 'POST') return jsonResponse(res, 405, { error: 'POST only' });

  try {
    const body = req.body;
    const phone = body.phone || body.from || body.waId || body.sender;
    const text = body.text || body.message || body.body || '';
    const name = body.name || body.pushName || null;

    if (!phone) return jsonResponse(res, 400, { error: 'Missing phone' });

    const db = getSupabase();

    await logMessage(phone, 'in', text, null);

    const intent = classifyIntent(text);

    if (intent === 'OPTOUT') {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      await db.from('clients').update({ status: 'paused' }).eq('phone', phone);
      console.log(`[OPTOUT] ${maskPhone(phone)}`);
      return jsonResponse(res, 200, { action: 'opted_out' });
    }

    if (needsEscalation(text)) {
      const { data: client } = await db.from('clients').select('id').eq('phone', phone).limit(1).single();
      await escalateToMaddy(phone, 'Flagged keyword detected', text, client?.id);
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .limit(1)
      .single();

    if (!existingLead) {
      const result = await handleNewLead(db, phone, name, text);
      return jsonResponse(res, 200, result);
    }

    if (existingLead.status === 'dropped') {
      return jsonResponse(res, 200, { action: 'ignored_dropped' });
    }

    if (existingLead.status === 'new' || existingLead.status === 'qualified') {
      const result = await handleLeadReply(db, existingLead, text, phone);
      return jsonResponse(res, 200, result);
    }

    return jsonResponse(res, 200, { action: 'message_logged' });
  } catch (err) {
    console.error(`[WEBHOOK ERROR] ${err.message}`);
    return jsonResponse(res, 500, { error: 'Internal error' });
  }
};

async function handleNewLead(db, phone, name, text) {
  const market = detectMarket(phone);

  const { data: lead } = await db.from('leads').insert({
    phone,
    name,
    source: 'whatsapp',
    status: 'new',
    first_msg: text,
    last_msg_at: new Date().toISOString(),
    market
  }).select().single();

  if (isHinglish(market)) {
    await sendTemplate(phone, 'welcome_v1', [name || 'there']);
  } else {
    await sendTemplate(phone, 'welcome_v1_en', [name || 'there']);
  }

  return { action: 'new_lead', leadId: lead.id };
}

async function handleLeadReply(db, lead, text, phone) {
  const intent = classifyIntent(text);
  const market = lead.market;

  await db.from('leads').update({
    last_msg_at: new Date().toISOString(),
    program_interest: intent
  }).eq('id', lead.id);

  if (!intent) {
    const msg = isHinglish(market)
      ? 'Koi baat nahi! Batao kya goal hai — fat loss, strength, PCOS, ya 40+ fitness? Ya $20 trial try karo pehle 💪'
      : 'No worries! What\'s your goal — fat loss, strength, PCOS, or 40+ fitness? Or try our $20 trial first 💪';
    await sendText(phone, msg);
    return { action: 'clarification_sent' };
  }

  await db.from('leads').update({ status: 'qualified' }).eq('id', lead.id);

  const label = programLabel(intent);
  const checkoutUrl = `${CHECKOUT_BASE}/${intent}`;
  const intakeUrl = `${SITE_BASE}/intake?lead=${lead.id}`;

  let msg;
  if (isHinglish(market)) {
    msg = `Perfect! 🔥 Tumhare liye best rahega: *${label}*\n\n` +
      `Checkout karo: ${checkoutUrl}\n\n` +
      `Aur ye form bhar do taaki Maddy tumhara program customize kar sake:\n${intakeUrl}`;
  } else {
    msg = `Perfect! 🔥 The best fit for you: *${label}*\n\n` +
      `Checkout here: ${checkoutUrl}\n\n` +
      `Also fill this form so Maddy can customise your program:\n${intakeUrl}`;
  }

  await sendText(phone, msg);
  return { action: 'qualified', program: intent };
}
