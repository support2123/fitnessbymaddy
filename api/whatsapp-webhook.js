const { getSupabase } = require('./lib/supabase');
const { sendWhatsApp, detectMarket, routeProgram, needsEscalation, notifyMaddy, maskPhone } = require('./lib/whatsapp');
const { parseBody, json } = require('./lib/helpers');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return json(res, 200, { ok: true });
  if (req.method !== 'POST') return json(res, 405, { error: 'POST only' });

  const body = await parseBody(req);
  const phone = body.mobile || body.phone || body.from;
  const text = body.text || body.message || body.body || '';
  const name = body.name || body.pushName || '';

  if (!phone) return json(res, 400, { error: 'missing phone' });

  const db = getSupabase();

  await db.from('messages').insert({
    phone,
    direction: 'in',
    body: text,
    sent_at: new Date().toISOString(),
    status: 'received',
  });

  const stopWords = ['stop', 'unsubscribe', 'opt out', 'optout'];
  if (stopWords.some(w => text.toLowerCase().includes(w))) {
    await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
    await db.from('clients').update({ status: 'paused' }).eq('phone', phone).eq('status', 'active');
    return json(res, 200, { action: 'opted-out' });
  }

  if (needsEscalation(text)) {
    await notifyMaddy(
      'Lead/Client needs attention',
      `${maskPhone(phone)}: "${text.slice(0, 100)}"`
    );
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

    const greeting = market === 'IN'
      ? `Hi${name ? ' ' + name : ''}! Maddy's team here 👋 Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?`
      : `Hi${name ? ' ' + name : ''}! Welcome to Fitness by Maddy 👋 What's your goal — fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?`;

    await sendWhatsApp(phone, 'welcome_v1', [greeting]);

    return json(res, 200, { action: 'new-lead', lead_id: newLead?.id });
  }

  await db.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('phone', phone);

  if (existingLead.status === 'dropped') {
    return json(res, 200, { action: 'ignored-dropped' });
  }

  if (existingLead.status === 'new') {
    const program = routeProgram(text);
    if (program) {
      await db.from('leads').update({
        status: 'qualified',
        program_interest: program,
      }).eq('id', existingLead.id);

      const market = existingLead.market || 'GLOBAL';
      const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${existingLead.id}`;
      const intakeUrl = `https://fitnessbymaddy.com/intake?lead=${existingLead.id}`;

      const msg = market === 'IN'
        ? `Great choice! Yeh raha checkout link: ${checkoutUrl}\n\nPayment ke baad, yeh form fill karo: ${intakeUrl}`
        : `Great choice! Here's your checkout link: ${checkoutUrl}\n\nAfter payment, please fill this form: ${intakeUrl}`;

      await sendWhatsApp(phone, 'checkout_link', [msg]);

      return json(res, 200, { action: 'qualified', program });
    }

    return json(res, 200, { action: 'awaiting-qualification' });
  }

  return json(res, 200, { action: 'existing-lead', status: existingLead.status });
};
