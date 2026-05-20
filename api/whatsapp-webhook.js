const { supabase, detectMarket, maskPhone } = require('./_lib/supabase');
const { sendTemplate, sendTextMessage } = require('./_lib/whatsapp');
const { needsEscalation, escalate } = require('./_lib/escalation');
const { detectProgram, getProgramName } = require('./_lib/qualify');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const payload = req.body;
    const phone = normalizePhone(payload.mobile || payload.from || payload.senderMobile || '');
    const message = payload.message || payload.text || payload.body || '';
    const senderName = payload.name || payload.senderName || '';

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    await supabase.from('messages').insert({
      phone,
      direction: 'in',
      body: message
    });

    const lower = (message || '').toLowerCase().trim();
    if (lower === 'stop' || lower === 'unsubscribe') {
      await supabase
        .from('leads')
        .update({ status: 'dropped' })
        .eq('phone', phone);
      return res.json({ action: 'opted_out' });
    }

    const escalationReason = needsEscalation(message);
    if (escalationReason) {
      await escalate(phone, escalationReason, message);
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .maybeSingle();

    if (existingLead && existingLead.status === 'dropped') {
      return res.json({ action: 'ignored_dropped' });
    }

    const { data: existingClient } = await supabase
      .from('clients')
      .select('id')
      .eq('phone', phone)
      .eq('status', 'active')
      .maybeSingle();

    if (existingClient) {
      return res.json({ action: 'existing_client', client_id: existingClient.id });
    }

    const market = detectMarket(phone);
    const isHinglish = market === 'IN';

    if (!existingLead) {
      const { data: newLead } = await supabase
        .from('leads')
        .insert({
          phone,
          name: senderName,
          source: 'whatsapp',
          status: 'new',
          first_msg: message,
          market
        })
        .select()
        .single();

      if (isHinglish) {
        await sendTemplate(phone, 'welcome_v1', [
          senderName || 'there'
        ]);
      } else {
        await sendTemplate(phone, 'welcome_v1_en', [
          senderName || 'there'
        ]);
      }

      return res.json({ action: 'new_lead', lead_id: newLead.id });
    }

    if (existingLead.status === 'new' || existingLead.status === 'qualified') {
      const program = detectProgram(message);

      if (program) {
        await supabase
          .from('leads')
          .update({
            status: 'qualified',
            program_interest: program,
            last_msg_at: new Date().toISOString()
          })
          .eq('id', existingLead.id);

        const programName = getProgramName(program);
        const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${existingLead.id}`;
        const intakeUrl = `https://fitnessbymaddy.com/intake?lead=${existingLead.id}`;

        if (isHinglish) {
          await sendTemplate(phone, 'program_match', [
            senderName || 'there',
            programName,
            checkoutUrl,
            intakeUrl
          ]);
        } else {
          await sendTemplate(phone, 'program_match_en', [
            senderName || 'there',
            programName,
            checkoutUrl,
            intakeUrl
          ]);
        }

        return res.json({ action: 'qualified', program, lead_id: existingLead.id });
      }

      await supabase
        .from('leads')
        .update({ last_msg_at: new Date().toISOString() })
        .eq('id', existingLead.id);

      return res.json({ action: 'message_received', lead_id: existingLead.id });
    }

    return res.json({ action: 'no_action' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function normalizePhone(raw) {
  let phone = raw.replace(/[^+\d]/g, '');
  if (!phone.startsWith('+')) phone = '+' + phone;
  return phone;
}
