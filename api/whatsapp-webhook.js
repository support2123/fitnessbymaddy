const { supabase } = require('../lib/supabase');
const { sendTemplate, canSendMessage } = require('../lib/whatsapp');
const { classifyIntent, programForIntent, detectMarket, isHinglish, maskPhone, sendJson, parseBody } = require('../lib/utils');
const { escalate } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return sendJson(res, 200, { ok: true });
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });

  try {
    const body = await parseBody(req);
    const phone = body.mobile || body.phone || body.from || body.senderMobile;
    const message = body.message || body.text || body.body || '';
    const name = body.name || body.pushName || body.senderName || null;

    if (!phone) return sendJson(res, 400, { error: 'No phone number' });

    console.log(`[WA-IN] ${maskPhone(phone)}: ${message.slice(0, 100)}`);

    await supabase.from('messages').insert({
      phone,
      direction: 'in',
      body: message,
    });

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .order('created_at', { ascending: false })
      .limit(1);

    const lead = existingLead?.[0];

    const { data: existingClient } = await supabase
      .from('clients')
      .select('id, status')
      .eq('phone', phone)
      .eq('status', 'active')
      .limit(1);

    const isClient = existingClient && existingClient.length > 0;
    const intent = classifyIntent(message);

    if (intent === 'OPT_OUT') {
      if (lead) {
        await supabase.from('leads').update({ status: 'dropped', opted_out: true }).eq('id', lead.id);
      }
      return sendJson(res, 200, { action: 'opted_out' });
    }

    if (intent === 'ESCALATE') {
      await escalate(phone, 'Keyword trigger in message', message);
      return sendJson(res, 200, { action: 'escalated' });
    }

    if (!lead) {
      const market = detectMarket(phone);
      const { data: newLead } = await supabase
        .from('leads')
        .insert({
          phone,
          name,
          source: 'whatsapp',
          status: 'new',
          first_msg: message,
          market,
        })
        .select()
        .single();

      const hinglish = isHinglish(market);
      await sendTemplate(phone, 'welcome_v1', [
        name || (hinglish ? 'there' : 'there'),
      ]);

      if (intent) {
        return await handleQualification(res, newLead, intent, hinglish);
      }

      return sendJson(res, 200, { action: 'new_lead_welcomed', lead_id: newLead.id });
    }

    if (lead.opted_out) {
      return sendJson(res, 200, { action: 'opted_out_skip' });
    }

    await supabase.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('id', lead.id);

    if (intent && lead.status !== 'converted') {
      const hinglish = isHinglish(lead.market);
      return await handleQualification(res, lead, intent, hinglish);
    }

    if (isClient) {
      return sendJson(res, 200, { action: 'client_message_logged' });
    }

    return sendJson(res, 200, { action: 'message_logged' });
  } catch (err) {
    console.error('[WA-WEBHOOK] Error:', err.message);
    return sendJson(res, 500, { error: 'Internal error' });
  }
};

async function handleQualification(res, lead, intent, hinglish) {
  const programInfo = programForIntent(intent);
  if (!programInfo) return sendJson(res, 200, { action: 'no_matching_program' });

  await supabase.from('leads').update({
    status: 'qualified',
    program_interest: programInfo.program,
  }).eq('id', lead.id);

  const allowed = await canSendMessage(lead.phone, false);
  if (!allowed) return sendJson(res, 200, { action: 'rate_limited' });

  const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${programInfo.program}`;
  const intakeUrl = `https://fitnessbymaddy.com/intake?lead=${lead.id}`;

  if (hinglish) {
    await sendTemplate(lead.phone, 'program_offer_hi', [
      lead.name || 'there',
      programInfo.name,
      `$${programInfo.price}`,
      checkoutUrl,
      intakeUrl,
    ]);
  } else {
    await sendTemplate(lead.phone, 'program_offer_en', [
      lead.name || 'there',
      programInfo.name,
      `$${programInfo.price}`,
      checkoutUrl,
      intakeUrl,
    ]);
  }

  return sendJson(res, 200, {
    action: 'qualified',
    program: programInfo.program,
    lead_id: lead.id,
  });
}
