const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp, maskPhone } = require('../lib/whatsapp');
const { shouldEscalate, createEscalation } = require('../lib/escalation');
const { detectMarket, isHinglish, classifyIntent, isOptOut, jsonResponse } = require('../lib/utils');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = req.body;
    const phone = body.mobile || body.senderMobile || body.from;
    const message = body.message || body.text || body.body || '';
    const senderName = body.senderName || body.name || null;

    if (!phone) {
      return res.status(400).json({ error: 'No phone number' });
    }

    const db = getSupabase();

    await db.from('messages').insert({
      phone,
      direction: 'in',
      body: message,
      template_name: null,
    });

    if (isOptOut(message)) {
      await db
        .from('leads')
        .update({ status: 'dropped', opted_out: true })
        .eq('phone', phone);
      console.log(`Opt-out: ${maskPhone(phone)}`);
      return res.status(200).json({ action: 'opted_out' });
    }

    const escalationKeyword = shouldEscalate(message);
    if (escalationKeyword) {
      const { data: client } = await db
        .from('clients')
        .select('id')
        .eq('phone', phone)
        .eq('status', 'active')
        .limit(1)
        .maybeSingle();

      await createEscalation(
        phone,
        `Keyword detected: ${escalationKeyword}`,
        message,
        client?.id
      );
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .maybeSingle();

    if (existingLead?.opted_out) {
      return res.status(200).json({ action: 'ignored_opted_out' });
    }

    const market = detectMarket(phone);

    if (!existingLead) {
      await db.from('leads').insert({
        phone,
        name: senderName,
        source: 'whatsapp',
        status: 'new',
        first_msg: message,
        last_msg_at: new Date().toISOString(),
        market,
      });

      const welcomeTemplate = isHinglish(market) ? 'welcome_v1_hi' : 'welcome_v1_en';
      await sendWhatsApp(phone, welcomeTemplate, [senderName || 'there']);

      return res.status(200).json({ action: 'new_lead', market });
    }

    await db
      .from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('id', existingLead.id);

    if (existingLead.status === 'dropped') {
      await db
        .from('leads')
        .update({ status: 'new' })
        .eq('id', existingLead.id);
    }

    const intent = classifyIntent(message);
    if (intent && existingLead.status !== 'converted') {
      await db
        .from('leads')
        .update({
          status: 'qualified',
          program_interest: intent.program,
        })
        .eq('id', existingLead.id);

      const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${intent.program}`;
      const intakeUrl = `https://fitnessbymaddy.com/intake?lead=${existingLead.id}`;

      if (isHinglish(market)) {
        await sendWhatsApp(phone, 'program_match_hi', [
          senderName || 'there',
          intent.name,
          checkoutUrl,
          intakeUrl,
        ]);
      } else {
        await sendWhatsApp(phone, 'program_match_en', [
          senderName || 'there',
          intent.name,
          checkoutUrl,
          intakeUrl,
        ]);
      }

      return res.status(200).json({ action: 'qualified', program: intent.program });
    }

    return res.status(200).json({ action: 'message_logged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
