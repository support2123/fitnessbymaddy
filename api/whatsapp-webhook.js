import supabase from '../lib/supabase.js';
import { sendTemplate, sendText, canSendMessage } from '../lib/whatsapp.js';
import { detectMarket, getWelcomeMessage, getNudgeMessage } from '../lib/market.js';
import { checkEscalation, isOptOut, handleEscalation, detectProgram } from '../lib/escalation.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const payload = req.body;
    const phone = payload.mobile || payload.from || payload.sender?.phone;
    const messageText = payload.text || payload.message?.text || payload.body || '';
    const name = payload.name || payload.sender?.name || null;

    if (!phone) return res.status(400).json({ error: 'Missing phone number' });

    await supabase.from('messages').insert({
      phone,
      direction: 'in',
      body: messageText
    });

    if (isOptOut(messageText)) {
      await supabase
        .from('leads')
        .update({ status: 'dropped', last_msg_at: new Date().toISOString() })
        .eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    const escalationTriggers = checkEscalation(messageText);
    if (escalationTriggers) {
      await handleEscalation(phone, messageText, escalationTriggers);
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      const market = detectMarket(phone);
      const { data: lead } = await supabase
        .from('leads')
        .insert({
          phone,
          name,
          source: 'whatsapp',
          status: 'new',
          first_msg: messageText,
          last_msg_at: new Date().toISOString(),
          market
        })
        .select()
        .single();

      const welcome = getWelcomeMessage(market);
      await sendTemplate(phone, 'welcome_v1', [name || 'there']);

      return res.status(200).json({ action: 'new_lead', lead_id: lead.id });
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'ignored_dropped' });
    }

    await supabase
      .from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('id', existingLead.id);

    if (existingLead.status === 'new') {
      const programMatch = detectProgram(messageText);

      if (programMatch) {
        await supabase
          .from('leads')
          .update({
            status: 'qualified',
            program_interest: programMatch.program
          })
          .eq('id', existingLead.id);

        const market = existingLead.market;
        const isIN = market === 'IN';
        const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${existingLead.id}`;
        const intakeUrl = `https://fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;

        const msg = isIN
          ? `Great choice! ${programMatch.name} — $${programMatch.price}\n\nCheckout: ${checkoutUrl}\n\nSaath mein ye intake form bhi fill karo:\n${intakeUrl}`
          : `Great choice! ${programMatch.name} — $${programMatch.price}\n\nCheckout: ${checkoutUrl}\n\nAlso fill out this intake form:\n${intakeUrl}`;

        await sendText(phone, msg);

        return res.status(200).json({
          action: 'qualified',
          program: programMatch.program
        });
      }

      if (canSendMessage(existingLead.last_msg_at)) {
        const isIN = existingLead.market === 'IN';
        const followUp = isIN
          ? "Koi baat nahi! Bata do kya goal hai — fat loss, PCOS, strength, 40+ fitness, ya trial try karna hai?"
          : "No worries! Let me know your goal — fat loss, PCOS management, strength, 40+ fitness, or would you like a trial?";
        await sendText(phone, followUp);
      }

      return res.status(200).json({ action: 'follow_up_sent' });
    }

    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('phone', phone)
      .eq('status', 'active')
      .single();

    if (client && escalationTriggers) {
      return res.status(200).json({ action: 'escalated_to_maddy' });
    }

    return res.status(200).json({ action: 'received' });

  } catch (err) {
    console.error('Webhook error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
}
