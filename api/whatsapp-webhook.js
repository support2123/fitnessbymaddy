const { getClient } = require('../lib/supabase');
const { sendTemplate, sendText, logMessage, maskPhone } = require('../lib/whatsapp');
const { detectMarket, isHinglish } = require('../lib/market');
const { needsEscalation, escalateToMaddy } = require('../lib/escalation');
const { qualifyLead } = require('../lib/qualify');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const body = req.body;
    const phone = body.mobile || body.from || body.sender;
    const text = body.text || body.message || body.body || '';
    const name = body.name || body.pushName || null;

    if (!phone) return res.status(400).json({ error: 'missing phone' });

    const db = getClient();

    await logMessage(phone, 'in', text, null);

    if (/^(stop|unsubscribe|optout|opt out)$/i.test(text.trim())) {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.json({ action: 'opted_out' });
    }

    if (needsEscalation(text)) {
      await escalateToMaddy('Keyword trigger in WhatsApp message', {
        phone: maskPhone(phone),
        detail: text.slice(0, 200),
      });
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      const market = detectMarket(phone);
      const { data: newLead } = await db
        .from('leads')
        .insert({
          phone,
          name,
          source: 'whatsapp',
          status: 'new',
          first_msg: text,
          last_msg_at: new Date().toISOString(),
          market,
        })
        .select()
        .single();

      if (isHinglish(market)) {
        await sendTemplate(phone, 'welcome_v1', [
          name || 'there',
        ]);
      } else {
        await sendTemplate(phone, 'welcome_v1_en', [
          name || 'there',
        ]);
      }

      return res.json({ action: 'new_lead', id: newLead.id });
    }

    if (existingLead.status === 'dropped') {
      return res.json({ action: 'ignored_dropped' });
    }

    await db
      .from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('id', existingLead.id);

    if (existingLead.status === 'new') {
      const route = qualifyLead(text);
      if (route) {
        await db
          .from('leads')
          .update({
            status: 'qualified',
            program_interest: route.program,
          })
          .eq('id', existingLead.id);

        const market = existingLead.market || 'GLOBAL';
        const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${route.program}`;
        const intakeUrl = `https://fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;

        if (isHinglish(market)) {
          await sendTemplate(phone, 'program_recommend', [
            name || existingLead.name || 'there',
            route.label,
            `$${route.price}`,
            checkoutUrl,
          ]);
        } else {
          await sendTemplate(phone, 'program_recommend_en', [
            name || existingLead.name || 'there',
            route.label,
            `$${route.price}`,
            checkoutUrl,
          ]);
        }

        return res.json({
          action: 'qualified',
          program: route.program,
          lead_id: existingLead.id,
        });
      }
    }

    const { data: client } = await db
      .from('clients')
      .select('*')
      .eq('phone', phone)
      .eq('status', 'active')
      .single();

    if (client) {
      return res.json({ action: 'active_client_message', client_id: client.id });
    }

    return res.json({ action: 'message_logged' });
  } catch (err) {
    console.error('whatsapp-webhook error:', err.message);
    return res.status(500).json({ error: 'internal' });
  }
};
