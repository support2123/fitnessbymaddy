const { getSupabase } = require('./lib/supabase');
const { sendWhatsApp, notifyMaddy } = require('./lib/whatsapp');
const {
  detectMarket, isHinglishMarket, detectProgram, needsEscalation,
  isOptOut, programLabel, maskPhone, corsHeaders,
} = require('./lib/utils');

module.exports = async function handler(req, res) {
  corsHeaders(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const body = req.body || {};
    const phone = body.sender || body.from || body.waId || '';
    const text = body.text || body.message || body.body || '';
    const name = body.senderName || body.pushName || '';

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    const db = getSupabase();

    await db.from('messages').insert({
      phone, direction: 'in', body: text, template_name: null,
    });

    if (isOptOut(text)) {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      console.log(`[Webhook] Opt-out from ${maskPhone(phone)}`);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(text)) {
      await notifyMaddy('Sensitive message received', `From: ${maskPhone(phone)}\nMessage: ${text.slice(0, 200)}`);
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      const market = detectMarket(phone);
      const hinglish = isHinglishMarket(market);

      await db.from('leads').insert({
        phone, name: name || null, source: 'whatsapp',
        status: 'new', first_msg: text, market,
      });

      const welcomeValues = hinglish
        ? [name || 'there']
        : [name || 'there'];

      await sendWhatsApp({
        phone,
        templateName: 'welcome_v1',
        bodyValues: welcomeValues,
      });

      console.log(`[Webhook] New lead: ${maskPhone(phone)} market=${market}`);
      return res.status(200).json({ action: 'new_lead', market });
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'ignored_dropped' });
    }

    await db.from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('id', existingLead.id);

    if (existingLead.status === 'new' || existingLead.status === 'qualified') {
      const program = detectProgram(text);
      if (program) {
        await db.from('leads').update({
          status: 'qualified', program_interest: program,
        }).eq('id', existingLead.id);

        const hinglish = isHinglishMarket(existingLead.market);
        const label = programLabel(program);

        await sendWhatsApp({
          phone,
          templateName: 'program_recommendation',
          bodyValues: [
            name || existingLead.name || 'there',
            label,
            `https://fitnessbymaddy.com/intake?lead=${existingLead.id}`,
          ],
        });

        console.log(`[Webhook] Qualified ${maskPhone(phone)} → ${program}`);
        return res.status(200).json({ action: 'qualified', program });
      }
    }

    const { data: existingClient } = await db
      .from('clients')
      .select('id, status')
      .eq('phone', phone)
      .eq('status', 'active')
      .single();

    if (existingClient && needsEscalation(text)) {
      await notifyMaddy(
        'Active client concern',
        `Client ID: ${existingClient.id}\nPhone: ${maskPhone(phone)}\nMessage: ${text.slice(0, 200)}`
      );
    }

    return res.status(200).json({ action: 'logged' });
  } catch (err) {
    console.error('[Webhook] Error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
