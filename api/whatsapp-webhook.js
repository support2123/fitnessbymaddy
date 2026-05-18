const { getSupabase } = require('../lib/supabase');
const { normalizePhone, detectMarket, isHinglish, matchProgram, isOptOut, maskPhone, PROGRAM_NAMES, PROGRAM_PRICES } = require('../lib/helpers');
const { canSend, sendTemplate } = require('../lib/whatsapp');
const { checkAndEscalate } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const payload = req.body;
    const rawPhone = payload.mobile || payload.phone || payload.from || payload.waId;
    const text = payload.text || payload.message || payload.body || '';
    const name = payload.name || payload.pushName || null;

    if (!rawPhone) return res.status(400).json({ error: 'No phone number' });
    const phone = normalizePhone(rawPhone);

    const db = getSupabase();

    await db.from('messages').insert({
      phone, direction: 'in', body: text, status: 'received'
    });

    // Opt-out check
    if (isOptOut(text)) {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      console.log(`Opt-out: ${maskPhone(phone)}`);
      return res.json({ action: 'opted_out' });
    }

    // Escalation check
    const { data: existingLead } = await db
      .from('leads').select('*').eq('phone', phone).single();
    const escalated = await checkAndEscalate(text, { phone, name: existingLead?.name || name });
    if (escalated) {
      return res.json({ action: 'escalated' });
    }

    // Check if already a client
    const { data: existingClient } = await db
      .from('clients').select('id').eq('phone', phone).eq('status', 'active').single();
    if (existingClient) {
      return res.json({ action: 'active_client', note: 'Routed to client support' });
    }

    const market = detectMarket(phone);
    const hinglish = isHinglish(market);

    // New lead - never seen this number
    if (!existingLead) {
      await db.from('leads').insert({
        phone, name, source: 'whatsapp', status: 'new',
        first_msg: text, last_msg_at: new Date().toISOString(), market
      });
      await sendTemplate(phone, 'welcome_v1', [name || 'there']);
      return res.json({ action: 'new_lead', template: 'welcome_v1' });
    }

    // Existing lead - update last message
    await db.from('leads').update({
      last_msg_at: new Date().toISOString(),
      name: name || existingLead.name
    }).eq('id', existingLead.id);

    // Try to match program from their reply
    const matched = matchProgram(text);
    if (matched && existingLead.status === 'new') {
      await db.from('leads').update({
        status: 'qualified', program_interest: matched
      }).eq('id', existingLead.id);

      const programName = PROGRAM_NAMES[matched];
      const price = PROGRAM_PRICES[matched];

      if (matched === 'zoom_trial') {
        const templateName = hinglish ? 'trial_offer_hi' : 'trial_offer_en';
        await sendTemplate(phone, templateName, [
          existingLead.name || 'there',
          `$${price}`,
          'https://fitnessbymaddyy.exlyapp.com/checkout/zoom-trial'
        ]);
      } else {
        const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${matched}`;
        const intakeUrl = `https://fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;
        const templateName = hinglish ? 'program_offer_hi' : 'program_offer_en';
        await sendTemplate(phone, templateName, [
          existingLead.name || 'there',
          programName,
          `$${price}`,
          checkoutUrl
        ]);

        if (await canSend(phone, false)) {
          await sendTemplate(phone, 'intake_form', [intakeUrl]);
        }
      }

      return res.json({ action: 'qualified', program: matched });
    }

    // If lead is already qualified but hasn't converted, nudge checkout
    if (existingLead.status === 'qualified' && existingLead.program_interest) {
      const prog = existingLead.program_interest;
      const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${prog}`;
      if (await canSend(phone, false)) {
        const templateName = hinglish ? 'checkout_reminder_hi' : 'checkout_reminder_en';
        await sendTemplate(phone, templateName, [
          existingLead.name || 'there',
          checkoutUrl
        ]);
      }
      return res.json({ action: 'nudge_checkout', program: prog });
    }

    return res.json({ action: 'acknowledged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
