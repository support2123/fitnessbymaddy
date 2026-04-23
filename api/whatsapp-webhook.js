const { getSupabase } = require('./lib/supabase');
const { canSendToLead, sendTemplate, sendText, notifyMaddy, logIncoming } = require('./lib/whatsapp');
const {
  normalizePhone, detectMarket, needsEscalation,
  detectProgram, isOptOut, maskPhone, cors, parseBody,
  PROGRAM_NAMES
} = require('./lib/helpers');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const sb = getSupabase();

  try {
    const body = await parseBody(req);

    const phone = normalizePhone(body.mobile || body.phone || body.from || '');
    const text = (body.text || body.message || body.body || '').trim();
    const senderName = body.name || body.pushName || '';

    if (!phone || !text) {
      return res.status(400).json({ error: 'Missing phone or message' });
    }

    await logIncoming(phone, text);

    if (isOptOut(text)) {
      await sb.from('leads').upsert(
        { phone, status: 'dropped', last_msg_at: new Date().toISOString() },
        { onConflict: 'phone' }
      );
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(text)) {
      await notifyMaddy(
        'Escalation needed',
        `From: ${maskPhone(phone)}\nMessage: ${text}`
      );
    }

    const { data: existingClient } = await sb
      .from('clients')
      .select('id, status')
      .eq('phone', phone)
      .eq('status', 'active')
      .limit(1)
      .maybeSingle();

    if (existingClient) {
      return res.status(200).json({ action: 'active_client', client_id: existingClient.id });
    }

    const { data: existingLead } = await sb
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .maybeSingle();

    if (!existingLead) {
      const market = detectMarket(phone);
      const { data: newLead } = await sb.from('leads').insert({
        phone,
        name: senderName || null,
        source: 'whatsapp',
        status: 'new',
        first_msg: text,
        last_msg_at: new Date().toISOString(),
        market
      }).select().single();

      const welcomeMsg = market === 'IN'
        ? `Hi ${senderName || ''}! Maddy's team here. Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?`
        : `Hi ${senderName || ''}! Welcome to Fitness by Maddy. What's your goal — fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?`;

      await sendTemplate(phone, 'welcome_v1', [senderName || 'there']);

      return res.status(200).json({ action: 'new_lead', lead_id: newLead.id });
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'dropped_lead' });
    }

    await sb.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('id', existingLead.id);

    const program = detectProgram(text);
    if (program) {
      await sb.from('leads').update({
        status: 'qualified',
        program_interest: program
      }).eq('id', existingLead.id);

      const programName = PROGRAM_NAMES[program];
      const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${existingLead.id}`;
      const intakeUrl = `https://fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;

      const market = existingLead.market || detectMarket(phone);
      const msg = market === 'IN'
        ? `Great choice! ${programName} perfect hai tere liye.\n\nPayment link: ${checkoutUrl}\n\nAur ye intake form bhi fill kar do: ${intakeUrl}`
        : `Great choice! ${programName} is perfect for you.\n\nPayment link: ${checkoutUrl}\n\nPlease also fill out this intake form: ${intakeUrl}`;

      if (await canSendToLead(phone)) {
        await sendTemplate(phone, 'program_qualified', [programName, checkoutUrl, intakeUrl]);
      }

      return res.status(200).json({ action: 'qualified', program });
    }

    return res.status(200).json({ action: 'reply_logged' });

  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
