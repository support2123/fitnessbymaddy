const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { detectMarket, isHinglish, maskPhone } = require('../lib/market');
const { needsEscalation, escalateToMaddy, detectOptOut } = require('../lib/escalation');
const { routeToProgram, getProgramInfo } = require('../lib/program-router');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = req.body;
    const phone = body.mobile || body.from || body.phone;
    const text = body.text || body.message || body.body || '';
    const name = body.name || body.pushName || '';

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    const db = getSupabase();
    const market = detectMarket(phone);
    const hinglish = isHinglish(market);

    await db.from('messages').insert({
      phone,
      direction: 'in',
      body: text
    });

    if (detectOptOut(text)) {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      console.log(`Opt-out: ${maskPhone(phone)}`);
      return res.json({ action: 'opted_out' });
    }

    if (needsEscalation(text)) {
      await escalateToMaddy('Keyword trigger in message', { phone, name, message: text });
      return res.json({ action: 'escalated' });
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      await db.from('leads').insert({
        phone,
        name,
        source: 'whatsapp',
        status: 'new',
        first_msg: text,
        last_msg_at: new Date().toISOString(),
        market
      });

      const welcomeMsg = hinglish
        ? 'welcome_v1_hi'
        : 'welcome_v1_en';

      await sendWhatsApp(phone, welcomeMsg, {
        name: name || 'there',
        templateParams: [name || 'there']
      });

      return res.json({ action: 'new_lead', market });
    }

    await db.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('phone', phone);

    if (existingLead.status === 'dropped') {
      return res.json({ action: 'dropped_lead_ignored' });
    }

    if (existingLead.status === 'new') {
      const programKey = routeToProgram(text);

      if (programKey) {
        const info = getProgramInfo(programKey);
        await db.from('leads').update({
          status: 'qualified',
          program_interest: programKey
        }).eq('id', existingLead.id);

        const qualifyTemplate = hinglish ? 'qualify_v1_hi' : 'qualify_v1_en';

        await sendWhatsApp(phone, qualifyTemplate, {
          name: name || existingLead.name || 'there',
          templateParams: [
            name || existingLead.name || 'there',
            info.name,
            `$${info.price}`,
            `https://fitnessbymaddy.com/intake?lead=${existingLead.id}`
          ]
        });

        return res.json({ action: 'qualified', program: programKey });
      }

      const defaultReply = hinglish
        ? 'default_reply_hi'
        : 'default_reply_en';

      await sendWhatsApp(phone, defaultReply, {
        name: name || existingLead.name || 'there',
        templateParams: [name || existingLead.name || 'there']
      });

      return res.json({ action: 'replied_default' });
    }

    return res.json({ action: 'existing_lead', status: existingLead.status });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
