const { getSupabase } = require('./lib/supabase');
const { sendWhatsApp, logMessage, notifyMaddy } = require('./lib/whatsapp');
const { detectMarket, isHinglish, maskPhone } = require('./lib/market');
const { needsEscalation, classifyEscalation } = require('./lib/escalation');
const { matchProgram, isOptOut, PROGRAM_NAMES, PROGRAM_PRICES } = require('./lib/keywords');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const body = req.body;
    const phone = '+' + (body.senderPhone || body.from || '').replace('+', '');
    const message = body.message || body.text || body.body || '';
    const senderName = body.senderName || body.name || '';

    if (!phone || phone.length < 8) {
      return res.status(400).json({ error: 'Invalid phone' });
    }

    const db = getSupabase();

    await logMessage(phone, 'in', null, [message], 'received');

    if (isOptOut(message)) {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      await db.from('clients').update({ status: 'paused' }).eq('phone', phone);
      return res.json({ action: 'opted_out' });
    }

    if (needsEscalation(message)) {
      const category = classifyEscalation(message);
      await notifyMaddy(
        `${category} — ${maskPhone(phone)}`,
        `Message: "${message.slice(0, 200)}"\nPhone: ${maskPhone(phone)}\nName: ${senderName}`
      );
      return res.json({ action: 'escalated', category });
    }

    const { data: existingClient } = await db
      .from('clients')
      .select('id, status, program')
      .eq('phone', phone)
      .eq('status', 'active')
      .limit(1)
      .single();

    if (existingClient) {
      return res.json({ action: 'active_client', client_id: existingClient.id });
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('id, status')
      .eq('phone', phone)
      .limit(1)
      .single();

    if (existingLead) {
      const program = matchProgram(message);
      if (program) {
        await db.from('leads').update({
          status: 'qualified',
          program_interest: program,
          last_msg_at: new Date().toISOString(),
        }).eq('id', existingLead.id);

        const hinglish = isHinglish(phone);
        const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${program}`;
        const intakeUrl = `https://www.fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;

        if (hinglish) {
          await sendWhatsApp(phone, 'program_offer_hi', [
            PROGRAM_NAMES[program],
            `$${PROGRAM_PRICES[program]}`,
            checkoutUrl,
            intakeUrl,
          ]);
        } else {
          await sendWhatsApp(phone, 'program_offer_en', [
            PROGRAM_NAMES[program],
            `$${PROGRAM_PRICES[program]}`,
            checkoutUrl,
            intakeUrl,
          ]);
        }

        return res.json({ action: 'qualified', program });
      }

      await db.from('leads').update({
        last_msg_at: new Date().toISOString(),
      }).eq('id', existingLead.id);

      return res.json({ action: 'existing_lead_updated' });
    }

    const market = detectMarket(phone);
    const { data: newLead } = await db.from('leads').insert({
      phone,
      name: senderName,
      source: 'whatsapp',
      status: 'new',
      first_msg: message,
      last_msg_at: new Date().toISOString(),
      market,
      created_at: new Date().toISOString(),
    }).select().single();

    const hinglish = isHinglish(phone);
    if (hinglish) {
      await sendWhatsApp(phone, 'welcome_v1_hi', [senderName || 'there']);
    } else {
      await sendWhatsApp(phone, 'welcome_v1_en', [senderName || 'there']);
    }

    return res.json({ action: 'new_lead', lead_id: newLead?.id });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
