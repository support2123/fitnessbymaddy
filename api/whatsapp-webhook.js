const { getSupabase } = require('./_lib/supabase');
const { sendWithRateLimit, notifyMaddy } = require('./_lib/whatsapp');
const {
  detectMarket, maskPhone, needsEscalation,
  classifyInterest, isOptOut, jsonResponse,
  PROGRAM_NAMES, PROGRAM_PRICES
} = require('./_lib/utils');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return jsonResponse(res, 405, { error: 'Method not allowed' });

  const db = getSupabase();

  try {
    const payload = req.body;
    const phone = payload.phone || payload.senderPhone || payload.from;
    const text = payload.text || payload.message || payload.body || '';
    const senderName = payload.senderName || payload.name || null;

    if (!phone) return jsonResponse(res, 400, { error: 'Missing phone' });

    await db.from('messages').insert({
      phone,
      direction: 'in',
      body: text,
      sent_at: new Date().toISOString(),
      status: 'received'
    });

    if (isOptOut(text)) {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      console.log(`[WA] Opt-out from ${maskPhone(phone)}`);
      return jsonResponse(res, 200, { action: 'opted_out' });
    }

    if (needsEscalation(text)) {
      await db.from('escalations').insert({
        phone,
        reason: 'keyword_trigger',
        message_body: text
      });
      await notifyMaddy('Keyword escalation', `Phone: ${maskPhone(phone)}\nMessage: ${text}`);
      return jsonResponse(res, 200, { action: 'escalated' });
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (!existingLead) {
      const market = detectMarket(phone);
      const { data: newLead } = await db.from('leads').insert({
        phone,
        name: senderName,
        source: 'whatsapp',
        status: 'new',
        first_msg: text,
        last_msg_at: new Date().toISOString(),
        market
      }).select().single();

      const welcomeMsg = market === 'IN'
        ? 'welcome_v1_hindi'
        : 'welcome_v1';

      await sendWithRateLimit(phone, welcomeMsg, [senderName || 'there']);

      return jsonResponse(res, 200, { action: 'new_lead', lead_id: newLead?.id });
    }

    if (existingLead.status === 'dropped') {
      return jsonResponse(res, 200, { action: 'lead_dropped_no_reply' });
    }

    await db.from('leads').update({
      last_msg_at: new Date().toISOString(),
      name: senderName || existingLead.name
    }).eq('id', existingLead.id);

    const { data: existingClient } = await db
      .from('clients')
      .select('id, status')
      .eq('phone', phone)
      .eq('status', 'active')
      .limit(1)
      .single();

    if (existingClient) {
      return jsonResponse(res, 200, { action: 'active_client_reply', client_id: existingClient.id });
    }

    if (existingLead.status === 'new' || existingLead.status === 'qualified') {
      const interest = classifyInterest(text);

      if (interest) {
        await db.from('leads').update({
          status: 'qualified',
          program_interest: interest
        }).eq('id', existingLead.id);

        const programName = PROGRAM_NAMES[interest];
        const price = PROGRAM_PRICES[interest];
        const market = existingLead.market;

        const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${interest}`;
        const intakeUrl = `https://fitnessbymaddy.com/intake?lead=${existingLead.id}`;

        const templateName = market === 'IN' ? 'program_offer_hindi' : 'program_offer';
        await sendWithRateLimit(phone, templateName, [
          senderName || existingLead.name || 'there',
          programName,
          `$${price}`,
          checkoutUrl,
          intakeUrl
        ]);

        return jsonResponse(res, 200, { action: 'qualified', program: interest });
      }
    }

    return jsonResponse(res, 200, { action: 'no_match' });
  } catch (err) {
    console.error('[WA Webhook Error]', err.message);
    return jsonResponse(res, 500, { error: 'Internal error' });
  }
};
