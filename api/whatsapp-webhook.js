const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { detectMarket, classifyIntent, maskPhone, json, cors, PROGRAM_NAMES } = require('../lib/utils');

module.exports = async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return json(res, { error: 'POST only' }, 405);

  const db = getSupabase();

  try {
    const body = req.body || {};
    const phone = body.mobile || body.from || body.sender;
    const message = body.message || body.text || body.body || '';
    const name = body.name || body.pushName || null;

    if (!phone) return json(res, { error: 'No phone number' }, 400);

    await db.from('messages').insert({
      phone,
      direction: 'in',
      body: message,
      status: 'received',
    });

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .limit(1)
      .single();

    const intent = classifyIntent(message);

    if (intent && intent.type === 'optout') {
      if (existingLead) {
        await db.from('leads').update({ status: 'dropped' }).eq('id', existingLead.id);
      }
      return json(res, { action: 'opted_out' });
    }

    if (intent && intent.type === 'escalation') {
      await db.from('escalations').insert({
        phone,
        client_id: null,
        reason: `Keyword detected: ${intent.keyword}`,
        message_body: message,
      });
      await sendWhatsApp(
        process.env.MADDY_PHONE || phone,
        'escalation_alert',
        [maskPhone(phone), intent.keyword, message.slice(0, 100)]
      );
      return json(res, { action: 'escalated', keyword: intent.keyword });
    }

    if (!existingLead) {
      const market = detectMarket(phone);
      const { data: newLead } = await db
        .from('leads')
        .insert({
          phone,
          name,
          source: 'whatsapp',
          status: 'new',
          first_msg: message,
          market,
        })
        .select()
        .single();

      const isIN = market === 'IN';
      await sendWhatsApp(phone, 'welcome_v1', [
        name || (isIN ? 'there' : 'there'),
      ]);

      return json(res, { action: 'new_lead', lead_id: newLead.id });
    }

    await db
      .from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('id', existingLead.id);

    if (existingLead.status === 'dropped') {
      return json(res, { action: 'ignored_dropped' });
    }

    if (intent && intent.type === 'program') {
      await db
        .from('leads')
        .update({
          status: 'qualified',
          program_interest: intent.program,
        })
        .eq('id', existingLead.id);

      const programName = PROGRAM_NAMES[intent.program] || intent.program;
      const isIN = existingLead.market === 'IN';

      await sendWhatsApp(phone, 'program_recommendation', [
        existingLead.name || (isIN ? 'there' : 'there'),
        programName,
        `https://fitnessbymaddyy.exlyapp.com/checkout/${intent.program}`,
        `https://fitnessbymaddy.com/intake?lead=${existingLead.id}`,
      ]);

      return json(res, { action: 'qualified', program: intent.program });
    }

    return json(res, { action: 'message_logged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return json(res, { error: 'Internal error' }, 500);
  }
};
