const { supabase } = require('../lib/supabase');
const { sendTemplate, canSendToLead, notifyMaddy } = require('../lib/whatsapp');
const { detectMarket, isHinglishMarket, maskPhone } = require('../lib/market');
const { needsEscalation } = require('../lib/escalation');
const { qualifyLead, isOptOut, getCheckoutUrl, PROGRAM_NAMES } = require('../lib/qualify');

module.exports = async function handler(req, res) {
  // Meta Cloud API webhook verification (GET)
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && token === process.env.WA_VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }
    return res.status(403).json({ error: 'Forbidden' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const entry = req.body?.entry?.[0];
    const changes = entry?.changes?.[0]?.value;
    if (!changes?.messages?.[0]) {
      return res.status(200).json({ ok: true, note: 'No message payload' });
    }

    const msg = changes.messages[0];
    const contact = changes.contacts?.[0];
    const phone = msg.from;
    const text = msg.text?.body || '';
    const name = contact?.profile?.name || '';

    // Log incoming message
    await supabase.from('messages').insert({
      phone, direction: 'in', body: text, status: 'received'
    });

    // Opt-out check — highest priority
    if (isOptOut(text)) {
      await supabase.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      console.log(`Opt-out: ${maskPhone(phone)}`);
      return res.status(200).json({ ok: true, action: 'opted_out' });
    }

    // Escalation check
    const esc = needsEscalation(text);
    if (esc.escalate) {
      await notifyMaddy('Escalation', `${maskPhone(phone)}: ${esc.reasons.join(', ')}`);
    }

    // Check if this is an existing lead
    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    // Check if already a client
    const { data: existingClient } = await supabase
      .from('clients')
      .select('id')
      .eq('phone', phone)
      .eq('status', 'active')
      .single();

    if (existingClient) {
      // Active client — don't run lead flows, just log
      return res.status(200).json({ ok: true, action: 'active_client_message' });
    }

    const market = detectMarket(phone);
    const hinglish = isHinglishMarket(market);

    // FLOW A — New lead
    if (!existingLead) {
      const { data: newLead } = await supabase.from('leads').insert({
        phone, name, source: 'whatsapp', status: 'new',
        first_msg: text, last_msg_at: new Date().toISOString(), market
      }).select().single();

      // Send welcome template
      if (hinglish) {
        await sendTemplate(phone, 'welcome_v1', [name || 'there']);
      } else {
        await sendTemplate(phone, 'welcome_v1_en', [name || 'there']);
      }

      return res.status(200).json({ ok: true, action: 'new_lead', id: newLead?.id });
    }

    // Update last message timestamp
    await supabase.from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('phone', phone);

    // If lead is dropped, don't re-engage via webhook
    if (existingLead.status === 'dropped') {
      return res.status(200).json({ ok: true, action: 'lead_dropped_ignored' });
    }

    // FLOW B — Lead qualification
    const program = qualifyLead(text);
    if (program) {
      await supabase.from('leads')
        .update({ status: 'qualified', program_interest: program })
        .eq('phone', phone);

      const canSend = await canSendToLead(phone);
      if (!canSend) {
        return res.status(200).json({ ok: true, action: 'rate_limited' });
      }

      const checkoutUrl = getCheckoutUrl(program);
      const programName = PROGRAM_NAMES[program];
      const intakeUrl = `https://www.fitnessbymaddy.com/intake?lead=${existingLead.id}`;

      if (hinglish) {
        await sendTemplate(phone, 'program_match', [
          name || 'there', programName, checkoutUrl, intakeUrl
        ]);
      } else {
        await sendTemplate(phone, 'program_match_en', [
          name || 'there', programName, checkoutUrl, intakeUrl
        ]);
      }

      return res.status(200).json({ ok: true, action: 'qualified', program });
    }

    return res.status(200).json({ ok: true, action: 'message_logged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(200).json({ ok: true, note: 'Error handled gracefully' });
  }
};
