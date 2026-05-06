const supabase = require('../lib/supabase');
const { sendTemplate, logIncoming, canSendToLead } = require('../lib/whatsapp');
const { detectMarket, detectProgram, needsEscalation, isOptOut, maskPhone, PROGRAM_NAMES } = require('../lib/helpers');
const { escalateToMaddy } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
    return res.status(200).json({ status: 'whatsapp webhook active' });
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const payload = req.body;
    const phone = payload.senderPhone || payload.from || payload.waId;
    const text = payload.text || payload.message || payload.body || '';
    const senderName = payload.senderName || payload.pushName || null;

    if (!phone) {
      return res.status(400).json({ error: 'Missing phone number' });
    }

    console.log(`[WA-In] ${maskPhone(phone)}: ${text.slice(0, 80)}`);
    await logIncoming(phone, text);

    if (isOptOut(text)) {
      await supabase.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      console.log(`[WA] Opt-out processed for ${maskPhone(phone)}`);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(text)) {
      await escalateToMaddy('Keyword trigger', `${maskPhone(phone)}: "${text.slice(0, 120)}"`);
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    const { data: existingClient } = await supabase
      .from('clients')
      .select('*')
      .eq('phone', phone)
      .eq('status', 'active')
      .single();

    if (existingClient) {
      return res.status(200).json({ action: 'active_client_message_logged' });
    }

    if (!existingLead) {
      const market = detectMarket(phone);
      const { data: newLead } = await supabase
        .from('leads')
        .insert({
          phone,
          name: senderName,
          source: 'whatsapp',
          status: 'new',
          first_msg: text,
          market
        })
        .select()
        .single();

      await sendTemplate(phone, 'welcome_v1', [senderName || 'there']);
      console.log(`[WA] New lead created: ${maskPhone(phone)} market=${market}`);
      return res.status(200).json({ action: 'new_lead', id: newLead?.id });
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'lead_dropped_ignored' });
    }

    await supabase.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('id', existingLead.id);

    if (existingLead.status === 'new') {
      const program = detectProgram(text);
      if (program) {
        await supabase.from('leads').update({
          status: 'qualified',
          program_interest: program
        }).eq('id', existingLead.id);

        const rateOk = await canSendToLead(phone);
        if (rateOk) {
          const programName = PROGRAM_NAMES[program] || program;
          await sendTemplate(phone, 'program_info', [
            senderName || existingLead.name || 'there',
            programName
          ]);
        }

        console.log(`[WA] Lead qualified: ${maskPhone(phone)} → ${program}`);
        return res.status(200).json({ action: 'qualified', program });
      }
    }

    return res.status(200).json({ action: 'message_logged' });
  } catch (err) {
    console.error('[WA-Webhook] Error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
