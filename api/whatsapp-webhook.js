const { supabase } = require('./lib/supabase');
const { sendTemplate, sendTextMessage, notifyMaddy, canSendMessage, maskPhone } = require('./lib/whatsapp');
const { detectMarket, classifyIntent, programLabel, corsHeaders, json, parseBody } = require('./lib/helpers');

module.exports = async function handler(req, res) {
  corsHeaders(res);
  if (req.method === 'OPTIONS') return json(res, 200, { ok: true });
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });

  try {
    const body = await parseBody(req);
    const phone = body.phone || body.mobile || body.from || body.senderPhone || '';
    const text = body.message || body.text || body.body || '';
    const senderName = body.name || body.senderName || '';

    if (!phone) return json(res, 400, { error: 'Missing phone number' });

    const cleanPhone = phone.replace(/[^0-9]/g, '');

    await supabase.from('messages').insert({
      phone: cleanPhone,
      direction: 'in',
      body: text,
      status: 'received'
    });

    const intent = classifyIntent(text);

    if (intent === 'OPTOUT') {
      await supabase.from('leads').update({ status: 'dropped' }).eq('phone', cleanPhone);
      await supabase.from('clients').update({ status: 'paused' }).eq('phone', cleanPhone);
      return json(res, 200, { action: 'opted_out' });
    }

    if (intent === 'ESCALATE') {
      await notifyMaddy(
        'Lead/Client needs attention',
        `Phone: ${maskPhone(cleanPhone)}\nMessage: "${text}"\nAction: Manual review required`
      );
      return json(res, 200, { action: 'escalated' });
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', cleanPhone)
      .single();

    if (!existingLead) {
      const market = detectMarket(cleanPhone);
      const { data: newLead } = await supabase
        .from('leads')
        .insert({
          phone: cleanPhone,
          name: senderName || null,
          source: 'whatsapp',
          status: 'new',
          first_msg: text,
          last_msg_at: new Date().toISOString(),
          market
        })
        .select()
        .single();

      const canSend = await canSendMessage(cleanPhone, false);
      if (canSend) {
        if (market === 'IN') {
          await sendTemplate(cleanPhone, 'welcome_v1', [senderName || 'there']);
        } else {
          await sendTemplate(cleanPhone, 'welcome_v1_en', [senderName || 'there']);
        }
      }

      return json(res, 200, { action: 'new_lead_created', lead_id: newLead?.id });
    }

    await supabase
      .from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('phone', cleanPhone);

    if (existingLead.status === 'dropped') {
      return json(res, 200, { action: 'lead_dropped_ignored' });
    }

    if (intent && intent !== 'OPTOUT' && intent !== 'ESCALATE') {
      await supabase
        .from('leads')
        .update({ status: 'qualified', program_interest: intent })
        .eq('phone', cleanPhone);

      const canSend = await canSendMessage(cleanPhone, false);
      if (canSend) {
        const label = programLabel(intent);
        const market = existingLead.market || 'GLOBAL';
        const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${existingLead.id}`;
        const intakeUrl = `https://fitnessbymaddy.com/intake?lead=${existingLead.id}`;

        if (market === 'IN') {
          await sendTemplate(cleanPhone, 'program_match', [
            senderName || existingLead.name || 'there',
            label,
            checkoutUrl,
            intakeUrl
          ]);
        } else {
          await sendTemplate(cleanPhone, 'program_match_en', [
            senderName || existingLead.name || 'there',
            label,
            checkoutUrl,
            intakeUrl
          ]);
        }
      }

      return json(res, 200, { action: 'qualified', program: intent });
    }

    return json(res, 200, { action: 'message_logged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return json(res, 500, { error: 'Internal server error' });
  }
};
