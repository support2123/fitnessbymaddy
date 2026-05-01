const supabase = require('../lib/supabase');
const { normalizePhone, detectMarket, maskPhone } = require('../lib/phone');
const { sendTemplate, sendSessionMessage, canSendMessage } = require('../lib/whatsapp');
const { needsEscalation, escalate } = require('../lib/escalation');

const PROGRAM_MAP = [
  { keywords: ['fat loss', 'weight', 'shred', 'lose', 'slim', 'lean'], program: '6wk_gym', name: '6-Week Burn & Build', price: '$97' },
  { keywords: ['pcos', 'hormonal', 'hormone', 'pcod'], program: 'pcos', name: 'PCOS Warrior', price: '$45' },
  { keywords: ['40', 'menopause', 'joints', 'joint', 'senior', 'knee'], program: '40plus', name: '40+ Strong', price: '$50' },
  { keywords: ['custom', '12 week', 'serious', 'advanced', 'flagship'], program: '12wk', name: '12-Week Flagship', price: '$200' },
  { keywords: ['trial', 'zoom', 'not sure', 'try', 'test'], program: 'zoom_trial', name: 'Zoom Trial', price: '$20' },
  { keywords: ['home', 'no gym', 'bodyweight', 'at home'], program: '6wk_home', name: '6-Week Home Program', price: '$97' }
];

const OPT_OUT_KEYWORDS = ['stop', 'unsubscribe', 'opt out', 'cancel messages', 'dont message'];

function matchProgram(text) {
  const lower = text.toLowerCase();
  for (const entry of PROGRAM_MAP) {
    for (const kw of entry.keywords) {
      if (lower.includes(kw)) return entry;
    }
  }
  return null;
}

function isOptOut(text) {
  const lower = text.toLowerCase().trim();
  return OPT_OUT_KEYWORDS.some(kw => lower.includes(kw));
}

function getLanguage(market) {
  return market === 'IN' ? 'hinglish' : 'en';
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method === 'GET') {
    return res.status(200).json({ status: 'ok', endpoint: 'whatsapp-webhook' });
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const payload = req.body;
    const phone = normalizePhone(payload?.contact?.phone || payload?.waId || '');
    const name = payload?.contact?.name || payload?.pushName || '';
    const text = payload?.message?.text || payload?.text?.body || payload?.body || '';

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    await supabase.from('messages').insert({
      phone, direction: 'in', body: text
    });

    if (isOptOut(text)) {
      await supabase.from('leads').update({ status: 'dropped', dropped_at: new Date().toISOString() }).eq('phone', phone);
      await supabase.from('clients').update({ status: 'paused' }).eq('phone', phone);
      console.log(`Opt-out: ${maskPhone(phone)}`);
      return res.status(200).json({ action: 'opted_out' });
    }

    const escalationTrigger = needsEscalation(text);

    const { data: existingClient } = await supabase
      .from('clients')
      .select('id, phone, status')
      .eq('phone', phone)
      .eq('status', 'active')
      .maybeSingle();

    if (existingClient) {
      if (escalationTrigger) {
        await escalate(phone, escalationTrigger, text, existingClient.id);
      }
      return res.status(200).json({ action: 'client_message_logged' });
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .maybeSingle();

    if (existingLead) {
      if (existingLead.status === 'dropped') {
        return res.status(200).json({ action: 'lead_dropped_no_action' });
      }

      if (escalationTrigger) {
        await escalate(phone, escalationTrigger, text);
        return res.status(200).json({ action: 'escalated' });
      }

      const program = matchProgram(text);
      if (program) {
        await supabase.from('leads').update({
          status: 'qualified',
          program_interest: program.program,
          last_msg_at: new Date().toISOString()
        }).eq('id', existingLead.id);

        const market = existingLead.market || 'GLOBAL';
        const lang = getLanguage(market);

        const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${program.program}`;
        const intakeUrl = `https://fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;

        if (lang === 'hinglish') {
          await sendSessionMessage(phone,
            `Great choice! 🎯 ${program.name} (${program.price}) — yeh program tere goals ke liye perfect hai.\n\n` +
            `💳 Checkout: ${checkoutUrl}\n` +
            `📋 Intake form bhi fill karo: ${intakeUrl}\n\n` +
            `Koi doubt ho toh pooch lo!`
          );
        } else {
          await sendSessionMessage(phone,
            `Great choice! 🎯 ${program.name} (${program.price}) is perfect for your goals.\n\n` +
            `💳 Checkout: ${checkoutUrl}\n` +
            `📋 Please fill the intake form too: ${intakeUrl}\n\n` +
            `Any questions? Just ask!`
          );
        }

        return res.status(200).json({ action: 'qualified', program: program.program });
      }

      await supabase.from('leads').update({
        last_msg_at: new Date().toISOString()
      }).eq('id', existingLead.id);

      return res.status(200).json({ action: 'lead_reply_logged' });
    }

    const market = detectMarket(phone);
    const { data: newLead } = await supabase.from('leads').insert({
      phone,
      name: name || null,
      source: 'whatsapp',
      status: 'new',
      first_msg: text,
      market
    }).select().single();

    if (escalationTrigger) {
      await escalate(phone, escalationTrigger, text);
    }

    const lang = getLanguage(market);
    if (lang === 'hinglish') {
      await sendTemplate(phone, 'welcome_v1', [
        name || 'there'
      ]);
    } else {
      await sendTemplate(phone, 'welcome_v1_en', [
        name || 'there'
      ]);
    }

    console.log(`New lead: ${maskPhone(phone)} market=${market}`);
    return res.status(200).json({ action: 'new_lead', lead_id: newLead?.id });

  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
