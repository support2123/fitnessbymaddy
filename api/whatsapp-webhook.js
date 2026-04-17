const { supabase } = require('../lib/supabase');
const { sendTemplate, sendText } = require('../lib/whatsapp');
const { detectMarket, isHinglish, maskPhone } = require('../lib/market');
const {
  needsEscalation,
  escalateToMaddy,
  routeProgram,
  programLabel,
  checkoutUrl,
} = require('../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const payload = req.body;
    const phone = payload.senderPhone || payload.from || payload.waId;
    const text = payload.text || payload.message || payload.body || '';
    const senderName = payload.senderName || payload.pushName || null;

    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    await supabase.from('messages').insert({
      phone,
      direction: 'in',
      body: text,
      template_name: null,
    });

    if (/^(stop|unsubscribe|opt.?out)$/i.test(text.trim())) {
      await supabase
        .from('leads')
        .update({ status: 'dropped' })
        .eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(text)) {
      await escalateToMaddy(
        'Keyword escalation',
        `${maskPhone(phone)}: ${text.substring(0, 150)}`
      );
    }

    const { data: existingClient } = await supabase
      .from('clients')
      .select('id, status')
      .eq('phone', phone)
      .eq('status', 'active')
      .limit(1);

    if (existingClient && existingClient.length > 0) {
      return res.status(200).json({ action: 'active_client_reply', client_id: existingClient[0].id });
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('id, status')
      .eq('phone', phone)
      .order('created_at', { ascending: false })
      .limit(1);

    const market = detectMarket(phone);
    const hinglish = isHinglish(market);

    if (!existingLead || existingLead.length === 0) {
      const { data: newLead } = await supabase
        .from('leads')
        .insert({
          phone,
          name: senderName,
          source: 'whatsapp',
          status: 'new',
          first_msg: text,
          last_msg_at: new Date().toISOString(),
          market,
        })
        .select()
        .single();

      await sendTemplate(phone, 'welcome_v1', [senderName || 'there']);

      return res.status(200).json({ action: 'new_lead', lead_id: newLead.id });
    }

    const lead = existingLead[0];

    if (lead.status === 'dropped') {
      return res.status(200).json({ action: 'lead_dropped_no_reply' });
    }

    await supabase
      .from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('id', lead.id);

    const program = routeProgram(text);
    if (program) {
      await supabase
        .from('leads')
        .update({ status: 'qualified', program_interest: program })
        .eq('id', lead.id);

      const url = checkoutUrl(program);
      const label = programLabel(program);
      const intakeUrl = `https://www.fitnessbymaddy.com/intake.html?lead=${lead.id}`;

      const msg = hinglish
        ? `Great choice! 🔥 ${label} — yeh program tere liye perfect hai.\n\nCheckout: ${url}\n\nPehle yeh form bhar do: ${intakeUrl}`
        : `Great choice! 🔥 ${label} is perfect for your goals.\n\nCheckout: ${url}\n\nPlease fill this quick form first: ${intakeUrl}`;

      await sendText(phone, msg);

      return res.status(200).json({ action: 'qualified', program });
    }

    return res.status(200).json({ action: 'reply_logged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
