import supabase from './lib/supabase.js';
import { sendTemplate, sendSessionMessage, sendToMaddy, logMessage } from './lib/whatsapp.js';
import { detectMarket, detectProgram, needsEscalation, isOptOut, maskPhone, isHinglish, PROGRAM_INFO } from './lib/utils.js';

function parseWebhook(body) {
  // AiSensy / Meta Cloud API format
  if (body.entry) {
    const change = body.entry?.[0]?.changes?.[0]?.value;
    if (!change?.messages?.[0]) return null;
    const msg = change.messages[0];
    const contact = change.contacts?.[0];
    return {
      phone: msg.from,
      text: msg.text?.body || msg.button?.text || '',
      name: contact?.profile?.name || null,
      type: msg.type,
      messageId: msg.id,
    };
  }
  // Flat format fallback
  if (body.from && (body.text || body.message)) {
    return {
      phone: body.from,
      text: body.text || body.message,
      name: body.name || body.userName || null,
      type: 'text',
      messageId: body.messageId || null,
    };
  }
  return null;
}

export default async function handler(req, res) {
  // Meta webhook verification (GET)
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && token === process.env.WA_VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }
    return res.status(403).json({ error: 'Forbidden' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const parsed = parseWebhook(req.body);
    if (!parsed) return res.status(200).json({ ok: true, skipped: true });

    const { phone, text, name } = parsed;
    if (!phone || !text) return res.status(200).json({ ok: true, skipped: true });

    await logMessage(phone, 'in', text, null, 'received');

    // Opt-out check
    if (isOptOut(text)) {
      await supabase.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      await supabase.from('clients').update({ status: 'paused' }).eq('phone', phone);
      return res.status(200).json({ ok: true, action: 'opted_out' });
    }

    // Escalation check
    if (needsEscalation(text)) {
      const { data: lead } = await supabase.from('leads').select('id').eq('phone', phone).single();
      const { data: client } = await supabase.from('clients').select('id').eq('phone', phone).single();
      await supabase.from('escalations').insert({
        phone,
        lead_id: lead?.id || null,
        client_id: client?.id || null,
        trigger: 'keyword',
        message: text,
      });
      await sendToMaddy(
        `🚨 ESCALATION\nFrom: ${maskPhone(phone)}\nMessage: "${text.slice(0, 200)}"\nNeeds your review.`
      );
      return res.status(200).json({ ok: true, action: 'escalated' });
    }

    // Check if existing lead
    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    const market = detectMarket(phone);

    if (!existingLead) {
      // FLOW A: New lead
      const { data: newLead } = await supabase.from('leads').insert({
        phone,
        name: name || null,
        source: 'whatsapp',
        status: 'new',
        first_msg: text,
        last_msg_at: new Date().toISOString(),
        market,
      }).select().single();

      const greeting = isHinglish(market)
        ? `Hi${name ? ' ' + name : ''}! Maddy's team here 👋 Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?`
        : `Hi${name ? ' ' + name : ''}! Maddy's team here 👋 What's your goal — fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?`;

      await sendTemplate(phone, 'welcome_v1', [name || 'there'], name);

      return res.status(200).json({ ok: true, action: 'new_lead', leadId: newLead?.id });
    }

    // Update last message time
    await supabase.from('leads')
      .update({ last_msg_at: new Date().toISOString(), name: name || existingLead.name })
      .eq('id', existingLead.id);

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ ok: true, action: 'lead_dropped_no_reply' });
    }

    // FLOW B: Lead qualification
    const program = detectProgram(text);
    if (program) {
      await supabase.from('leads')
        .update({ status: 'qualified', program_interest: program })
        .eq('id', existingLead.id);

      const info = PROGRAM_INFO[program];
      const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${existingLead.id}`;
      const intakeUrl = `https://fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;

      const msg = isHinglish(market)
        ? `Perfect! ${info.name} tumhare liye best rahega 💪\n\nPrice: $${info.price}\n\n📋 Pehle yeh form fill karo: ${intakeUrl}\n\n💳 Payment link: ${checkoutUrl}\n\nKoi question ho toh poochho!`
        : `Perfect! ${info.name} sounds right for you 💪\n\nPrice: $${info.price}\n\n📋 Please fill this intake form: ${intakeUrl}\n\n💳 Checkout here: ${checkoutUrl}\n\nAny questions? Just ask!`;

      await sendSessionMessage(phone, msg);

      return res.status(200).json({ ok: true, action: 'qualified', program });
    }

    // General reply — acknowledge and keep conversation warm
    const reply = isHinglish(market)
      ? 'Got it! Maddy ki team check karegi aur jaldi reply karegi. Koi specific program mein interest hai toh batao — fat loss, PCOS, 40+, ya custom 12-week?'
      : 'Got it! Our team will review and get back to you soon. Interested in a specific program? Just say — fat loss, PCOS, 40+, or custom 12-week!';

    await sendSessionMessage(phone, reply);

    return res.status(200).json({ ok: true, action: 'general_reply' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(200).json({ ok: false, error: 'internal' });
  }
}
