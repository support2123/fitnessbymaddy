const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { escalateToMaddy } = require('../lib/escalate');
const {
  detectMarket,
  maskPhone,
  isHinglish,
  needsEscalation,
  classifyIntent,
  PROGRAM_INFO,
  corsHeaders,
} = require('../lib/utils');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders());
    return res.end();
  }

  if (req.method !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Method not allowed' }));
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const phone = body.senderPhone || body.waId || body.from;
    const text = body.text || body.message || body.body || '';
    const senderName = body.senderName || body.pushName || null;

    if (!phone) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'No phone number' }));
    }

    const db = getSupabase();

    await db.from('messages').insert({
      phone,
      direction: 'in',
      body: text,
      sent_at: new Date().toISOString(),
      status: 'received',
    });

    if (/\b(stop|unsubscribe)\b/i.test(text)) {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ action: 'opted_out' }));
    }

    if (needsEscalation(text)) {
      await escalateToMaddy({
        reason: 'Keyword trigger in message',
        phone,
        details: text,
      });
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .limit(1)
      .single();

    if (!existingLead) {
      const market = detectMarket(phone);
      const { data: newLead } = await db
        .from('leads')
        .insert({
          phone,
          name: senderName,
          source: 'whatsapp',
          status: 'new',
          first_msg: text,
          last_msg_at: new Date().toISOString(),
          market,
        })
        .select()
        .single();

      const welcomeMsg = isHinglish(market)
        ? undefined
        : undefined;

      await sendWhatsApp({
        phone,
        templateName: 'welcome_v1',
        bodyValues: [senderName || 'there'],
      });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ action: 'new_lead', id: newLead?.id }));
    }

    await db
      .from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('phone', phone);

    if (existingLead.status === 'dropped') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ action: 'dropped_ignored' }));
    }

    const { data: existingClient } = await db
      .from('clients')
      .select('id')
      .eq('phone', phone)
      .eq('status', 'active')
      .limit(1)
      .single();

    if (existingClient) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ action: 'active_client_reply' }));
    }

    const intent = classifyIntent(text);
    if (intent && PROGRAM_INFO[intent]) {
      const program = PROGRAM_INFO[intent];
      await db
        .from('leads')
        .update({ status: 'qualified', program_interest: intent })
        .eq('phone', phone);

      const market = existingLead.market || detectMarket(phone);
      const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${program.checkoutSlug}`;
      const intakeUrl = `https://fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;

      if (isHinglish(market)) {
        await sendWhatsApp({
          phone,
          templateName: 'program_offer_hi',
          bodyValues: [
            senderName || existingLead.name || 'there',
            program.name,
            `$${program.price}`,
            checkoutUrl,
            intakeUrl,
          ],
        });
      } else {
        await sendWhatsApp({
          phone,
          templateName: 'program_offer_en',
          bodyValues: [
            senderName || existingLead.name || 'there',
            program.name,
            `$${program.price}`,
            checkoutUrl,
            intakeUrl,
          ],
        });
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ action: 'qualified', program: intent }));
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ action: 'unclassified' }));
  } catch (err) {
    console.error('Webhook error:', err.message);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Internal server error' }));
  }
};
