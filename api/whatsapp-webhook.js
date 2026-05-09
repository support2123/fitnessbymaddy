const { getSupabase } = require('./_lib/supabase');
const { canSendMessage, sendTemplate, logMessage } = require('./_lib/whatsapp');
const {
  maskPhone, detectMarket, isHinglishMarket,
  needsEscalation, classifyIntent, PROGRAM_INFO, jsonResponse,
} = require('./_lib/helpers');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = req.body;
    const phone = body.mobile || body.from || body.senderMobile;
    const text = body.text || body.message || body.body || '';
    const name = body.name || body.senderName || '';

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    const db = getSupabase();
    const market = detectMarket(phone);
    const hinglish = isHinglishMarket(market);

    await logMessage(phone, 'in', text, null);

    if (needsEscalation(text)) {
      await sendTemplate(
        process.env.MADDY_PHONE || '+917082478374',
        'escalation_alert',
        [maskPhone(phone), text.slice(0, 200)]
      );
      await logMessage(phone, 'out', 'Escalated to Maddy', 'escalation_alert');
      return res.json({ status: 'escalated' });
    }

    const intent = classifyIntent(text);

    if (intent === 'STOP') {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      await db.from('clients').update({ status: 'paused' }).eq('phone', phone);
      return res.json({ status: 'opted_out' });
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('id, status')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      const { data: newLead } = await db.from('leads').insert({
        phone,
        name,
        source: 'whatsapp',
        status: 'new',
        first_msg: text,
        last_msg_at: new Date().toISOString(),
        program_interest: intent,
        market,
        created_at: new Date().toISOString(),
      }).select().single();

      const allowed = await canSendMessage(phone, false);
      if (allowed) {
        const templateName = hinglish ? 'welcome_v1_hi' : 'welcome_v1';
        await sendTemplate(phone, templateName, [name || 'there']);
        await logMessage(phone, 'out', 'Welcome message sent', templateName);
      }

      return res.json({ status: 'new_lead', lead_id: newLead?.id });
    }

    await db.from('leads').update({
      last_msg_at: new Date().toISOString(),
      program_interest: intent || undefined,
    }).eq('id', existingLead.id);

    if (existingLead.status === 'dropped') {
      return res.json({ status: 'lead_dropped_no_reply' });
    }

    if (intent && PROGRAM_INFO[intent]) {
      const program = PROGRAM_INFO[intent];
      const allowed = await canSendMessage(phone, false);
      if (allowed) {
        await db.from('leads').update({
          status: 'qualified',
          program_interest: intent,
        }).eq('id', existingLead.id);

        const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${existingLead.id}`;
        const intakeUrl = `https://fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;

        await sendTemplate(phone, 'program_offer', [
          name || 'there',
          program.name,
          `$${program.price}`,
          checkoutUrl,
          intakeUrl,
        ]);
        await logMessage(phone, 'out', `Offered ${program.name}`, 'program_offer');
      }

      return res.json({ status: 'qualified', program: intent });
    }

    return res.json({ status: 'message_logged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
