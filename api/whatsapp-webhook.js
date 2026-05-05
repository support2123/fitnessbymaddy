const { supabase } = require('./_lib/supabase');
const { sendWhatsApp } = require('./_lib/whatsapp');
const { shouldEscalate, isOptOut, createEscalation, detectMarket } = require('./_lib/escalation');
const { maskPhone } = require('./_lib/mask-phone');

const PROGRAM_MAP = [
  { keys: ['fat loss', 'weight', 'shred', 'lose', 'slim', 'burn'], program: '6wk_gym', label: '6-Week Burn & Build', price: '$97' },
  { keys: ['pcos', 'hormonal', 'hormone', 'period', 'irregular'], program: 'pcos', label: 'PCOS Warrior', price: '$45' },
  { keys: ['40', 'menopause', 'joints', 'joint', 'senior'], program: '40plus', label: '40+ Strong', price: '$50' },
  { keys: ['custom', '12 week', 'serious', 'flagship', 'personali'], program: '12wk', label: '12-Week Flagship', price: '$200' },
  { keys: ['trial', 'zoom', 'not sure', 'try', 'test'], program: 'zoom_trial', label: 'Zoom Trial', price: '$20' },
];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { phone, message, name } = parsePayload(req.body);
    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    await supabase.from('messages').insert({
      phone, direction: 'in', body: message
    });

    if (isOptOut(message)) {
      await supabase.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.json({ action: 'opted_out' });
    }

    const { data: existingClient } = await supabase
      .from('clients')
      .select('id')
      .eq('phone', phone)
      .eq('status', 'active')
      .limit(1);

    if (existingClient && existingClient.length > 0) {
      if (shouldEscalate(message)) {
        await createEscalation({
          sourceType: 'client',
          sourceId: existingClient[0].id,
          phone,
          reason: 'Flagged keyword in client message',
          messageBody: message
        });
      }
      return res.json({ action: 'active_client_message_logged' });
    }

    const { data: existing } = await supabase
      .from('leads')
      .select('id, status')
      .eq('phone', phone)
      .limit(1);

    if (existing && existing.length > 0) {
      const lead = existing[0];

      if (lead.status === 'dropped') {
        return res.json({ action: 'dropped_lead_ignored' });
      }

      await supabase.from('leads').update({
        last_msg_at: new Date().toISOString()
      }).eq('id', lead.id);

      if (shouldEscalate(message)) {
        await createEscalation({
          sourceType: 'lead',
          sourceId: lead.id,
          phone,
          reason: 'Flagged keyword in lead message',
          messageBody: message
        });
        return res.json({ action: 'escalated' });
      }

      const matched = matchProgram(message);
      if (matched) {
        await supabase.from('leads').update({
          status: 'qualified',
          program_interest: matched.program
        }).eq('id', lead.id);

        const market = detectMarket(phone);
        const isHinglish = market === 'IN';

        const msg = isHinglish
          ? `Perfect! 🎯 Tumhare liye best rahega: *${matched.label}* (${matched.price})\n\nCheckout karo: https://fitnessbymaddyy.exlyapp.com/checkout/${matched.program}\n\nIntake form bhi fill karo taaki Maddy tumhara plan bana sake:\nhttps://fitnessbymaddy.com/intake?lead=${lead.id}`
          : `Perfect! 🎯 The best fit for you: *${matched.label}* (${matched.price})\n\nCheckout here: https://fitnessbymaddyy.exlyapp.com/checkout/${matched.program}\n\nAlso fill out your intake form so Maddy can build your plan:\nhttps://fitnessbymaddy.com/intake?lead=${lead.id}`;

        await sendWhatsApp({
          phone,
          templateName: 'program_recommendation',
          body: msg,
          params: [matched.label, matched.price, lead.id]
        });

        return res.json({ action: 'qualified', program: matched.program });
      }

      return res.json({ action: 'existing_lead_updated' });
    }

    // New lead
    const market = detectMarket(phone);
    const { data: newLead } = await supabase.from('leads').insert({
      phone,
      name: name || null,
      source: 'whatsapp',
      status: 'new',
      first_msg: message,
      last_msg_at: new Date().toISOString(),
      market
    }).select('id').single();

    if (shouldEscalate(message)) {
      await createEscalation({
        sourceType: 'lead',
        sourceId: newLead.id,
        phone,
        reason: 'Flagged keyword in first message',
        messageBody: message
      });
    }

    const isHinglish = market === 'IN';
    const welcomeBody = isHinglish
      ? "Hi! Maddy's team here 👋 Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?"
      : "Hi! Maddy's team here 👋 What's your goal — fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?";

    await sendWhatsApp({
      phone,
      templateName: 'welcome_v1',
      body: welcomeBody,
      params: [name || 'there']
    });

    return res.json({ action: 'new_lead', id: newLead.id });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function parsePayload(body) {
  // AiSensy webhook format
  if (body.phone) {
    return {
      phone: body.phone.replace(/\+/g, ''),
      message: body.message || body.text || '',
      name: body.name || body.pushName || null
    };
  }
  // Meta Cloud API format
  if (body.entry) {
    const change = body.entry?.[0]?.changes?.[0]?.value;
    const msg = change?.messages?.[0];
    const contact = change?.contacts?.[0];
    if (msg) {
      return {
        phone: msg.from,
        message: msg.text?.body || '',
        name: contact?.profile?.name || null
      };
    }
  }
  return { phone: null, message: '', name: null };
}

function matchProgram(message) {
  const lower = (message || '').toLowerCase();
  for (const entry of PROGRAM_MAP) {
    if (entry.keys.some(k => lower.includes(k))) return entry;
  }
  return null;
}
