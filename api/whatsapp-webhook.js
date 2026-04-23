const { getSupabase } = require('./_lib/supabase');
const { sendWhatsApp, logInboundMessage } = require('./_lib/whatsapp');
const { detectMarket, detectProgram, needsEscalation, isOptOut, corsHeaders, parseBody, PROGRAM_NAMES } = require('./_lib/utils');
const { escalate } = require('./_lib/escalate');

module.exports = async function handler(req, res) {
  corsHeaders(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const body = await parseBody(req);
  const phone = body.phone || body.from || body.sender || body.mobile;
  const text = body.message || body.text || body.body || '';

  if (!phone) return res.status(400).json({ error: 'Missing phone' });

  const db = getSupabase();

  await logInboundMessage(phone, text);

  if (isOptOut(text)) {
    await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
    return res.status(200).json({ action: 'opted_out' });
  }

  if (needsEscalation(text)) {
    const client = await db.from('clients').select('id').eq('phone', phone).single();
    await escalate(phone, 'keyword_trigger', text, client.data?.id);
  }

  const existingLead = await db.from('leads').select('*').eq('phone', phone).single();

  if (!existingLead.data) {
    const market = detectMarket(phone);
    const { data: lead } = await db.from('leads').insert({
      phone,
      name: body.name || null,
      source: 'whatsapp',
      status: 'new',
      first_msg: text,
      last_msg_at: new Date().toISOString(),
      market
    }).select().single();

    const welcome = market === 'IN'
      ? "Hi! Maddy's team here \u{1F44B} Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?"
      : "Hi! Maddy's team here \u{1F44B} What's your goal — fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?";

    await sendWhatsApp(phone, welcome, 'welcome_v1');

    return res.status(200).json({ action: 'new_lead', lead_id: lead?.id });
  }

  await db.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('phone', phone);

  if (existingLead.data.status === 'new') {
    const program = detectProgram(text);
    if (program) {
      await db.from('leads').update({
        status: 'qualified',
        program_interest: program
      }).eq('phone', phone);

      const programName = PROGRAM_NAMES[program] || program;
      const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${existingLead.data.id}`;
      const intakeUrl = `https://www.fitnessbymaddy.com/intake.html?lead=${existingLead.data.id}`;

      const market = existingLead.data.market;
      const reply = market === 'IN'
        ? `Great choice! \u{1F4AA} ${programName} aapke liye perfect hai.\n\nCheckout: ${checkoutUrl}\n\nPehle ye quick form bhar do: ${intakeUrl}`
        : `Great choice! \u{1F4AA} The ${programName} is perfect for you.\n\nCheckout: ${checkoutUrl}\n\nPlease fill this quick form first: ${intakeUrl}`;

      await sendWhatsApp(phone, reply, 'program_recommendation');

      return res.status(200).json({ action: 'qualified', program });
    }

    const market = existingLead.data.market;
    const nudge = market === 'IN'
      ? "Koi baat nahi! Agar confused ho toh $20 trial session try karo — Maddy ke saath live Zoom call.\n\nhttps://www.fitnessbymaddy.com/intake.html?program=zoom_trial"
      : "No worries! If you're unsure, try our $20 trial session — a live Zoom call with Maddy.\n\nhttps://www.fitnessbymaddy.com/intake.html?program=zoom_trial";

    await sendWhatsApp(phone, nudge, 'nudge_trial');
    return res.status(200).json({ action: 'nudge_sent' });
  }

  return res.status(200).json({ action: 'acknowledged' });
};
