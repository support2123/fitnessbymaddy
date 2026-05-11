import supabase from '../lib/supabase.js';
import { sendTemplate, sendText } from '../lib/whatsapp.js';
import { detectMarket, isHinglishMarket, maskPhone } from '../lib/market.js';
import { needsEscalation, isOptOut, escalateToMaddy, detectProgram, PROGRAM_INFO } from '../lib/escalation.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const payload = req.body;
    const phone = payload.from || payload.waId || payload.senderNumber;
    const text = payload.text || payload.message?.text || payload.body || '';
    const msgType = payload.type || 'text';

    if (!phone) return res.status(400).json({ error: 'Missing phone number' });

    console.log(`Incoming from ${maskPhone(phone)}: ${msgType}`);

    await supabase.from('messages').insert({
      phone,
      direction: 'in',
      body: text.slice(0, 2000),
    });

    if (isOptOut(text)) {
      await supabase
        .from('leads')
        .update({ status: 'dropped', last_msg_at: new Date().toISOString() })
        .eq('phone', phone);
      console.log(`Opt-out: ${maskPhone(phone)}`);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(text)) {
      await escalateToMaddy(phone, 'keyword_trigger', text);
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    const { data: existingClient } = await supabase
      .from('clients')
      .select('*')
      .eq('phone', phone)
      .eq('status', 'active')
      .single();

    // Active client — route to support, don't re-qualify
    if (existingClient) {
      if (needsEscalation(text)) {
        return res.status(200).json({ action: 'escalated_client' });
      }
      await sendText(phone, getClientReply(existingClient, text), true);
      return res.status(200).json({ action: 'client_reply' });
    }

    const market = detectMarket(phone);
    const hinglish = isHinglishMarket(market);

    // New lead — FLOW A
    if (!existingLead) {
      await supabase.from('leads').insert({
        phone,
        first_msg: text.slice(0, 500),
        market,
        status: 'new',
        last_msg_at: new Date().toISOString(),
      });

      await sendTemplate(phone, 'welcome_v1', []);
      return res.status(200).json({ action: 'new_lead_welcomed' });
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'lead_dropped_ignored' });
    }

    await supabase
      .from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('id', existingLead.id);

    // FLOW B — Qualification
    const program = detectProgram(text);
    if (program) {
      const info = PROGRAM_INFO[program];
      await supabase
        .from('leads')
        .update({ status: 'qualified', program_interest: program })
        .eq('id', existingLead.id);

      const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${info.checkout}`;
      const intakeUrl = `https://www.fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;

      const msg = hinglish
        ? `${info.name} — bilkul sahi choice! 💪\n\nPrice: $${info.price}\n\n👉 Checkout: ${checkoutUrl}\n📋 Intake Form: ${intakeUrl}\n\nPayment ke baad hum turant start karenge!`
        : `Great choice — ${info.name}! 💪\n\nPrice: $${info.price}\n\n👉 Checkout: ${checkoutUrl}\n📋 Intake Form: ${intakeUrl}\n\nWe'll get started right after payment!`;

      await sendText(phone, msg);
      return res.status(200).json({ action: 'qualified', program });
    }

    // Unrecognized reply — gentle re-prompt
    const rePrompt = hinglish
      ? 'Koi baat nahi! Batao — fat loss chahiye, PCOS help, 40+ fitness, ya pehle trial try karna hai?'
      : 'No worries! Tell me — are you looking for fat loss, PCOS support, 40+ fitness, or want to try a trial first?';
    await sendText(phone, rePrompt);

    return res.status(200).json({ action: 're_prompted' });
  } catch (err) {
    console.error('Webhook error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

function getClientReply(client, text) {
  const lower = text.toLowerCase();
  if (lower.includes('check') || lower.includes('form')) {
    return `Here's your check-in form: https://www.fitnessbymaddy.com/checkin.html?c=${client.id}`;
  }
  if (lower.includes('program') || lower.includes('plan') || lower.includes('pdf')) {
    return `Your latest program is in your client folder. Need me to resend it?`;
  }
  return `Got your message! Maddy's team will get back to you within 24 hours. For urgent concerns, reply "URGENT".`;
}
