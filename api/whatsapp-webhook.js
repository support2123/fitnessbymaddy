const { supabase } = require('./lib/supabase');
const { sendTemplate, detectMarket, maskPhone } = require('./lib/whatsapp');
const { needsEscalation, escalateToMaddy, classifyProgram, PROGRAM_NAMES } = require('./lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const body = req.body;
    const phone = body.mobile || body.from || body.sender;
    const text = body.text || body.message || body.body || '';
    const name = body.name || body.pushName || null;

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    await supabase.from('messages').insert({
      phone,
      direction: 'in',
      body: text
    });

    if (/^(stop|unsubscribe|opt.?out)$/i.test(text.trim())) {
      await supabase.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.json({ action: 'opted_out' });
    }

    if (needsEscalation(text)) {
      await escalateToMaddy('Keyword trigger in message', {
        phone: maskPhone(phone),
        details: text.slice(0, 200)
      });
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      const market = detectMarket(phone);
      const { data: newLead } = await supabase.from('leads').insert({
        phone,
        name,
        source: 'whatsapp',
        status: 'new',
        first_msg: text,
        last_msg_at: new Date().toISOString(),
        market
      }).select().single();

      const isHinglish = market === 'IN';
      const templateName = isHinglish ? 'welcome_v1_hi' : 'welcome_v1_en';
      await sendTemplate(phone, templateName, {
        name: name || 'there',
        templateParams: [name || 'there']
      });

      return res.json({ action: 'new_lead', lead_id: newLead?.id });
    }

    if (existingLead.status === 'dropped') {
      return res.json({ action: 'ignored_dropped' });
    }

    await supabase.from('leads').update({
      last_msg_at: new Date().toISOString(),
      name: name || existingLead.name
    }).eq('id', existingLead.id);

    const program = classifyProgram(text);
    if (program && existingLead.status === 'new') {
      await supabase.from('leads').update({
        status: 'qualified',
        program_interest: program
      }).eq('id', existingLead.id);

      const programName = PROGRAM_NAMES[program];
      const market = existingLead.market || detectMarket(phone);
      const isHinglish = market === 'IN';

      const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${existingLead.id}`;
      const intakeUrl = `https://fitnessbymaddy.com/intake?lead=${existingLead.id}`;

      await sendTemplate(phone, 'program_match', {
        name: name || existingLead.name || 'there',
        templateParams: [
          name || existingLead.name || 'there',
          programName,
          checkoutUrl,
          intakeUrl
        ]
      });

      return res.json({ action: 'qualified', program });
    }

    const { data: existingClient } = await supabase
      .from('clients')
      .select('id, status')
      .eq('phone', phone)
      .eq('status', 'active')
      .single();

    if (existingClient) {
      return res.json({ action: 'active_client_msg', client_id: existingClient.id });
    }

    return res.json({ action: 'existing_lead_msg' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
