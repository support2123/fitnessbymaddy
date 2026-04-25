import { getSupabase } from './_lib/supabase.js';
import { sendTemplate, maskPhone } from './_lib/whatsapp.js';
import { detectMarket, detectProgram, needsEscalation, isOptOut, normalizePhone, getCheckoutLink, programDisplayName } from './_lib/utils.js';
import { escalateToMaddy } from './_lib/escalate.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const db = getSupabase();

  try {
    const payload = req.body;
    const phone = normalizePhone(payload.mobile || payload.phone || payload.from || '');
    const message = (payload.message || payload.text || payload.body || '').trim();
    const senderName = payload.name || payload.sender_name || '';

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    await db.from('messages').insert({
      phone,
      direction: 'in',
      body: message,
      template_name: null,
      status: 'received'
    });

    if (isOptOut(message)) {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      await db.from('clients').update({ status: 'paused' }).eq('phone', phone);
      console.log(`Opt-out: ${maskPhone(phone)}`);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(message)) {
      await escalateToMaddy('Medical/Sensitive keyword detected', {
        phone,
        clientName: senderName,
        message
      });
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    const { data: existingClient } = await db
      .from('clients')
      .select('*')
      .eq('phone', phone)
      .eq('status', 'active')
      .limit(1)
      .single();

    if (existingClient) {
      await db.from('messages').insert({
        phone,
        direction: 'in',
        body: `[Client reply — routed to support] ${message.slice(0, 500)}`,
        status: 'logged'
      });
      return res.status(200).json({ action: 'client_reply_logged' });
    }

    if (!existingLead) {
      const market = detectMarket(phone);
      const { data: lead } = await db.from('leads').insert({
        phone,
        name: senderName || null,
        source: 'whatsapp',
        status: 'new',
        first_msg: message,
        market
      }).select().single();

      const welcomeParams = market === 'IN'
        ? ['Hi! Maddy ki team yahan 👋 Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?']
        : ['Hi! Maddy\'s team here 👋 What\'s your goal — fat loss, PCOS, strength, or 40+ fitness? Or try a trial first?'];

      await sendTemplate(phone, 'welcome_v1', welcomeParams);

      await db.from('messages').insert({
        phone,
        direction: 'out',
        body: welcomeParams[0],
        template_name: 'welcome_v1',
        status: 'sent'
      });

      return res.status(200).json({ action: 'new_lead', lead_id: lead?.id });
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'lead_dropped_ignored' });
    }

    const program = detectProgram(message);
    if (program) {
      await db.from('leads').update({
        status: 'qualified',
        program_interest: program,
        last_msg_at: new Date().toISOString()
      }).eq('id', existingLead.id);

      const checkoutLink = getCheckoutLink(program);
      const displayName = programDisplayName(program);
      const market = existingLead.market || 'GLOBAL';

      const replyMsg = market === 'IN'
        ? `Great choice! 🔥 ${displayName} aapke liye perfect hai.\n\nCheckout: ${checkoutLink}\n\nIntake form bhi fill karo: https://www.fitnessbymaddy.com/intake?lead=${existingLead.id}`
        : `Great choice! 🔥 ${displayName} is perfect for you.\n\nCheckout: ${checkoutLink}\n\nAlso fill the intake form: https://www.fitnessbymaddy.com/intake?lead=${existingLead.id}`;

      await sendTemplate(phone, 'program_recommendation', [displayName, checkoutLink]);

      await db.from('messages').insert({
        phone,
        direction: 'out',
        body: replyMsg,
        template_name: 'program_recommendation',
        status: 'sent'
      });

      return res.status(200).json({ action: 'qualified', program });
    }

    await db.from('leads').update({
      last_msg_at: new Date().toISOString()
    }).eq('id', existingLead.id);

    return res.status(200).json({ action: 'reply_logged' });

  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
}
