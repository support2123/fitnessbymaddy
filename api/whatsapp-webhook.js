const { getSupabase } = require('../lib/supabase');
const { sendTemplate, maskPhone, detectMarket } = require('../lib/whatsapp');
const { needsEscalation, escalateToMaddy } = require('../lib/escalation');
const { jsonResponse, errorResponse, handleOptions, normalizePhone, routeProgram, PROGRAM_NAMES } = require('../lib/utils');

module.exports = async function handler(req) {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return errorResponse('Method not allowed', 405);

  try {
    const body = await req.json();
    const phone = normalizePhone(body.phone || body.from || body.senderPhone || '');
    const text = body.text || body.message || body.body || '';
    const name = body.name || body.senderName || null;

    if (!phone) return errorResponse('Missing phone number');

    console.log(`Incoming WA from ${maskPhone(phone)}: ${text.slice(0, 50)}`);

    const db = getSupabase();

    await db.from('messages').insert({
      phone, direction: 'in', body: text
    });

    if (/^(stop|unsubscribe|opt.?out)$/i.test(text.trim())) {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return jsonResponse({ action: 'opted_out' });
    }

    if (needsEscalation(text)) {
      await escalateToMaddy('Flagged message from lead/client', {
        phone, details: text.slice(0, 200)
      });
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      const market = detectMarket(phone);
      const { data: lead } = await db.from('leads').insert({
        phone, name, source: 'whatsapp',
        status: 'new', first_msg: text,
        last_msg_at: new Date().toISOString(),
        market
      }).select().single();

      const welcomeParams = market === 'IN'
        ? ['Hi! Maddy\'s team here. Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?']
        : ['Hi! Maddy\'s team here. What\'s your goal — fat loss, PCOS management, strength, or 40+ fitness? Or try a trial session first?'];

      await sendTemplate(phone, 'welcome_v1', welcomeParams);

      return jsonResponse({ action: 'new_lead', lead_id: lead.id });
    }

    if (existingLead.status === 'dropped') {
      return jsonResponse({ action: 'lead_dropped_no_action' });
    }

    await db.from('leads').update({
      last_msg_at: new Date().toISOString(),
      name: name || existingLead.name
    }).eq('id', existingLead.id);

    if (existingLead.status === 'new') {
      const program = routeProgram(text);

      if (program) {
        await db.from('leads').update({
          status: 'qualified',
          program_interest: program
        }).eq('id', existingLead.id);

        const programName = PROGRAM_NAMES[program] || program;
        const market = existingLead.market || detectMarket(phone);

        const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${existingLead.id}`;
        const intakeUrl = `https://fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;

        const msgParams = market === 'IN'
          ? [
              `${programName} — perfect choice! Yeh raha checkout link: ${checkoutUrl}`,
              `Payment ke baad yeh intake form bhar do: ${intakeUrl}`
            ]
          : [
              `${programName} — great choice! Here's your checkout link: ${checkoutUrl}`,
              `After payment, fill out this intake form: ${intakeUrl}`
            ];

        await sendTemplate(phone, 'program_checkout', msgParams);

        return jsonResponse({ action: 'qualified', program });
      }
    }

    return jsonResponse({ action: 'message_logged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return errorResponse('Internal error', 500);
  }
};
