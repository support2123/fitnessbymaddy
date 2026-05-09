const { getSupabase } = require('./lib/supabase');
const { sendWhatsApp, sendTextMessage, maskPhone } = require('./lib/whatsapp');
const { detectMarket, detectProgram, needsEscalation, isOptOut, parseBody, corsHeaders, programCheckoutUrl, programDisplayName } = require('./lib/helpers');
const { escalateToMaddy } = require('./lib/escalate');

module.exports = async function handler(req, res) {
  corsHeaders(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = await parseBody(req);

    // AiSensy webhook format - extract message details
    const phone = body.phone || body.from || body.waId || '';
    const text = body.text || body.message || body.body || '';
    const name = body.name || body.pushName || '';

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    const db = getSupabase();

    // Log incoming message
    await db.from('messages').insert({
      phone,
      direction: 'in',
      body: text,
      template_name: null,
      sent_at: new Date().toISOString(),
      status: 'received'
    });

    // Check opt-out
    if (isOptOut(text)) {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      console.log(`Opt-out: ${maskPhone(phone)}`);
      return res.status(200).json({ action: 'opted_out' });
    }

    // Check escalation
    if (needsEscalation(text)) {
      await escalateToMaddy(
        'Sensitive keyword detected',
        `Phone: ${maskPhone(phone)}\nName: ${name}\nMessage: ${text}`
      );
      return res.status(200).json({ action: 'escalated' });
    }

    // Check if existing lead
    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      // New lead — insert and send welcome
      const market = detectMarket(phone);
      const { data: newLead } = await db.from('leads').insert({
        phone,
        name: name || null,
        source: 'whatsapp',
        status: 'new',
        first_msg: text,
        last_msg_at: new Date().toISOString(),
        program_interest: null,
        market,
        created_at: new Date().toISOString()
      }).select().single();

      // Send welcome based on market
      if (market === 'IN') {
        await sendWhatsApp(phone, 'welcome_v1', [name || 'there'], false);
      } else {
        await sendWhatsApp(phone, 'welcome_v1_en', [name || 'there'], false);
      }

      // Schedule nudge (2hr) — handled by checking last_msg_at in nudge cron
      return res.status(200).json({ action: 'new_lead', id: newLead?.id });
    }

    // Existing lead — check if dropped, don't re-engage
    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'ignored_dropped' });
    }

    // Update last message timestamp
    await db.from('leads')
      .update({ last_msg_at: new Date().toISOString(), name: name || existingLead.name })
      .eq('id', existingLead.id);

    // Try to detect program interest from reply
    const program = detectProgram(text);
    if (program) {
      await db.from('leads')
        .update({ program_interest: program, status: 'qualified' })
        .eq('id', existingLead.id);

      const checkoutUrl = programCheckoutUrl(program);
      const displayName = programDisplayName(program);
      const market = existingLead.market || detectMarket(phone);

      // Send program recommendation + checkout link
      if (market === 'IN') {
        await sendWhatsApp(phone, 'program_recommend', [
          name || 'there',
          displayName,
          checkoutUrl
        ], false);
      } else {
        await sendWhatsApp(phone, 'program_recommend_en', [
          name || 'there',
          displayName,
          checkoutUrl
        ], false);
      }

      // Also send intake form link
      const intakeUrl = `https://www.fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;
      await sendTextMessage(phone,
        `Also, please fill out this quick intake form so we can prepare your program: ${intakeUrl}`,
        false
      );

      return res.status(200).json({ action: 'qualified', program });
    }

    // Generic reply — acknowledge
    return res.status(200).json({ action: 'received' });

  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
