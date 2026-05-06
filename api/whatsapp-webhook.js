const { getSupabase } = require('./_lib/supabase');
const { sendTemplate, sendText, logMessage, notifyMaddy, canSendToLead } = require('./_lib/whatsapp');
const { detectMarket, classifyIntent, programLabel, programPrice, maskPhone, jsonResponse, errorResponse } = require('./_lib/helpers');

const SITE = 'https://www.fitnessbymaddy.com';

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return jsonResponse(res, { ok: true });
  if (req.method !== 'POST') return errorResponse(res, 'POST only', 405);

  const db = getSupabase();
  const body = req.body || {};

  // AiSensy webhook payload fields
  const phone = body.mobile || body.phone || body.from || '';
  const text = body.text || body.message || body.body || '';
  const senderName = body.name || body.pushName || '';

  if (!phone) return errorResponse(res, 'No phone number');

  const normalizedPhone = phone.replace(/[^0-9+]/g, '').replace(/^(\d)/, '+$1');

  console.log(`[WA-IN] ${maskPhone(normalizedPhone)}: ${text.slice(0, 80)}`);

  // Log inbound message
  await logMessage(normalizedPhone, 'in', text, null);

  // Check opt-out
  const intent = classifyIntent(text);
  if (intent === 'OPT_OUT') {
    await db.from('leads').update({ status: 'dropped', opted_out: true })
      .eq('phone', normalizedPhone);
    return jsonResponse(res, { action: 'opted_out' });
  }

  // Check escalation triggers
  if (intent === 'ESCALATION') {
    await notifyMaddy(
      'Escalation trigger detected',
      `Phone: ${maskPhone(normalizedPhone)}\nMessage: ${text.slice(0, 500)}`
    );
    await db.from('escalations').insert({
      phone: normalizedPhone,
      reason: 'keyword_trigger',
      message_body: text.slice(0, 2000)
    });
    return jsonResponse(res, { action: 'escalated' });
  }

  // Check if existing client
  const { data: existingClient } = await db
    .from('clients')
    .select('id, name, status, program')
    .eq('phone', normalizedPhone)
    .eq('status', 'active')
    .limit(1)
    .single();

  if (existingClient) {
    // Active client messaging — log and let through, no auto-reply
    return jsonResponse(res, { action: 'client_message_logged', client_id: existingClient.id });
  }

  // Check if existing lead
  const { data: existingLead } = await db
    .from('leads')
    .select('*')
    .eq('phone', normalizedPhone)
    .limit(1)
    .single();

  if (existingLead) {
    if (existingLead.opted_out) {
      return jsonResponse(res, { action: 'opted_out_ignored' });
    }

    // Update last message
    await db.from('leads').update({
      last_msg_at: new Date().toISOString(),
      first_msg: existingLead.first_msg || text
    }).eq('id', existingLead.id);

    // Classify and route
    if (intent && !['OPT_OUT', 'ESCALATION'].includes(intent)) {
      await db.from('leads').update({
        status: 'qualified',
        program_interest: intent
      }).eq('id', existingLead.id);

      const rateOk = await canSendToLead(normalizedPhone);
      if (rateOk) {
        const market = existingLead.market || detectMarket(normalizedPhone);
        const isHinglish = market === 'IN';
        const label = programLabel(intent);
        const price = programPrice(intent);

        const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${existingLead.id}`;
        const intakeUrl = `${SITE}/intake?lead=${existingLead.id}`;

        const msg = isHinglish
          ? `Great choice! 💪 ${label} ($${price}) — yeh program tere liye perfect hai.\n\nCheckout: ${checkoutUrl}\n\nPehle yeh form bhar de: ${intakeUrl}`
          : `Great choice! 💪 ${label} ($${price}) — this program is perfect for your goals.\n\nCheckout: ${checkoutUrl}\n\nPlease fill this form first: ${intakeUrl}`;

        await sendText(normalizedPhone, msg);
      }

      return jsonResponse(res, { action: 'qualified', program: intent });
    }

    return jsonResponse(res, { action: 'lead_updated' });
  }

  // New lead
  const market = detectMarket(normalizedPhone);
  const { data: newLead } = await db.from('leads').insert({
    phone: normalizedPhone,
    name: senderName || null,
    source: 'whatsapp',
    status: 'new',
    first_msg: text,
    last_msg_at: new Date().toISOString(),
    market
  }).select().single();

  // Send welcome template
  const isHinglish = market === 'IN';
  const welcome = isHinglish
    ? "Hi! Maddy's team here 👋 Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?"
    : "Hi! Maddy's team here 👋 What's your goal — fat loss, PCOS management, strength training, or 40+ fitness? Or would you like to try a trial session first?";

  await sendText(normalizedPhone, welcome);

  // If first message already has intent, qualify immediately
  if (intent && !['OPT_OUT', 'ESCALATION'].includes(intent)) {
    await db.from('leads').update({
      status: 'qualified',
      program_interest: intent
    }).eq('id', newLead.id);

    const label = programLabel(intent);
    const price = programPrice(intent);
    const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${newLead.id}`;
    const intakeUrl = `${SITE}/intake?lead=${newLead.id}`;

    const routeMsg = isHinglish
      ? `Based on your message, ${label} ($${price}) suit karega! 🔥\n\nCheckout: ${checkoutUrl}\nForm: ${intakeUrl}`
      : `Based on your message, ${label} ($${price}) would be perfect! 🔥\n\nCheckout: ${checkoutUrl}\nForm: ${intakeUrl}`;

    await sendText(normalizedPhone, routeMsg);
  }

  return jsonResponse(res, { action: 'new_lead', lead_id: newLead?.id });
};
