const { getSupabase } = require('./lib/supabase');
const { sendWhatsApp, maskPhone } = require('./lib/whatsapp');
const { detectMarket, detectProgram, checkEscalation, checkOptOut, isHinglish, cors, parseBody } = require('./lib/helpers');
const { escalateToMaddy } = require('./lib/escalate');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const db = getSupabase();

  try {
    const body = await parseBody(req);
    const phone = body.mobile || body.phone || body.from || '';
    const message = body.message || body.text || body.body || '';
    const senderName = body.name || body.senderName || '';

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    await db.from('messages').insert({
      phone,
      direction: 'in',
      body: message
    });

    if (checkOptOut(message)) {
      await db.from('leads').upsert(
        { phone, status: 'dropped', last_msg_at: new Date().toISOString() },
        { onConflict: 'phone' }
      );
      console.log(`Opt-out: ${maskPhone(phone)}`);
      return res.status(200).json({ action: 'opted_out' });
    }

    const escalationKeyword = checkEscalation(message);
    if (escalationKeyword) {
      await escalateToMaddy(phone, escalationKeyword, message);
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
        first_msg: message,
        market
      }).select().single();

      const templateName = isHinglish(market) ? 'welcome_v1_hi' : 'welcome_v1_en';
      await sendWhatsApp(phone, templateName, [senderName || 'there']);

      const nudgeAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
      console.log(`New lead ${maskPhone(phone)}, nudge scheduled for ${nudgeAt}`);

      return res.status(200).json({ action: 'new_lead', lead_id: lead?.id });
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'ignored_dropped' });
    }

    await db.from('leads').update({
      last_msg_at: new Date().toISOString(),
      name: senderName || existingLead.name
    }).eq('phone', phone);

    if (existingLead.status === 'new') {
      const program = detectProgram(message);
      if (program) {
        await db.from('leads').update({
          status: 'qualified',
          program_interest: program
        }).eq('phone', phone);

        const market = existingLead.market || 'IN';
        const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${existingLead.id}`;
        const intakeUrl = `https://www.fitnessbymaddy.com/intake?lead=${existingLead.id}`;

        const templateName = isHinglish(market)
          ? 'program_matched_hi'
          : 'program_matched_en';

        await sendWhatsApp(phone, templateName, [
          senderName || 'there',
          program,
          checkoutUrl,
          intakeUrl
        ]);

        return res.status(200).json({ action: 'qualified', program });
      }
    }

    const { data: activeClient } = await db
      .from('clients')
      .select('*')
      .eq('phone', phone)
      .eq('status', 'active')
      .single();

    if (activeClient) {
      if (escalationKeyword) {
        return res.status(200).json({ action: 'escalated_client', keyword: escalationKeyword });
      }
      return res.status(200).json({ action: 'client_message_logged' });
    }

    return res.status(200).json({ action: 'message_logged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
