const { getSupabase } = require('./_lib/supabase');
const { sendTemplate, logMessage, checkRateLimit } = require('./_lib/whatsapp');
const { detectMarket, isHinglish, detectProgram, needsEscalation, isOptOut, maskPhone, PROGRAM_NAMES, corsHeaders } = require('./_lib/helpers');
const { escalate } = require('./_lib/escalation');

module.exports = async function handler(req, res) {
  corsHeaders(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const body = req.body || {};
    const phone = body.phone || body.senderPhone || body.from || '';
    const message = body.message || body.text || body.body || '';
    const senderName = body.senderName || body.name || '';

    if (!phone) return res.status(400).json({ error: 'missing phone' });

    const supabase = getSupabase();

    await logMessage(phone, 'in', message, null);

    if (isOptOut(message)) {
      await supabase
        .from('leads')
        .update({ status: 'dropped', last_msg_at: new Date().toISOString() })
        .eq('phone', phone);
      console.log(`[OPT-OUT] ${maskPhone(phone)}`);
      return res.status(200).json({ action: 'opted_out' });
    }

    const escalationKeyword = needsEscalation(message);
    if (escalationKeyword) {
      const { data: client } = await supabase
        .from('clients')
        .select('id')
        .eq('phone', phone)
        .eq('status', 'active')
        .limit(1)
        .single();

      await escalate(phone, escalationKeyword, message, client?.id);
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    const market = detectMarket(phone);

    if (!existingLead) {
      const { data: lead } = await supabase
        .from('leads')
        .insert({
          phone,
          name: senderName,
          source: 'whatsapp',
          status: 'new',
          first_msg: message,
          last_msg_at: new Date().toISOString(),
          market,
        })
        .select()
        .single();

      const welcomeParams = isHinglish(market)
        ? ['Hi! Maddy\'s team here. Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?']
        : ['Hi! Welcome to Fitness by Maddy. What\'s your goal — fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?'];

      await sendTemplate(phone, 'welcome_v1', welcomeParams);

      return res.status(200).json({ action: 'new_lead', lead_id: lead.id });
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'ignored_dropped' });
    }

    await supabase
      .from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('id', existingLead.id);

    if (existingLead.status === 'new' || existingLead.status === 'qualified') {
      const program = detectProgram(message);
      if (program) {
        await supabase
          .from('leads')
          .update({ status: 'qualified', program_interest: program })
          .eq('id', existingLead.id);

        const canSend = await checkRateLimit(phone);
        if (canSend) {
          const programName = PROGRAM_NAMES[program] || program;
          const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${existingLead.id}`;
          const intakeUrl = `https://fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;

          const replyParams = isHinglish(market)
            ? [programName, checkoutUrl, intakeUrl]
            : [programName, checkoutUrl, intakeUrl];

          await sendTemplate(phone, 'program_offer', replyParams);
        }

        return res.status(200).json({ action: 'qualified', program });
      }
    }

    return res.status(200).json({ action: 'message_logged' });
  } catch (err) {
    console.error('[WEBHOOK ERROR]', err.message);
    return res.status(500).json({ error: 'internal_error' });
  }
};
