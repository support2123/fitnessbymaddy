const { getSupabase } = require('../lib/supabase');
const { detectMarket, isHinglish, canSendMessage, sendTemplate, maskPhone } = require('../lib/whatsapp');
const { needsEscalation, isOptOut, createEscalation } = require('../lib/escalation');
const { qualifyLead } = require('../lib/qualify');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const db = getSupabase();

  try {
    const payload = req.body;
    const phone = payload.phone || payload.senderPhone || payload.from;
    const text = payload.text || payload.message || payload.body || '';
    const senderName = payload.name || payload.senderName || null;

    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    await db.from('messages').insert({
      phone,
      direction: 'in',
      body: text.slice(0, 1000),
      status: 'received'
    });

    if (isOptOut(text)) {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.json({ action: 'opted_out' });
    }

    if (needsEscalation(text)) {
      const { data: client } = await db
        .from('clients')
        .select('id')
        .eq('phone', phone)
        .eq('status', 'active')
        .single();
      await createEscalation(phone, 'keyword_trigger', text, client?.id);
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      const market = detectMarket(phone);
      const { data: lead } = await db.from('leads').insert({
        phone,
        name: senderName,
        source: 'whatsapp',
        status: 'new',
        first_msg: text.slice(0, 500),
        last_msg_at: new Date().toISOString(),
        market
      }).select().single();

      const hinglish = isHinglish(market);
      const templateName = hinglish ? 'welcome_v1_hi' : 'welcome_v1';

      if (await canSendMessage(phone)) {
        await sendTemplate(phone, templateName, [senderName || 'there']);
      }

      return res.json({ action: 'new_lead', lead_id: lead?.id });
    }

    if (existingLead.status === 'dropped') {
      return res.json({ action: 'ignored_dropped' });
    }

    await db.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('id', existingLead.id);

    if (existingLead.status === 'new') {
      const route = qualifyLead(text);
      if (route) {
        await db.from('leads').update({
          status: 'qualified',
          program_interest: route.program
        }).eq('id', existingLead.id);

        if (await canSendMessage(phone)) {
          const market = existingLead.market || 'GLOBAL';
          const hinglish = isHinglish(market);

          const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${route.program}`;
          const intakeUrl = `https://www.fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;

          const msg = hinglish
            ? `${route.name} ($${route.price}) — perfect choice!\n\nCheckout: ${checkoutUrl}\n\nIntake form bhar do: ${intakeUrl}`
            : `${route.name} ($${route.price}) — great choice!\n\nCheckout: ${checkoutUrl}\n\nPlease fill the intake form: ${intakeUrl}`;

          await sendTemplate(phone, 'program_qualified', [
            route.name,
            `$${route.price}`,
            checkoutUrl,
            intakeUrl
          ]);
        }

        return res.json({ action: 'qualified', program: route.program });
      }
    }

    return res.json({ action: 'message_logged' });

  } catch (err) {
    console.error('[whatsapp-webhook] Error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
