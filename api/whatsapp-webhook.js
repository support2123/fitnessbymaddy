const { supabase } = require('./_lib/supabase');
const { sendWhatsApp } = require('./_lib/whatsapp');
const { detectMarket, isHinglishMarket } = require('./_lib/market');
const { needsEscalation, createEscalation } = require('./_lib/escalation');
const { maskPhone } = require('./_lib/mask');

const PROGRAM_ROUTES = [
  { keywords: ['fat loss', 'weight', 'shred', 'lose', 'slim', 'lean'], program: '6wk_gym', label: '6-Week Burn & Build' },
  { keywords: ['pcos', 'hormonal', 'hormone', 'pcod'], program: 'pcos', label: 'PCOS Warrior' },
  { keywords: ['40', 'menopause', 'joints', 'joint', 'senior', 'aging'], program: '40plus', label: '40+ Strong' },
  { keywords: ['custom', '12 week', '12-week', 'serious', 'flagship', 'personalised'], program: '12wk', label: '12-Week Flagship' },
  { keywords: ['trial', 'zoom', 'not sure', 'try', 'test'], program: 'zoom_trial', label: 'Zoom Trial' },
  { keywords: ['home', 'no gym', 'bodyweight'], program: '6wk_home', label: '6-Week Home' }
];

const STOP_WORDS = ['stop', 'unsubscribe', 'opt out', 'optout', 'cancel'];

function matchProgram(text) {
  const lower = (text || '').toLowerCase();
  for (const route of PROGRAM_ROUTES) {
    for (const kw of route.keywords) {
      if (lower.includes(kw)) return route;
    }
  }
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const body = req.body || {};
    const phone = (body.senderNumber || body.from || '').replace(/\D/g, '');
    const text = body.message || body.text || body.body || '';
    const name = body.senderName || body.name || '';

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    await supabase.from('messages').insert({
      phone, direction: 'in', body: text
    });

    const lowerText = text.toLowerCase().trim();
    if (STOP_WORDS.some(w => lowerText.includes(w))) {
      await supabase
        .from('leads')
        .update({ status: 'dropped' })
        .eq('phone', phone);
      console.log(`[WA] Opt-out: ${maskPhone(phone)}`);
      return res.status(200).json({ action: 'opted_out' });
    }

    const escalationKeyword = needsEscalation(text);
    if (escalationKeyword) {
      await createEscalation(phone, escalationKeyword, text);
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .order('created_at', { ascending: false })
      .limit(1);

    const { data: existingClient } = await supabase
      .from('clients')
      .select('id')
      .eq('phone', phone)
      .eq('status', 'active')
      .limit(1);

    if (existingClient && existingClient.length > 0) {
      return res.status(200).json({ action: 'active_client_message_logged' });
    }

    const market = detectMarket(phone);
    const hinglish = isHinglishMarket(market);

    if (!existingLead || existingLead.length === 0) {
      const { data: newLead } = await supabase.from('leads').insert({
        phone, name, source: 'whatsapp', status: 'new',
        first_msg: text, last_msg_at: new Date().toISOString(),
        market
      }).select().single();

      const welcomeMsg = hinglish
        ? "Hi! Maddy's team here. Kaun sa goal hai - fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?"
        : "Hi! Welcome to Fitness by Maddy. What's your goal - fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?";

      await sendWhatsApp(phone, 'welcome_v1', {
        name: name || 'there',
        text: welcomeMsg,
        templateParams: [name || 'there'],
        skipRateLimit: true
      });

      console.log(`[WA] New lead: ${maskPhone(phone)} market=${market}`);
      return res.status(200).json({ action: 'new_lead', id: newLead?.id });
    }

    const lead = existingLead[0];

    if (lead.status === 'dropped') {
      return res.status(200).json({ action: 'dropped_lead_ignored' });
    }

    await supabase
      .from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('id', lead.id);

    const programMatch = matchProgram(text);
    if (programMatch) {
      await supabase
        .from('leads')
        .update({
          status: 'qualified',
          program_interest: programMatch.program
        })
        .eq('id', lead.id);

      const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${lead.id}`;
      const intakeUrl = `https://www.fitnessbymaddy.com/intake.html?lead=${lead.id}`;

      const qualMsg = hinglish
        ? `${programMatch.label} - great choice! Yeh raha checkout link: ${checkoutUrl}\n\nAur please yeh intake form bhi fill karo: ${intakeUrl}`
        : `${programMatch.label} - great choice! Here's your checkout link: ${checkoutUrl}\n\nAlso please fill out this intake form: ${intakeUrl}`;

      await sendWhatsApp(phone, null, {
        text: qualMsg,
        name: lead.name || 'there',
        skipRateLimit: true
      });

      console.log(`[WA] Qualified ${maskPhone(phone)} -> ${programMatch.program}`);
      return res.status(200).json({ action: 'qualified', program: programMatch.program });
    }

    return res.status(200).json({ action: 'message_logged' });
  } catch (err) {
    console.error('[WA Webhook] Error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
