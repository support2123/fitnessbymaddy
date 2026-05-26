const { getSupabase } = require('./lib/supabase');
const { sendWhatsApp } = require('./lib/whatsapp');
const { needsEscalation, escalateToMaddy, maskPhone } = require('./lib/escalation');
const { detectMarket, isHinglishMarket } = require('./lib/market');

const PROGRAM_ROUTES = {
  'fat loss': '6wk_gym',
  weight: '6wk_gym',
  shred: '6wk_gym',
  lose: '6wk_gym',
  pcos: 'pcos',
  hormonal: 'pcos',
  '40': '40plus',
  menopause: '40plus',
  joints: '40plus',
  custom: '12wk',
  '12 week': '12wk',
  serious: '12wk',
  trial: 'zoom_trial',
  zoom: 'zoom_trial',
  'not sure': 'zoom_trial',
  home: '6wk_home',
};

const PROGRAM_NAMES = {
  '6wk_gym': '6-Week Burn & Build (Gym)',
  '6wk_home': '6-Week Burn & Build (Home)',
  '12wk': '12-Week Custom Flagship',
  pcos: 'PCOS Warrior Program',
  '40plus': '40+ Strong Program',
  zoom_trial: 'Zoom Trial Session',
  zoom_pack: 'Zoom Session Pack',
};

const PROGRAM_PRICES = {
  '6wk_gym': 97,
  '6wk_home': 97,
  '12wk': 200,
  pcos: 45,
  '40plus': 50,
  zoom_trial: 20,
  zoom_pack: 80,
};

function routeToProgram(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  for (const [keyword, program] of Object.entries(PROGRAM_ROUTES)) {
    if (lower.includes(keyword)) return program;
  }
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const db = getSupabase();

  try {
    const payload = req.body;
    const phone = payload.mobile || payload.from || payload.senderMobile;
    const incomingMsg = payload.text || payload.message || payload.body || '';
    const senderName = payload.name || payload.senderName || null;

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    await db.from('messages').insert({
      phone,
      direction: 'in',
      body: incomingMsg,
    });

    if (/^(stop|unsubscribe|cancel)$/i.test(incomingMsg.trim())) {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(incomingMsg)) {
      await escalateToMaddy(
        'Keyword trigger in message',
        `Phone: ${maskPhone(phone)}\nMessage: ${incomingMsg}`
      );
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      const market = detectMarket(phone);
      const hinglish = isHinglishMarket(market);

      await db.from('leads').insert({
        phone,
        name: senderName,
        source: 'whatsapp',
        status: 'new',
        first_msg: incomingMsg,
        last_msg_at: new Date().toISOString(),
        market,
      });

      const welcomeMsg = hinglish
        ? "Hi! Maddy's team here. Kaun sa goal hai - fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?"
        : "Hi! Maddy's team here. What's your fitness goal - fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?";

      await sendWhatsApp(phone, welcomeMsg, 'welcome_v1');
      return res.status(200).json({ action: 'new_lead_welcomed' });
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'lead_dropped_ignored' });
    }

    await db
      .from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('phone', phone);

    if (existingLead.status === 'new') {
      const program = routeToProgram(incomingMsg);

      if (program) {
        const market = existingLead.market || detectMarket(phone);
        const hinglish = isHinglishMarket(market);
        const price = PROGRAM_PRICES[program];
        const programName = PROGRAM_NAMES[program];

        await db
          .from('leads')
          .update({ status: 'qualified', program_interest: program })
          .eq('phone', phone);

        const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${program}`;
        const intakeUrl = `https://fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;

        const qualifyMsg = hinglish
          ? `Great choice! ${programName} ($${price}) aapke liye perfect hai.\n\nCheckout: ${checkoutUrl}\n\nPayment ke baad, yeh form fill karo taaki hum aapka program customize kar sakein:\n${intakeUrl}`
          : `Great choice! The ${programName} ($${price}) is perfect for you.\n\nCheckout here: ${checkoutUrl}\n\nAfter payment, fill out this form so we can customise your program:\n${intakeUrl}`;

        await sendWhatsApp(phone, qualifyMsg);
        return res.status(200).json({ action: 'lead_qualified', program });
      }

      const market = existingLead.market || detectMarket(phone);
      const hinglish = isHinglishMarket(market);

      const clarifyMsg = hinglish
        ? "Koi baat nahi! Batao - kya goal hai? Options:\n\n1. Fat loss / shred\n2. PCOS / hormonal balance\n3. 40+ fitness\n4. 12-week custom program\n5. $20 trial session\n\nBas ek number ya keyword bhejo!"
        : "No worries! Tell me your goal:\n\n1. Fat loss / shred\n2. PCOS / hormonal balance\n3. 40+ fitness\n4. 12-week custom program\n5. $20 trial session\n\nJust send a number or keyword!";

      await sendWhatsApp(phone, clarifyMsg);
      return res.status(200).json({ action: 'asked_to_clarify' });
    }

    return res.status(200).json({ action: 'acknowledged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
