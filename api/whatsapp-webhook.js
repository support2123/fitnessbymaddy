const { supabase } = require('./lib/supabase');
const { sendTemplate, sendText } = require('./lib/whatsapp');
const { detectMarket } = require('./lib/market');
const { needsEscalation, escalateToMaddy } = require('./lib/escalation');
const { qualifyLead } = require('./lib/qualify');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { phone, message, name } = parseWebhookPayload(req.body);
    if (!phone || !message) return res.status(400).json({ error: 'Missing phone or message' });

    // Check opt-out
    if (isOptOut(message)) {
      await supabase.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      await supabase.from('messages').insert({ phone, direction: 'in', body: message });
      return res.status(200).json({ action: 'opted_out' });
    }

    // Log incoming message
    await supabase.from('messages').insert({ phone, direction: 'in', body: message });

    // Check escalation
    if (needsEscalation(message)) {
      await escalateToMaddy('Keyword trigger', phone, message);
      return res.status(200).json({ action: 'escalated' });
    }

    // Check if existing lead
    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (existingLead) {
      // Update last message
      await supabase.from('leads')
        .update({ last_msg_at: new Date().toISOString(), first_msg: existingLead.first_msg || message })
        .eq('id', existingLead.id);

      // If lead is new/qualified, try to qualify further
      if (existingLead.status === 'new' || existingLead.status === 'qualified') {
        const match = qualifyLead(message);
        if (match) {
          await supabase.from('leads')
            .update({ status: 'qualified', program_interest: match.program })
            .eq('id', existingLead.id);

          const market = detectMarket(phone);
          const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${existingLead.id}`;
          const intakeUrl = `https://fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;

          if (market === 'IN') {
            await sendText(phone,
              `Perfect! ${match.name} tumhare liye best rahega 💪\n\n` +
              `Price: $${match.price} (one-time)\n\n` +
              `Checkout: ${checkoutUrl}\n\n` +
              `Pehle ye form fill karo so I can customize for you:\n${intakeUrl}`
            );
          } else {
            await sendText(phone,
              `Great choice! ${match.name} is perfect for your goals 💪\n\n` +
              `Price: $${match.price} (one-time)\n\n` +
              `Checkout: ${checkoutUrl}\n\n` +
              `Please fill this form first so I can customize your plan:\n${intakeUrl}`
            );
          }
          return res.status(200).json({ action: 'qualified', program: match.program });
        }
      }

      return res.status(200).json({ action: 'updated' });
    }

    // New lead — insert and auto-greet
    const market = detectMarket(phone);
    const { data: newLead } = await supabase.from('leads').insert({
      phone,
      name: name || null,
      source: 'whatsapp',
      status: 'new',
      first_msg: message,
      last_msg_at: new Date().toISOString(),
      market
    }).select().single();

    // Send welcome template
    await sendTemplate(phone, 'welcome_v1', [name || 'there']);

    // Schedule nudge (2hr) — handled by checking last_msg_at in cron
    return res.status(200).json({ action: 'new_lead', id: newLead.id });

  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function parseWebhookPayload(body) {
  // AiSensy webhook format
  if (body.phone && body.text) {
    return { phone: body.phone, message: body.text, name: body.name || null };
  }
  // Meta Cloud API format
  if (body.entry && body.entry[0]) {
    const change = body.entry[0].changes?.[0]?.value;
    if (change?.messages?.[0]) {
      const msg = change.messages[0];
      const contact = change.contacts?.[0];
      return {
        phone: msg.from,
        message: msg.text?.body || '',
        name: contact?.profile?.name || null
      };
    }
  }
  return { phone: body.phone, message: body.message || body.text, name: body.name };
}

function isOptOut(message) {
  const lower = (message || '').toLowerCase().trim();
  return ['stop', 'unsubscribe', 'opt out', 'optout'].includes(lower);
}
