const { supabase } = require('../lib/supabase');
const { sendTemplate, sendText } = require('../lib/whatsapp');
const {
  detectMarket, maskPhone, needsEscalation, isOptOutMessage,
  classifyIntent, buildWelcomeReply, buildQualifiedReply,
} = require('../lib/helpers');

const MADDY_PHONE = '917082478374';
const NUDGE_DELAY_MS = 2 * 60 * 60 * 1000;

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const payload = req.body;
    const phone = payload.senderPhone || payload.from || payload.waId;
    const text = payload.text || payload.message?.text || payload.body || '';
    const senderName = payload.senderName || payload.pushName || null;

    if (!phone) return res.status(400).json({ error: 'no phone' });

    await supabase.from('messages').insert({
      phone, direction: 'in', body: text, template_name: null,
    });

    if (isOptOutMessage(text)) {
      await supabase.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.json({ action: 'opted_out' });
    }

    if (needsEscalation(text)) {
      await sendText(MADDY_PHONE,
        `🚨 ESCALATION from ${maskPhone(phone)}: "${text.slice(0, 200)}"`
      );
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      const market = detectMarket(phone);
      const { data: newLead } = await supabase.from('leads').insert({
        phone, name: senderName, source: 'whatsapp', status: 'new',
        first_msg: text, last_msg_at: new Date().toISOString(), market,
      }).select().single();

      const welcome = buildWelcomeReply(market);
      await sendText(phone, welcome);

      return res.json({ action: 'new_lead', lead_id: newLead.id });
    }

    await supabase.from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('id', existingLead.id);

    if (existingLead.status === 'dropped') {
      return res.json({ action: 'ignored_dropped' });
    }

    if (existingLead.status === 'new') {
      const program = classifyIntent(text);
      if (program) {
        await supabase.from('leads')
          .update({ status: 'qualified', program_interest: program })
          .eq('id', existingLead.id);

        const reply = buildQualifiedReply(program, existingLead.market, existingLead.id);
        await sendText(phone, reply);

        return res.json({ action: 'qualified', program });
      }

      const nudge = existingLead.market === 'IN'
        ? "Koi bhi sawaal ho toh poochlo! Ya $20 trial se start karo: https://www.fitnessbymaddy.com/program-trial.html"
        : "Any questions? Or start with our $20 trial: https://www.fitnessbymaddy.com/program-trial.html";
      await sendText(phone, nudge);

      return res.json({ action: 'nudged' });
    }

    if (existingLead.status === 'qualified') {
      const program = classifyIntent(text) || existingLead.program_interest;
      const reply = buildQualifiedReply(program, existingLead.market, existingLead.id);
      await sendText(phone, reply);
      return res.json({ action: 're_qualified', program });
    }

    return res.json({ action: 'no_action' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'internal' });
  }
};
