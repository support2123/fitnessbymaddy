const { supabase } = require('../lib/supabase');
const { sendTemplate, logMessage } = require('../lib/whatsapp');
const { detectMarket, isHinglish, matchProgram, programDisplayName, handleCors, maskPhone } = require('../lib/helpers');
const { needsEscalation, createEscalation } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const payload = req.body;
    const phone = payload.phone || payload.from || payload.sender?.phone;
    const message = payload.message || payload.text || payload.body || '';
    const name = payload.name || payload.sender?.name || null;

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    const cleanPhone = phone.replace(/[^0-9]/g, '');

    await logMessage(cleanPhone, 'in', message, null);

    const lower = message.toLowerCase().trim();
    if (lower === 'stop' || lower === 'unsubscribe') {
      await supabase
        .from('leads')
        .update({ status: 'dropped', last_msg_at: new Date().toISOString() })
        .eq('phone', cleanPhone);
      console.log(`[Webhook] Opt-out: ${maskPhone(cleanPhone)}`);
      return res.status(200).json({ action: 'opted_out' });
    }

    const escalationTrigger = needsEscalation(message);
    if (escalationTrigger) {
      const { data: client } = await supabase
        .from('clients')
        .select('id')
        .eq('phone', cleanPhone)
        .single();

      await createEscalation(cleanPhone, escalationTrigger, message, client?.id);
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', cleanPhone)
      .single();

    if (existingLead) {
      await supabase
        .from('leads')
        .update({ last_msg_at: new Date().toISOString() })
        .eq('id', existingLead.id);

      if (existingLead.status === 'dropped') {
        return res.status(200).json({ action: 'ignored_dropped' });
      }

      if (existingLead.status === 'new' || existingLead.status === 'qualified') {
        const program = matchProgram(message);
        if (program) {
          await supabase
            .from('leads')
            .update({
              status: 'qualified',
              program_interest: program
            })
            .eq('id', existingLead.id);

          const market = existingLead.market;
          const hinglish = isHinglish(market);

          const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${existingLead.id}`;
          const intakeUrl = `https://fitnessbymaddy.com/intake?lead=${existingLead.id}`;

          const msgParams = hinglish
            ? [programDisplayName(program), checkoutUrl, intakeUrl]
            : [programDisplayName(program), checkoutUrl, intakeUrl];

          await sendTemplate(cleanPhone, 'program_recommendation', msgParams);

          return res.status(200).json({ action: 'qualified', program });
        }
      }

      return res.status(200).json({ action: 'existing_lead', status: existingLead.status });
    }

    const market = detectMarket(cleanPhone);
    const hinglish = isHinglish(market);

    const { data: lead, error } = await supabase
      .from('leads')
      .insert({
        phone: cleanPhone,
        name,
        source: 'whatsapp',
        status: 'new',
        first_msg: message?.substring(0, 500),
        last_msg_at: new Date().toISOString(),
        market
      })
      .select()
      .single();

    if (error) {
      console.error(`[Webhook] Lead insert error for ${maskPhone(cleanPhone)}:`, error.message);
      return res.status(500).json({ error: 'Failed to save lead' });
    }

    const program = matchProgram(message);
    if (program) {
      await supabase
        .from('leads')
        .update({ status: 'qualified', program_interest: program })
        .eq('id', lead.id);

      const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${lead.id}`;
      const intakeUrl = `https://fitnessbymaddy.com/intake?lead=${lead.id}`;

      await sendTemplate(cleanPhone, 'program_recommendation', [
        programDisplayName(program),
        checkoutUrl,
        intakeUrl
      ]);

      return res.status(200).json({ action: 'new_lead_qualified', program });
    }

    await sendTemplate(cleanPhone, 'welcome_v1', [name || 'there']);

    return res.status(200).json({ action: 'new_lead_welcomed', leadId: lead.id });
  } catch (err) {
    console.error('[Webhook] Error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
