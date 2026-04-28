const { getSupabase } = require('./_lib/supabase');
const { sendTemplate, sendText, logMessage } = require('./_lib/whatsapp');
const { detectMarket, maskPhone } = require('./_lib/market');
const { needsEscalation, escalate } = require('./_lib/escalation');

const QUALIFICATION_MAP = [
  { keywords: ['fat loss', 'weight', 'shred', 'lose', 'slim', 'lean'], program: '6wk_gym', name: '6-Week Burn & Build', price: '$97', checkout: '6wk-burn' },
  { keywords: ['pcos', 'hormonal', 'hormone', 'pcod'], program: 'pcos', name: 'PCOS Warrior', price: '$45', checkout: 'pcos-warrior' },
  { keywords: ['40', 'menopause', 'joints', 'joint', 'knee', 'back pain', 'senior'], program: '40plus', name: '40+ Strong', price: '$50', checkout: '40plus-strong' },
  { keywords: ['custom', '12 week', '12wk', 'serious', 'personalised', 'personalized', 'flagship'], program: '12wk', name: '12-Week Flagship', price: '$200', checkout: '12wk-flagship' },
  { keywords: ['trial', 'zoom', 'not sure', 'try', 'test', 'sample'], program: 'zoom_trial', name: 'Zoom Trial', price: '$20', checkout: 'zoom-trial' },
  { keywords: ['home', 'no gym', 'bodyweight', 'at home'], program: '6wk_home', name: '6-Week Home Program', price: '$97', checkout: '6wk-home' },
];

function matchProgram(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  for (const entry of QUALIFICATION_MAP) {
    for (const kw of entry.keywords) {
      if (lower.includes(kw)) return entry;
    }
  }
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const db = getSupabase();

  try {
    const payload = req.body;
    const phone = payload.mobile || payload.from || payload.sender;
    const text = payload.text || payload.message || payload.body || '';
    const senderName = payload.name || payload.pushName || null;

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    await logMessage(phone, 'in', text, null);

    // Check opt-out
    const lowerText = text.toLowerCase().trim();
    if (lowerText === 'stop' || lowerText === 'unsubscribe') {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    // Check escalation triggers
    const escalationKeyword = needsEscalation(text);
    if (escalationKeyword) {
      await escalate(phone, escalationKeyword, text);
    }

    // Check if existing lead
    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    // Check if already a client
    const { data: existingClient } = await db
      .from('clients')
      .select('id, status')
      .eq('phone', phone)
      .eq('status', 'active')
      .single();

    if (existingClient) {
      // Active client messaging — log and pass through (no auto-reply to avoid confusion)
      return res.status(200).json({ action: 'client_message_logged' });
    }

    const market = detectMarket(phone);
    const isHinglish = market === 'IN';

    if (!existingLead) {
      // FLOW A — NEW LEAD
      await db.from('leads').insert({
        phone,
        name: senderName,
        source: 'whatsapp',
        status: 'new',
        first_msg: text,
        last_msg_at: new Date().toISOString(),
        market
      });

      // Send welcome template
      await sendTemplate(phone, 'welcome_v1', {
        name: senderName || 'there',
        templateParams: [senderName || 'there']
      });

      // Schedule nudges via status tracking — cron handles actual delivery
      console.log(`New lead: ${maskPhone(phone)} market=${market}`);
      return res.status(200).json({ action: 'new_lead_created' });
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'lead_dropped_ignored' });
    }

    // FLOW B — QUALIFICATION (lead replied)
    await db.from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('id', existingLead.id);

    const matched = matchProgram(text);

    if (matched) {
      await db.from('leads')
        .update({
          status: 'qualified',
          program_interest: matched.program
        })
        .eq('id', existingLead.id);

      const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${matched.checkout}`;
      const intakeUrl = `https://www.fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;

      let msg;
      if (isHinglish) {
        msg = `Perfect choice! 🎯\n\n*${matched.name}* — ${matched.price}\n\nCheckout yahan se karo:\n${checkoutUrl}\n\nAur ye intake form bhi fill karo taaki hum tumhara program customize kar sakein:\n${intakeUrl}\n\nKoi doubt ho toh pooch lo! 💪`;
      } else {
        msg = `Great choice! 🎯\n\n*${matched.name}* — ${matched.price}\n\nComplete your checkout here:\n${checkoutUrl}\n\nAlso fill out this intake form so we can customise your program:\n${intakeUrl}\n\nAny questions? Just ask! 💪`;
      }

      await sendText(phone, msg, false);
      console.log(`Lead qualified: ${maskPhone(phone)} → ${matched.program}`);
      return res.status(200).json({ action: 'lead_qualified', program: matched.program });
    }

    // No keyword match — send gentle guidance
    let guidance;
    if (isHinglish) {
      guidance = `Hey! Batao kya goal hai:\n\n🔥 *Fat loss / Shred*\n💪 *PCOS / Hormonal*\n🏋️ *40+ Fitness*\n⭐ *12-Week Custom Program*\n🎥 *Zoom Trial ($20)*\n\nYa kuch aur specific hai toh batao!`;
    } else {
      guidance = `Hey! Let us know your goal:\n\n🔥 *Fat loss / Shred*\n💪 *PCOS / Hormonal*\n🏋️ *40+ Fitness*\n⭐ *12-Week Custom Program*\n🎥 *Zoom Trial ($20)*\n\nOr tell us something more specific!`;
    }

    await sendText(phone, guidance, false);
    return res.status(200).json({ action: 'guidance_sent' });

  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
