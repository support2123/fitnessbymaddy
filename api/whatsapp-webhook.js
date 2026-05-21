const { getSupabase } = require('./lib/supabase');
const { sendTemplate, sendText, maskPhone, detectMarket } = require('./lib/whatsapp');
const { needsEscalation, createEscalation } = require('./lib/escalation');
const { qualifyLead, getCheckoutUrl } = require('./lib/qualify');
const { canSendTo } = require('./lib/rate-limit');

const STOP_WORDS = ['stop', 'unsubscribe', 'opt out', 'optout', 'cancel'];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const payload = req.body;
    const phone = payload.phone || payload.waId || payload.from;
    const messageBody = payload.text || payload.message || payload.body || '';
    const name = payload.name || payload.pushName || '';

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    const db = getSupabase();

    await db.from('messages').insert({
      phone,
      direction: 'in',
      body: messageBody
    });

    if (STOP_WORDS.some(w => messageBody.toLowerCase().includes(w))) {
      await db.from('leads').update({ status: 'dropped', opted_out: true })
        .eq('phone', phone);
      return res.json({ action: 'opted_out' });
    }

    const escalationReason = needsEscalation(messageBody);
    if (escalationReason) {
      await createEscalation(phone, escalationReason, messageBody);
    }

    const { data: existingClient } = await db
      .from('clients')
      .select('id, status')
      .eq('phone', phone)
      .eq('status', 'active')
      .limit(1)
      .single();

    if (existingClient) {
      return res.json({ action: 'active_client', client_id: existingClient.id });
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .limit(1)
      .single();

    if (existingLead) {
      await db.from('leads').update({ last_msg_at: new Date().toISOString() })
        .eq('id', existingLead.id);

      if (existingLead.status === 'dropped' && existingLead.opted_out) {
        return res.json({ action: 'opted_out_lead' });
      }

      if (existingLead.status === 'new' || existingLead.status === 'qualified') {
        const match = qualifyLead(messageBody);
        if (match) {
          await db.from('leads').update({
            status: 'qualified',
            program_interest: match.program
          }).eq('id', existingLead.id);

          const market = detectMarket(phone);
          const checkoutUrl = getCheckoutUrl(match.program);
          const intakeUrl = `https://fitnessbymaddy.com/intake?lead=${existingLead.id}`;

          if (await canSendTo(phone)) {
            if (market === 'IN') {
              await sendText(phone,
                `Great choice! ${match.label} is perfect for your goal.\n\n` +
                `Yeh raha payment link: ${checkoutUrl}\n\n` +
                `Aur yeh intake form bhi fill kar do taki Maddy ke paas tumhari details aa jayein: ${intakeUrl}\n\n` +
                `Koi sawaal ho toh poochho!`
              );
            } else {
              await sendText(phone,
                `Great choice! ${match.label} is perfect for your goal.\n\n` +
                `Here's your checkout link: ${checkoutUrl}\n\n` +
                `Please also fill out this quick intake form so Maddy has your details: ${intakeUrl}\n\n` +
                `Any questions? Just ask!`
              );
            }
          }

          return res.json({ action: 'qualified', program: match.program });
        }
      }

      return res.json({ action: 'existing_lead', lead_id: existingLead.id });
    }

    const market = detectMarket(phone);
    const { data: newLead } = await db.from('leads').insert({
      phone,
      name,
      source: 'whatsapp',
      status: 'new',
      first_msg: messageBody,
      market
    }).select().single();

    if (await canSendTo(phone)) {
      if (market === 'IN') {
        await sendTemplate(phone, 'welcome_v1', {
          name: name || 'there',
          templateParams: [name || 'there']
        });
      } else {
        await sendText(phone,
          `Hi ${name || 'there'}! Welcome to Fitness by Maddy.\n\n` +
          `What's your main goal — fat loss, muscle building, PCOS management, 40+ fitness, or would you like to try a trial session first?\n\n` +
          `Let us know and we'll match you with the perfect program!`
        );
      }
    }

    return res.json({ action: 'new_lead', lead_id: newLead?.id });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
