const { supabase } = require('../lib/supabase');
const { sendTemplate, canSendMessage, maskPhone } = require('../lib/whatsapp');
const { detectMarket, detectProgram, needsEscalation, isOptOut, useHinglish } = require('../lib/helpers');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = req.body;
    const phone = body.mobile || body.from || body.senderMobile;
    const text = body.text || body.message || body.messageText || '';
    const name = body.name || body.senderName || null;

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    await supabase.from('messages').insert({
      phone, direction: 'in', body: text
    });

    if (isOptOut(text)) {
      await supabase.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      console.log(`Opt-out: ${maskPhone(phone)}`);
      return res.status(200).json({ action: 'opted_out' });
    }

    const escalationTrigger = needsEscalation(text);
    if (escalationTrigger) {
      await supabase.from('escalations').insert({
        phone, reason: escalationTrigger, message_body: text
      });
      await sendTemplate(process.env.MADDY_PHONE, 'escalation_alert', [
        maskPhone(phone), escalationTrigger
      ]);
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      const market = detectMarket(phone);
      const { data: newLead } = await supabase.from('leads').insert({
        phone, name, source: 'whatsapp', status: 'new',
        first_msg: text, market
      }).select().single();

      const templateName = useHinglish(market) ? 'welcome_v1_hi' : 'welcome_v1';
      await sendTemplate(phone, templateName);

      setTimeout(async () => {
        const { data: check } = await supabase
          .from('messages')
          .select('id')
          .eq('phone', phone)
          .eq('direction', 'in')
          .gt('sent_at', new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString())
          .limit(2);

        if (!check || check.length <= 1) {
          const ok = await canSendMessage(phone);
          if (ok) await sendTemplate(phone, 'nudge_trial');
        }
      }, 2 * 60 * 60 * 1000);

      return res.status(200).json({ action: 'new_lead', id: newLead?.id });
    }

    await supabase.from('leads')
      .update({ last_msg_at: new Date().toISOString(), name: name || existingLead.name })
      .eq('phone', phone);

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'ignored_dropped' });
    }

    if (existingLead.status === 'new') {
      const program = detectProgram(text);
      if (program) {
        await supabase.from('leads')
          .update({ status: 'qualified', program_interest: program })
          .eq('phone', phone);

        const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${existingLead.id}`;
        const intakeUrl = `https://www.fitnessbymaddy.com/intake?lead=${existingLead.id}`;

        const market = existingLead.market;
        if (useHinglish(market)) {
          await sendTemplate(phone, 'program_match_hi', [program, checkoutUrl, intakeUrl]);
        } else {
          await sendTemplate(phone, 'program_match', [program, checkoutUrl, intakeUrl]);
        }

        return res.status(200).json({ action: 'qualified', program });
      }
    }

    return res.status(200).json({ action: 'message_logged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
