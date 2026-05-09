const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp, logInbound } = require('../lib/whatsapp');
const { detectMarket, isHinglish, maskPhone } = require('../lib/market');
const { needsEscalation, escalateToMaddy } = require('../lib/escalation');

const PROGRAM_ROUTES = [
  { keywords: ['fat loss', 'weight', 'shred', 'lean', 'cut'], program: '6wk_gym', label: '6-Week Burn & Build' },
  { keywords: ['pcos', 'hormonal', 'hormone', 'pcod'], program: 'pcos', label: 'PCOS Warrior' },
  { keywords: ['40', 'menopause', 'joints', 'joint', 'mature'], program: '40plus', label: '40+ Strong' },
  { keywords: ['custom', '12 week', '12week', 'serious', 'flagship'], program: '12wk', label: '12-Week Custom' },
  { keywords: ['trial', 'zoom', 'not sure', 'try', 'test'], program: 'zoom_trial', label: 'Zoom Trial' },
  { keywords: ['home', 'no gym', 'bodyweight', 'home workout'], program: '6wk_home', label: '6-Week Home' }
];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method === 'GET') return res.status(200).json({ status: 'webhook active' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { phone, text } = parseWebhookPayload(req.body);
    if (!phone || !text) return res.status(200).json({ ok: true, note: 'No actionable message' });

    const db = getSupabase();
    const market = detectMarket(phone);
    const hinglish = isHinglish(market);

    await logInbound(phone, text);

    if (isOptOut(text)) {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.status(200).json({ ok: true, action: 'opted_out' });
    }

    if (needsEscalation(text)) {
      const { data: lead } = await db.from('leads').select('name').eq('phone', phone).maybeSingle();
      await escalateToMaddy({ reason: 'Keyword trigger', phone, clientName: lead?.name, message: text });
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .maybeSingle();

    if (!existingLead) {
      await db.from('leads').insert({
        phone,
        name: null,
        source: 'whatsapp',
        status: 'new',
        first_msg: text,
        last_msg_at: new Date().toISOString(),
        market
      });

      const welcome = hinglish
        ? "Hi! Maddy's team here 👋 Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?"
        : "Hi! Maddy's team here 👋 What's your goal — fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?";

      await sendWhatsApp({ phone, message: welcome, templateName: 'welcome_v1' });
      return res.status(200).json({ ok: true, action: 'new_lead_welcomed' });
    }

    await db.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('phone', phone);

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ ok: true, action: 'lead_dropped_ignored' });
    }

    if (existingLead.status === 'new' || existingLead.status === 'qualified') {
      const matched = matchProgram(text);
      if (matched) {
        await db.from('leads').update({
          status: 'qualified',
          program_interest: matched.program
        }).eq('phone', phone);

        const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${existingLead.id}`;
        const intakeUrl = `https://fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;

        const msg = hinglish
          ? `Great choice! 🔥 ${matched.label} program aapke liye perfect hai.\n\n✅ Payment link: ${checkoutUrl}\n📋 Intake form bhi fill karo: ${intakeUrl}\n\nKoi sawaal ho toh poochho!`
          : `Great choice! 🔥 The ${matched.label} program is perfect for you.\n\n✅ Payment link: ${checkoutUrl}\n📋 Please fill your intake form: ${intakeUrl}\n\nAny questions? Just ask!`;

        await sendWhatsApp({ phone, message: msg, templateName: 'program_offer' });
        return res.status(200).json({ ok: true, action: 'qualified', program: matched.program });
      }
    }

    return res.status(200).json({ ok: true, action: 'message_logged' });
  } catch (err) {
    console.error('Webhook error:', maskPhone(req.body?.phone), err.message);
    return res.status(200).json({ ok: true, note: 'Error handled gracefully' });
  }
};

function parseWebhookPayload(body) {
  if (!body) return {};

  if (body.entry?.[0]?.changes?.[0]?.value?.messages?.[0]) {
    const msg = body.entry[0].changes[0].value.messages[0];
    return { phone: msg.from, text: msg.text?.body || '' };
  }

  if (body.from && (body.text || body.message)) {
    return { phone: body.from, text: body.text || body.message };
  }

  if (body.phone && body.message) {
    return { phone: body.phone, text: body.message };
  }

  return {};
}

function matchProgram(text) {
  const lower = (text || '').toLowerCase();
  for (const route of PROGRAM_ROUTES) {
    if (route.keywords.some(kw => lower.includes(kw))) return route;
  }
  return null;
}

function isOptOut(text) {
  const lower = (text || '').toLowerCase().trim();
  return ['stop', 'unsubscribe', 'opt out', 'optout'].includes(lower);
}
