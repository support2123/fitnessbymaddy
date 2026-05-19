const { getSupabase } = require('./lib/supabase');
const { sendTemplate, sendText, logMessage } = require('./lib/whatsapp');
const { detectMarket, classifyIntent, programForIntent, isHinglish, maskPhone } = require('./lib/utils');
const { escalateToMaddy } = require('./lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const payload = req.body;
    const phone = payload.senderPhone || payload.waId || payload.from;
    const messageBody = payload.text || payload.message || payload.body || '';
    const senderName = payload.senderName || payload.pushName || null;

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    const db = getSupabase();
    const market = detectMarket(phone);

    await logMessage(phone, 'in', messageBody, null);

    const intent = classifyIntent(messageBody);

    if (intent === 'OPT_OUT') {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      console.log(`[opt-out] ${maskPhone(phone)}`);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (intent === 'ESCALATE') {
      const { data: lead } = await db.from('leads').select('*').eq('phone', phone).single();
      await escalateToMaddy('Keyword trigger in message', lead || { phone, name: senderName }, messageBody);
      return res.status(200).json({ action: 'escalated' });
    }

    const { data: existingLead } = await db.from('leads').select('*').eq('phone', phone).single();

    if (!existingLead) {
      const { data: newLead } = await db.from('leads').insert({
        phone,
        name: senderName,
        source: 'whatsapp',
        status: 'new',
        first_msg: messageBody,
        last_msg_at: new Date().toISOString(),
        market
      }).select().single();

      const welcomeMsg = isHinglish(market)
        ? 'Hi! Maddy\'s team here. Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?'
        : 'Hi! Welcome to Fitness by Maddy. What\'s your goal — fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?';

      await sendTemplate(phone, 'welcome_v1', [senderName || 'there']);

      console.log(`[new-lead] ${maskPhone(phone)} market=${market}`);
      return res.status(200).json({ action: 'new_lead', id: newLead?.id });
    }

    await db.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('phone', phone);

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'ignored_dropped' });
    }

    if (intent && existingLead.status === 'new') {
      const programInfo = programForIntent(intent);
      if (programInfo) {
        await db.from('leads').update({
          status: 'qualified',
          program_interest: programInfo.program
        }).eq('phone', phone);

        const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${existingLead.id}`;
        const intakeUrl = `https://www.fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;

        let replyMsg;
        if (isHinglish(market)) {
          replyMsg = `Great choice! ${programInfo.name} (₹${programInfo.price * 83}) tumhare liye perfect hai.\n\nStep 1: Yahan se enroll karo:\n${checkoutUrl}\n\nStep 2: Intake form fill karo:\n${intakeUrl}\n\nKoi doubt ho toh pooch lo!`;
        } else {
          replyMsg = `Great choice! The ${programInfo.name} ($${programInfo.price}) sounds perfect for you.\n\nStep 1: Enroll here:\n${checkoutUrl}\n\nStep 2: Fill your intake form:\n${intakeUrl}\n\nFeel free to ask any questions!`;
        }

        await sendText(phone, replyMsg, false);
        console.log(`[qualified] ${maskPhone(phone)} → ${programInfo.program}`);
        return res.status(200).json({ action: 'qualified', program: programInfo.program });
      }
    }

    return res.status(200).json({ action: 'received' });
  } catch (err) {
    console.error('[whatsapp-webhook] Error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
