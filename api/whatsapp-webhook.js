const { supabase } = require('./lib/supabase');
const { sendTemplate, canSendMessage, detectMarket, maskPhone } = require('./lib/whatsapp');
const { needsEscalation, escalateToMaddy } = require('./lib/escalation');
const { parseBody, corsHeaders, json, classifyLeadIntent, normalizePhone, PROGRAM_NAMES } = require('./lib/helpers');

module.exports = async function handler(req, res) {
  corsHeaders(res);
  if (req.method === 'OPTIONS') return json(res, 200, { ok: true });
  if (req.method !== 'POST') return json(res, 405, { error: 'POST only' });

  try {
    const body = await parseBody(req);
    const rawPhone = body.mobile || body.phone || body.from || '';
    const phone = normalizePhone(rawPhone);
    const text = body.text || body.message || body.body || '';
    const senderName = body.name || body.pushName || '';

    if (!phone) return json(res, 400, { error: 'No phone number' });

    await supabase.from('messages').insert({
      phone,
      direction: 'in',
      body: text,
      status: 'received'
    });

    if (/^(stop|unsubscribe|opt.?out)$/i.test(text.trim())) {
      await supabase.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return json(res, 200, { action: 'opted_out' });
    }

    if (needsEscalation(text)) {
      await escalateToMaddy('Sensitive message from lead', {
        phone,
        name: senderName,
        details: text.slice(0, 200)
      });
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      const market = detectMarket(phone);
      const { data: newLead } = await supabase.from('leads').insert({
        phone,
        name: senderName,
        source: 'whatsapp',
        status: 'new',
        first_msg: text,
        market
      }).select().single();

      const welcomeParams = market === 'IN'
        ? [senderName || 'there']
        : [senderName || 'there'];

      await sendTemplate(phone, 'welcome_v1', welcomeParams);

      return json(res, 200, {
        action: 'new_lead',
        lead_id: newLead?.id,
        market
      });
    }

    if (existingLead.status === 'dropped') {
      return json(res, 200, { action: 'ignored_dropped' });
    }

    await supabase.from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('id', existingLead.id);

    if (existingLead.status === 'new') {
      const intent = classifyLeadIntent(text);

      if (intent) {
        await supabase.from('leads').update({
          status: 'qualified',
          program_interest: intent
        }).eq('id', existingLead.id);

        const programName = PROGRAM_NAMES[intent] || intent;
        const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${existingLead.id}`;
        const intakeUrl = `https://www.fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;

        if (await canSendMessage(phone)) {
          await sendTemplate(phone, 'program_recommendation', [
            senderName || existingLead.name || 'there',
            programName,
            checkoutUrl,
            intakeUrl
          ]);
        }

        return json(res, 200, {
          action: 'qualified',
          program: intent,
          lead_id: existingLead.id
        });
      }
    }

    const { data: existingClient } = await supabase
      .from('clients')
      .select('id, status')
      .eq('phone', phone)
      .eq('status', 'active')
      .single();

    if (existingClient) {
      return json(res, 200, {
        action: 'active_client_message',
        client_id: existingClient.id
      });
    }

    return json(res, 200, { action: 'no_action', lead_id: existingLead.id });

  } catch (err) {
    console.error('Webhook error:', err.message);
    return json(res, 500, { error: 'Internal error' });
  }
};
