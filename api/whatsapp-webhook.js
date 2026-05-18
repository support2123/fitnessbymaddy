const { supabase } = require('../lib/supabase');
const { sendTemplate, notifyMaddy } = require('../lib/whatsapp');
const {
  detectMarket, isHinglishMarket, needsEscalation, isOptOut,
  classifyProgram, programLabel, maskPhone, parseBody, cors
} = require('../lib/utils');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const body = await parseBody(req);

    const phone = body.phone || body.sender || body.from;
    const text = body.message || body.text || body.body || '';
    const name = body.name || body.senderName || null;

    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    await supabase.from('messages').insert({
      phone, direction: 'in', body: text
    });

    if (isOptOut(text)) {
      await supabase
        .from('leads')
        .update({ status: 'dropped' })
        .eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(text)) {
      await notifyMaddy(
        'Escalation Required',
        `Phone: ${maskPhone(phone)}\nMessage: ${text}\nReason: Keyword trigger`
      );
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      const market = detectMarket(phone);
      const { data: newLead } = await supabase
        .from('leads')
        .insert({
          phone,
          name,
          source: 'whatsapp',
          status: 'new',
          first_msg: text,
          last_msg_at: new Date().toISOString(),
          market
        })
        .select()
        .single();

      const welcomeParams = isHinglishMarket(market)
        ? [name || 'there']
        : [name || 'there'];

      await sendTemplate(phone, 'welcome_v1', welcomeParams, true);

      return res.status(200).json({ action: 'new_lead', id: newLead.id });
    }

    await supabase
      .from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('id', existingLead.id);

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'ignored_dropped' });
    }

    if (existingLead.status === 'new') {
      const program = classifyProgram(text);
      if (program) {
        await supabase
          .from('leads')
          .update({ status: 'qualified', program_interest: program })
          .eq('id', existingLead.id);

        const market = existingLead.market;
        const label = programLabel(program);
        const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${existingLead.id}`;
        const intakeUrl = `https://www.fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;

        const params = isHinglishMarket(market)
          ? [existingLead.name || 'there', label, checkoutUrl, intakeUrl]
          : [existingLead.name || 'there', label, checkoutUrl, intakeUrl];

        await sendTemplate(phone, 'program_recommendation', params, true);

        return res.status(200).json({ action: 'qualified', program });
      }

      return res.status(200).json({ action: 'awaiting_classification' });
    }

    return res.status(200).json({ action: 'existing_lead', status: existingLead.status });
  } catch (err) {
    console.error('Webhook error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
};
