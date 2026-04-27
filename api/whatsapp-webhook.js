const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp, notifyMaddy } = require('../lib/whatsapp');
const { detectMarket, classifyIntent, programFromIntent, maskPhone, json } = require('../lib/utils');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return json(res, { error: 'POST only' }, 405);

  const db = getSupabase();

  try {
    const payload = req.body;
    const phone = payload.senderPhone || payload.waId || payload.from;
    const text = payload.text || payload.message || payload.body || '';
    const name = payload.senderName || payload.pushName || null;

    if (!phone) return json(res, { error: 'No phone number' }, 400);

    await db.from('messages').insert({
      phone,
      direction: 'in',
      body: text,
    });

    const intent = classifyIntent(text);

    // Opt-out handling — stop immediately
    if (intent === 'OPT_OUT') {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      await db.from('clients').update({ status: 'paused' }).eq('phone', phone).eq('status', 'active');
      return json(res, { action: 'opted_out' });
    }

    // Escalation — notify Maddy
    if (intent === 'ESCALATE') {
      await notifyMaddy(`Escalation from ${maskPhone(phone)}: "${text.slice(0, 120)}"`);
      await sendWhatsApp({
        phone,
        templateName: 'escalation_ack',
        params: [name || 'there'],
      });
      return json(res, { action: 'escalated' });
    }

    // Check if existing lead
    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (existingLead) {
      await db.from('leads').update({
        last_msg_at: new Date().toISOString(),
        ...(intent && { program_interest: programFromIntent(intent) }),
      }).eq('id', existingLead.id);

      // If they expressed interest in a program, send checkout link
      if (intent && intent.startsWith('PROGRAM_')) {
        const program = programFromIntent(intent);
        const market = existingLead.market;
        const isHinglish = market === 'IN';

        await db.from('leads').update({ status: 'qualified', program_interest: program }).eq('id', existingLead.id);

        const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${existingLead.id}`;
        const intakeUrl = `https://fitnessbymaddy.com/intake?lead=${existingLead.id}`;

        await sendWhatsApp({
          phone,
          templateName: 'program_checkout',
          params: [
            name || 'there',
            programLabel(program),
            checkoutUrl,
            intakeUrl,
          ],
        });

        return json(res, { action: 'checkout_sent', program });
      }

      return json(res, { action: 'existing_lead_updated' });
    }

    // New lead
    const market = detectMarket(phone);
    const { data: lead, error: insertErr } = await db.from('leads').insert({
      phone,
      name,
      source: 'whatsapp',
      status: 'new',
      first_msg: text,
      last_msg_at: new Date().toISOString(),
      program_interest: programFromIntent(intent),
      market,
    }).select().single();

    if (insertErr) {
      console.error('Lead insert error:', insertErr.message);
      return json(res, { error: 'Failed to save lead' }, 500);
    }

    // Send welcome message
    await sendWhatsApp({
      phone,
      templateName: 'welcome_v1',
      params: [name || 'there'],
    });

    // If they already stated a goal, also send checkout
    if (intent && intent.startsWith('PROGRAM_')) {
      const program = programFromIntent(intent);
      await db.from('leads').update({ status: 'qualified', program_interest: program }).eq('id', lead.id);

      const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${lead.id}`;
      const intakeUrl = `https://fitnessbymaddy.com/intake?lead=${lead.id}`;

      await sendWhatsApp({
        phone,
        templateName: 'program_checkout',
        params: [name || 'there', programLabel(program), checkoutUrl, intakeUrl],
      });
    }

    return json(res, { action: 'new_lead', id: lead.id });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return json(res, { error: 'Internal error' }, 500);
  }
};

function programLabel(code) {
  const map = {
    '6wk_gym': '6-Week Burn & Build',
    'pcos': 'PCOS Warrior ($45)',
    '40plus': '40+ Strong ($50)',
    '12wk': '12-Week Flagship ($200)',
    'zoom_trial': '$20 Zoom Trial',
  };
  return map[code] || code;
}
