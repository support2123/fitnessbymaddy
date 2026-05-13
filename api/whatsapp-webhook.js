const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { escalateToMaddy, shouldEscalate } = require('../lib/escalation');
const {
  normalizePhone, detectMarket, classifyIntent, isHinglish,
  PROGRAM_MAP, maskPhone,
} = require('../lib/utils');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const body = req.body;
    const rawPhone = body.mobile || body.phone || body.from || '';
    const phone = normalizePhone(rawPhone);
    const incomingMsg = body.message || body.text || body.body || '';
    const senderName = body.name || body.pushName || '';

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    const db = getSupabase();

    await db.from('messages').insert({
      phone,
      direction: 'in',
      body: incomingMsg,
      status: 'received',
    });

    const intent = classifyIntent(incomingMsg);

    if (intent === 'STOP') {
      await db.from('leads').upsert(
        { phone, status: 'dropped', last_msg_at: new Date().toISOString() },
        { onConflict: 'phone' }
      );
      console.log(`Opt-out: ${maskPhone(phone)}`);
      return res.json({ ok: true, action: 'opted_out' });
    }

    if (intent === 'ESCALATE' || shouldEscalate(incomingMsg)) {
      await escalateToMaddy({
        reason: 'Flagged message from lead',
        phone,
        name: senderName,
        message: incomingMsg,
      });
      return res.json({ ok: true, action: 'escalated' });
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .limit(1)
      .single();

    const market = detectMarket(phone);
    const hinglish = isHinglish(market);

    if (!existingLead) {
      await db.from('leads').insert({
        phone,
        name: senderName || null,
        source: 'whatsapp',
        status: 'new',
        first_msg: incomingMsg,
        last_msg_at: new Date().toISOString(),
        market,
      });

      const welcomeTemplate = hinglish ? 'welcome_v1_hi' : 'welcome_v1_en';
      await sendWhatsApp({
        phone,
        templateName: welcomeTemplate,
        bodyValues: [senderName || 'there'],
      });

      return res.json({ ok: true, action: 'new_lead', market });
    }

    if (existingLead.status === 'dropped') {
      return res.json({ ok: true, action: 'ignored_dropped' });
    }

    await db.from('leads').update({
      last_msg_at: new Date().toISOString(),
      name: senderName || existingLead.name,
    }).eq('phone', phone);

    if (intent && PROGRAM_MAP[intent]) {
      const program = PROGRAM_MAP[intent];

      await db.from('leads').update({
        status: 'qualified',
        program_interest: program.slug,
      }).eq('phone', phone);

      const msgBody = hinglish
        ? `Great choice! ${program.name} is perfect for you. Yahan se checkout karo:`
        : `Great choice! ${program.name} is perfect for you. Here's your checkout link:`;

      await sendWhatsApp({
        phone,
        templateName: 'program_offer',
        bodyValues: [
          senderName || 'there',
          program.name,
          `$${program.price}`,
          `https://fitnessbymaddyy.exlyapp.com/checkout/${existingLead.id}`,
        ],
      });

      await sendWhatsApp({
        phone,
        templateName: 'intake_form_link',
        bodyValues: [
          `https://www.fitnessbymaddy.com/intake.html?lead=${existingLead.id}`,
        ],
      });

      return res.json({ ok: true, action: 'qualified', program: program.slug });
    }

    return res.json({ ok: true, action: 'message_logged' });

  } catch (err) {
    console.error('Webhook error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
};
