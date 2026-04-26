const { supabase } = require('../lib/supabase');
const { sendTemplate, sendText, notifyMaddy, canSendToLead } = require('../lib/whatsapp');
const { detectMarket, isHinglishMarket } = require('../lib/market');
const { KEYWORD_TO_PROGRAM, ESCALATION_KEYWORDS, STOP_KEYWORDS, PROGRAMS, maskPhone } = require('../lib/constants');

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const payload = req.body;
    const phone = normalizePhone(payload.from || payload.senderPhone || payload.waId);
    const text = (payload.text || payload.body || payload.message || '').trim();
    const msgType = payload.type || 'text';

    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    await supabase.from('messages').insert({
      phone,
      direction: 'in',
      body: text,
      status: 'received',
    });

    if (STOP_KEYWORDS.some(kw => text.toLowerCase().includes(kw))) {
      await supabase.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      console.log(`[STOP] ${maskPhone(phone)} opted out`);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (ESCALATION_KEYWORDS.some(kw => text.toLowerCase().includes(kw))) {
      await notifyMaddy(`Lead ${maskPhone(phone)} said: "${text.slice(0, 200)}"`);
    }

    const { data: existingClient } = await supabase
      .from('clients')
      .select('id, status')
      .eq('phone', phone)
      .eq('status', 'active')
      .limit(1)
      .maybeSingle();

    if (existingClient) {
      return res.status(200).json({ action: 'active_client_message_logged' });
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('id, status, created_at')
      .eq('phone', phone)
      .maybeSingle();

    if (existingLead) {
      await supabase.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('id', existingLead.id);

      if (existingLead.status === 'dropped') {
        return res.status(200).json({ action: 'dropped_lead_ignored' });
      }

      if (existingLead.status === 'new' || existingLead.status === 'qualified') {
        await handleQualification(phone, text, existingLead);
        return res.status(200).json({ action: 'qualification_attempted' });
      }

      return res.status(200).json({ action: 'existing_lead_updated' });
    }

    const market = detectMarket(phone);
    const { data: lead } = await supabase.from('leads').insert({
      phone,
      source: 'whatsapp',
      status: 'new',
      first_msg: text,
      last_msg_at: new Date().toISOString(),
      market,
    }).select().single();

    const hinglish = isHinglishMarket(market);
    if (hinglish) {
      await sendTemplate(phone, 'welcome_v1', []);
    } else {
      await sendTemplate(phone, 'welcome_v1_en', []);
    }

    if (text) {
      await handleQualification(phone, text, lead);
    }

    return res.status(200).json({ action: 'new_lead_created', lead_id: lead.id });
  } catch (err) {
    console.error('[WA Webhook Error]', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function handleQualification(phone, text, lead) {
  const lower = text.toLowerCase();

  for (const route of KEYWORD_TO_PROGRAM) {
    if (route.keywords.some(kw => lower.includes(kw))) {
      const program = route.program;
      const programInfo = PROGRAMS[program];

      await supabase.from('leads').update({
        status: 'qualified',
        program_interest: program,
      }).eq('id', lead.id);

      const canSend = await canSendToLead(phone);
      if (!canSend) return;

      const market = detectMarket(phone);
      if (isHinglishMarket(market)) {
        await sendText(phone,
          `${programInfo.name} — bilkul sahi choice! Price: $${programInfo.price}\n\n` +
          `Checkout: https://fitnessbymaddyy.exlyapp.com/checkout/${lead.id}\n\n` +
          `Abhi ye intake form bhar do taaki hum aapka program start kar sakein:\n` +
          `https://www.fitnessbymaddy.com/intake?lead=${lead.id}`
        );
      } else {
        await sendText(phone,
          `Great choice! ${programInfo.name} — $${programInfo.price}\n\n` +
          `Checkout here: https://fitnessbymaddyy.exlyapp.com/checkout/${lead.id}\n\n` +
          `Please fill out your intake form so we can personalise your program:\n` +
          `https://www.fitnessbymaddy.com/intake?lead=${lead.id}`
        );
      }
      return;
    }
  }
}

function normalizePhone(raw) {
  if (!raw) return null;
  let phone = raw.replace(/[\s\-\(\)]/g, '');
  if (!phone.startsWith('+')) phone = '+' + phone;
  return phone;
}
