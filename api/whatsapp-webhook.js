const { getSupabase } = require('./lib/supabase');
const { sendWhatsApp, sendTemplate } = require('./lib/whatsapp');
const { detectMarket, getLanguage } = require('./lib/market');
const { maskPhone } = require('./lib/mask-phone');
const { needsEscalation, escalateToMaddy } = require('./lib/escalation');
const { qualifyLead, getProgramName, getProgramPrice } = require('./lib/qualify');

const STOP_KEYWORDS = ['stop', 'unsubscribe', 'opt out', 'optout', 'cancel'];

const CHECKOUT_BASE = 'https://www.fitnessbymaddy.com/custom.html';
const INTAKE_FORM = 'https://www.fitnessbymaddy.com/intake';

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).json({});
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const db = getSupabase();

  try {
    const { phone, text, name } = parseIncoming(req.body);

    if (!phone || !text) {
      return res.status(400).json({ error: 'Missing phone or text' });
    }

    console.log(`Inbound from ${maskPhone(phone)}: ${text.slice(0, 80)}`);

    // 1. Log inbound message
    await db.from('messages').insert({
      phone,
      direction: 'in',
      body: text,
      status: 'received'
    });

    // 2. Check STOP / unsubscribe
    if (isStopMessage(text)) {
      console.log(`STOP received from ${maskPhone(phone)}, marking as dropped`);
      await db
        .from('leads')
        .update({ status: 'dropped', last_msg_at: new Date().toISOString() })
        .eq('phone', phone);
      return res.status(200).json({ ok: true, action: 'stopped' });
    }

    // 3. Check escalation keywords
    const esc = needsEscalation(text);
    if (esc.escalate) {
      console.log(`Escalation triggered (${esc.trigger}) for ${maskPhone(phone)}`);
      await escalateToMaddy(esc.trigger, { phone, name, message: text });
    }

    // 4. Look up lead
    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      // New lead
      const market = detectMarket(phone);
      const lang = getLanguage(market);

      const { data: newLead, error: insertErr } = await db
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
        .select()
        .single();

      if (insertErr) {
        console.error(`Failed to insert lead for ${maskPhone(phone)}:`, insertErr.message);
        return res.status(500).json({ error: 'Failed to create lead' });
      }

      // Send welcome message based on market
      const welcomeMsg = lang === 'hinglish'
        ? "Hi! Maddy's team here. Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?"
        : "Hi! Maddy's team here. What's your goal — fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial first?";

      await sendWhatsApp(phone, welcomeMsg, 'welcome_v1');

      console.log(`New lead created: ${maskPhone(phone)} (${market})`);
      return res.status(200).json({ ok: true, action: 'new_lead', market });
    }

    // Existing lead - update last_msg_at
    await db
      .from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('phone', phone);

    // If dropped, ignore silently
    if (existingLead.status === 'dropped') {
      console.log(`Dropped lead ${maskPhone(phone)} messaged, ignoring`);
      return res.status(200).json({ ok: true, action: 'ignored_dropped' });
    }

    // If status is new, try to qualify
    if (existingLead.status === 'new') {
      const qualification = qualifyLead(text);

      if (qualification) {
        const { program } = qualification;
        const programName = getProgramName(program);
        const price = getProgramPrice(program);

        await db
          .from('leads')
          .update({
            program_interest: program,
            status: 'qualified'
          })
          .eq('phone', phone);

        const checkoutLink = `${CHECKOUT_BASE}?program=${program}`;
        const qualifiedMsg =
          `Great choice! The ${programName} ($${price}) sounds perfect for you.\n\n` +
          `Checkout here: ${checkoutLink}\n\n` +
          `Please also fill out your intake form so we can personalise your plan: ${INTAKE_FORM}`;

        await sendWhatsApp(phone, qualifiedMsg, 'qualified_reply');

        console.log(`Lead ${maskPhone(phone)} qualified for ${program}`);
        return res.status(200).json({ ok: true, action: 'qualified', program });
      }

      // Could not match a program - send clarification
      const clarifyMsg =
        "Thanks for your reply! Could you let me know which goal fits you best?\n\n" +
        "1. Fat loss / weight loss\n" +
        "2. PCOS management\n" +
        "3. 40+ fitness\n" +
        "4. 12-week custom transformation\n" +
        "5. Zoom trial session\n\n" +
        "Just reply with the number or keyword!";

      await sendWhatsApp(phone, clarifyMsg, 'clarify_goal');

      console.log(`Clarification sent to ${maskPhone(phone)}`);
      return res.status(200).json({ ok: true, action: 'clarification_sent' });
    }

    // For qualified or converted leads, just acknowledge (no auto-reply needed)
    console.log(`Message from ${existingLead.status} lead ${maskPhone(phone)}, no auto-action`);
    return res.status(200).json({ ok: true, action: 'logged' });

  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

function parseIncoming(body) {
  if (!body) return {};
  return {
    phone: body.phone || body.from || body.mobile || '',
    text: body.text || body.message || body.body || '',
    name: body.name || body.pushName || body.push_name || ''
  };
}

function isStopMessage(text) {
  const lower = (text || '').toLowerCase().trim();
  return STOP_KEYWORDS.some(kw => lower === kw || lower.startsWith(kw));
}
