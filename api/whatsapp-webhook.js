const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp, maskPhone } = require('../lib/whatsapp');
const { detectMarket, getWelcomeMessage, getNudgeMessage, detectProgram, getProgramInfo, isHinglish } = require('../lib/market');
const { needsEscalation, escalateToMaddy } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const payload = req.body;
    const phone = payload.senderPhone || payload.waId || payload.from;
    const message = payload.text || payload.message || payload.body || '';
    const senderName = payload.senderName || payload.pushName || null;

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    const supabase = getSupabase();

    await supabase.from('messages').insert({
      phone: maskPhone(phone),
      direction: 'in',
      body: message.substring(0, 1000),
    });

    if (message.toLowerCase().match(/\b(stop|unsubscribe)\b/)) {
      await supabase.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    const escalationTrigger = needsEscalation(message);
    if (escalationTrigger) {
      await escalateToMaddy(phone, escalationTrigger, message);
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
        name: senderName,
        source: 'whatsapp',
        status: 'new',
        first_msg: message.substring(0, 500),
        market,
      }).select().single();

      await sendWhatsApp(phone, 'welcome_v1', [
        senderName || 'there',
        getWelcomeMessage(market),
      ]);

      scheduleNudge(phone, market, newLead?.id);
      return res.status(200).json({ action: 'new_lead', id: newLead?.id });
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'lead_dropped' });
    }

    await supabase.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('id', existingLead.id);

    if (existingLead.status === 'new') {
      const program = detectProgram(message);
      if (program) {
        const info = getProgramInfo(program);
        const market = existingLead.market || detectMarket(phone);
        const hinglish = isHinglish(market);

        await supabase.from('leads').update({
          status: 'qualified',
          program_interest: program,
        }).eq('id', existingLead.id);

        const qualifyMsg = hinglish
          ? `Great choice! ${info.name} — $${info.price}. Yeh raha checkout link 👇`
          : `Great choice! ${info.name} — $${info.price}. Here's your checkout link 👇`;

        await sendWhatsApp(phone, 'program_checkout', [
          senderName || existingLead.name || 'there',
          qualifyMsg,
          `https://fitnessbymaddyy.exlyapp.com/checkout/${program}`,
          `https://fitnessbymaddy.com/intake?lead=${existingLead.id}`,
        ]);

        return res.status(200).json({ action: 'qualified', program });
      }
    }

    const { data: activeClient } = await supabase
      .from('clients')
      .select('*')
      .eq('phone', phone)
      .eq('status', 'active')
      .single();

    if (activeClient) {
      return res.status(200).json({ action: 'active_client', client_id: activeClient.id });
    }

    return res.status(200).json({ action: 'message_logged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function scheduleNudge(phone, market, leadId) {
  setTimeout(async () => {
    try {
      const supabase = getSupabase();
      const { data: lead } = await supabase.from('leads').select('status').eq('id', leadId).single();
      if (lead && lead.status === 'new') {
        await sendWhatsApp(phone, 'nudge_trial', [getNudgeMessage(market)]);
      }
    } catch (e) {
      console.error('Nudge error:', e.message);
    }
  }, 2 * 60 * 60 * 1000);
}
