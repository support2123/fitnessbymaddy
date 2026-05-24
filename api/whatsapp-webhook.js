const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp, logIncoming } = require('../lib/whatsapp');
const { detectMarket, isHinglish } = require('../lib/market');
const { needsEscalation, escalateToMaddy } = require('../lib/escalation');
const { qualifyLead, getCheckoutUrl } = require('../lib/qualify');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const db = getSupabase();
  const body = req.body;

  const phone = body.mobile || body.from || body.waId;
  const message = body.text || body.message || body.body || '';
  const name = body.name || body.pushName || null;

  if (!phone) return res.status(400).json({ error: 'No phone number' });

  await logIncoming(phone, message);

  if (/^(stop|unsubscribe|opt.?out)$/i.test(message.trim())) {
    await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
    return res.status(200).json({ action: 'opted_out' });
  }

  if (needsEscalation(message)) {
    await escalateToMaddy('Keyword trigger in incoming message', { phone, message });
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
      name,
      source: 'whatsapp',
      status: 'new',
      first_msg: message,
      last_msg_at: new Date().toISOString(),
      market
    });

    const welcomeTemplate = isHinglish(market) ? 'welcome_v1_hi' : 'welcome_v1_en';
    await sendWhatsApp(phone, welcomeTemplate, {
      name: name || 'there',
      templateParams: [name || 'there']
    });

    return res.status(200).json({ action: 'new_lead_welcomed', market });
  }

  await db.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('phone', phone);

  if (existingLead.status === 'dropped') {
    return res.status(200).json({ action: 'ignored_dropped_lead' });
  }

  if (existingLead.status === 'new') {
    const qualification = qualifyLead(message);
    if (qualification) {
      await db.from('leads').update({
        status: 'qualified',
        program_interest: qualification.program
      }).eq('phone', phone);

      const market = existingLead.market;
      const checkoutUrl = getCheckoutUrl(qualification.program);
      const intakeUrl = `https://fitnessbymaddy.com/intake?lead=${existingLead.id}`;

      await sendWhatsApp(phone, 'program_match', {
        name: name || existingLead.name || 'there',
        templateParams: [
          existingLead.name || 'there',
          qualification.name,
          checkoutUrl,
          intakeUrl
        ]
      });

      return res.status(200).json({ action: 'qualified', program: qualification.program });
    }

    if (isHinglish(existingLead.market)) {
      await sendWhatsApp(phone, 'clarify_goal_hi', {
        name: existingLead.name || 'there',
        templateParams: [existingLead.name || 'there']
      });
    } else {
      await sendWhatsApp(phone, 'clarify_goal_en', {
        name: existingLead.name || 'there',
        templateParams: [existingLead.name || 'there']
      });
    }

    return res.status(200).json({ action: 'asked_for_clarification' });
  }

  return res.status(200).json({ action: 'noted' });
};
