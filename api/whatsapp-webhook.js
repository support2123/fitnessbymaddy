const { getSupabase } = require('./_lib/supabase');
const { sendTemplate, sendSession, logMessage, maskPhone } = require('./_lib/whatsapp');
const { detectMarket, isHinglish } = require('./_lib/market');
const { needsEscalation, escalateToMaddy } = require('./_lib/escalation');
const { qualifyLead, getCheckoutUrl } = require('./_lib/qualify');
const { canSendTo } = require('./_lib/rate-limiter');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const payload = req.body || {};
    const phone = (payload.mobile || payload.phone || payload.from || '').replace(/[^0-9]/g, '');
    const text = (payload.text || payload.message || payload.body || '').trim();
    const name = payload.name || payload.pushName || null;

    if (!phone) return res.status(400).json({ error: 'missing phone' });

    const db = getSupabase();

    await logMessage(phone, 'in', text, null);

    if (/^(stop|unsubscribe|opt.?out)$/i.test(text)) {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.json({ action: 'opted_out' });
    }

    if (needsEscalation(text)) {
      await escalateToMaddy('keyword_trigger', maskPhone(phone), text);
    }

    const { data: existingClient } = await db
      .from('clients')
      .select('id, status')
      .eq('phone', phone)
      .eq('status', 'active')
      .maybeSingle();

    if (existingClient) {
      return res.json({ action: 'active_client', client_id: existingClient.id });
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('id, status')
      .eq('phone', phone)
      .maybeSingle();

    const market = detectMarket(phone);

    if (!existingLead) {
      const { data: newLead } = await db.from('leads').insert({
        phone,
        name,
        source: 'whatsapp',
        status: 'new',
        first_msg: text,
        market,
      }).select('id').single();

      const hinglish = isHinglish(market);
      await sendTemplate(
        phone,
        'welcome_v1',
        hinglish
          ? ['Hi! Maddy\'s team here. Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?']
          : ['Hi! Maddy\'s team here. What\'s your goal — fat loss, PCOS, strength, or 40+ fitness? Or would you like to try a trial first?'],
        name || 'there'
      );

      return res.json({ action: 'new_lead', lead_id: newLead.id });
    }

    if (existingLead.status === 'dropped') {
      return res.json({ action: 'dropped_lead' });
    }

    const allowed = await canSendTo(phone);
    if (!allowed) {
      return res.json({ action: 'rate_limited' });
    }

    const qualification = qualifyLead(text);
    if (qualification) {
      await db.from('leads').update({
        status: 'qualified',
        program_interest: qualification.program,
        last_msg_at: new Date().toISOString(),
      }).eq('phone', phone);

      const checkoutUrl = getCheckoutUrl(qualification.program);
      const intakeUrl = `https://www.fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;
      const hinglish = isHinglish(market);

      await sendTemplate(
        phone,
        'program_checkout',
        hinglish
          ? [qualification.label, checkoutUrl, intakeUrl]
          : [qualification.label, checkoutUrl, intakeUrl],
        name || 'there'
      );

      return res.json({ action: 'qualified', program: qualification.program });
    }

    await db.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('phone', phone);

    return res.json({ action: 'message_logged' });
  } catch (err) {
    console.error('whatsapp-webhook error:', err.message);
    return res.status(500).json({ error: 'internal' });
  }
};
