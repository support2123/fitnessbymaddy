const { getSupabase } = require('./lib/supabase');
const { sendWhatsApp, maskPhone, detectMarket } = require('./lib/whatsapp');
const { checkEscalation, notifyMaddy } = require('./lib/escalation');
const { qualifyLead } = require('./lib/qualify');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method === 'GET') return res.status(200).json({ status: 'ok' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const db = getSupabase();

  try {
    const payload = req.body;
    const phone = payload.mobile || payload.from || payload.senderMobile;
    const message = payload.text || payload.message || payload.body || '';
    const senderName = payload.name || payload.senderName || null;

    if (!phone) {
      return res.status(400).json({ error: 'No phone number in payload' });
    }

    await db.from('messages').insert({
      phone,
      direction: 'in',
      body: message,
    });

    const stopWords = ['stop', 'unsubscribe', 'opt out', 'optout'];
    if (stopWords.some(w => message.toLowerCase().includes(w))) {
      await db
        .from('leads')
        .update({ status: 'dropped', opted_out: true })
        .eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    const escalationKeyword = checkEscalation(message);
    if (escalationKeyword) {
      await db
        .from('leads')
        .update({ escalated: true, escalation_reason: escalationKeyword })
        .eq('phone', phone);
      await notifyMaddy(escalationKeyword, {
        phone: maskPhone(phone),
        detail: message.slice(0, 200),
      });
      return res.status(200).json({ action: 'escalated', keyword: escalationKeyword });
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      const market = detectMarket(phone);
      await db.from('leads').insert({
        phone,
        name: senderName,
        source: 'whatsapp',
        status: 'new',
        first_msg: message,
        last_msg_at: new Date().toISOString(),
        market,
      });

      await sendWhatsApp(phone, 'welcome_v1', [senderName || 'there']);

      return res.status(200).json({ action: 'new_lead', market });
    }

    if (existingLead.opted_out) {
      return res.status(200).json({ action: 'ignored_opted_out' });
    }

    await db
      .from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('id', existingLead.id);

    if (existingLead.status === 'new') {
      const match = qualifyLead(message);
      if (match) {
        await db
          .from('leads')
          .update({
            status: 'qualified',
            program_interest: match.program,
          })
          .eq('id', existingLead.id);

        const market = existingLead.market || 'IN';
        const lang = market === 'IN' ? 'hinglish' : 'english';

        const templateName =
          lang === 'hinglish' ? 'qualified_hinglish' : 'qualified_english';

        await sendWhatsApp(phone, templateName, [
          existingLead.name || 'there',
          match.label,
          match.price,
          `https://fitnessbymaddyy.exlyapp.com/checkout/${match.program}`,
          `https://fitnessbymaddy.com/intake?lead=${existingLead.id}`,
        ]);

        return res.status(200).json({ action: 'qualified', program: match.program });
      }

      await sendWhatsApp(phone, 'clarify_goal', [existingLead.name || 'there']);
      return res.status(200).json({ action: 'asked_clarification' });
    }

    return res.status(200).json({ action: 'received', leadStatus: existingLead.status });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
