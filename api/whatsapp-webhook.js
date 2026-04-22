const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp, notifyMaddy } = require('../lib/whatsapp');
const { detectMarket, detectProgram, programLabel, needsEscalation, isOptOut, parseBody, cors, maskPhone } = require('../lib/helpers');
const { escalate } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const supabase = getSupabase();

  try {
    const body = await parseBody(req);
    const phone = body.mobile || body.phone || body.from || '';
    const text = body.message || body.text || body.body || '';
    const name = body.name || body.pushName || '';

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    await supabase.from('messages').insert({
      phone,
      direction: 'in',
      body: text,
      status: 'received'
    });

    if (isOptOut(text)) {
      await supabase
        .from('leads')
        .update({ status: 'dropped' })
        .eq('phone', phone);
      console.log(`[OptOut] ${maskPhone(phone)} opted out`);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(text)) {
      await escalate('Flagged message from lead/client', phone, text.slice(0, 200));
    }

    const { data: existing } = await supabase
      .from('leads')
      .select('id, status')
      .eq('phone', phone)
      .order('created_at', { ascending: false })
      .limit(1);

    if (existing && existing.length > 0) {
      const lead = existing[0];

      if (lead.status === 'dropped') {
        return res.status(200).json({ action: 'lead_dropped_no_reply' });
      }

      await supabase
        .from('leads')
        .update({ last_msg_at: new Date().toISOString() })
        .eq('id', lead.id);

      if (lead.status === 'new') {
        const program = detectProgram(text);
        if (program) {
          await supabase
            .from('leads')
            .update({ status: 'qualified', program_interest: program })
            .eq('id', lead.id);

          const market = detectMarket(phone);
          const isHinglish = market === 'IN';
          const label = programLabel(program);

          const qualifyMsg = isHinglish
            ? `Perfect! ${label} aapke liye best rahega. Yeh raha checkout link:`
            : `Perfect! ${label} is the best fit for you. Here's your checkout link:`;

          await sendWhatsApp(phone, 'program_recommend', {
            name: name || 'there',
            templateParams: [name || 'there', label]
          }, qualifyMsg);

          return res.status(200).json({ action: 'qualified', program });
        }
      }

      return res.status(200).json({ action: 'existing_lead_updated' });
    }

    const market = detectMarket(phone);
    const { data: newLead } = await supabase
      .from('leads')
      .insert({
        phone,
        name: name || null,
        source: 'whatsapp',
        status: 'new',
        first_msg: text,
        last_msg_at: new Date().toISOString(),
        market
      })
      .select('id')
      .single();

    const isHinglish = market === 'IN';
    const welcomeBody = isHinglish
      ? "Hi! Maddy's team here. Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?"
      : "Hi! Maddy's team here. What's your goal — fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial first?";

    await sendWhatsApp(phone, 'welcome_v1', {
      name: name || 'there',
      templateParams: [name || 'there']
    }, welcomeBody);

    return res.status(200).json({ action: 'new_lead', id: newLead?.id });
  } catch (err) {
    console.error('[WhatsApp Webhook] Error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
