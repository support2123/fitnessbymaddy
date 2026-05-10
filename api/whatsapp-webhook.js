const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp, logMessage } = require('../lib/whatsapp');
const { detectMarket, isHinglish, maskPhone } = require('../lib/market');
const { needsEscalation, escalateToMaddy } = require('../lib/escalation');

const PROGRAM_MAP = {
  'fat loss': '6wk_gym', 'weight': '6wk_gym', 'shred': '6wk_gym',
  'weight loss': '6wk_gym', 'fat': '6wk_gym', 'lose': '6wk_gym',
  'pcos': 'pcos', 'hormonal': 'pcos', 'hormone': 'pcos',
  '40': '40plus', 'menopause': '40plus', 'joints': '40plus', '40+': '40plus',
  'custom': '12wk', '12 week': '12wk', 'serious': '12wk', '12wk': '12wk',
  'trial': 'zoom_trial', 'zoom': 'zoom_trial', 'not sure': 'zoom_trial', 'try': 'zoom_trial'
};

const PROGRAM_NAMES = {
  '6wk_gym': '6-Week Burn & Build',
  'pcos': 'PCOS Warrior',
  '40plus': '40+ Strong',
  '12wk': '12-Week Flagship',
  'zoom_trial': '$20 Zoom Trial'
};

const CHECKOUT_LINKS = {
  '6wk_gym': 'https://fitnessbymaddyy.exlyapp.com/checkout/6wk-burn-build',
  'pcos': 'https://fitnessbymaddyy.exlyapp.com/checkout/pcos-warrior',
  '40plus': 'https://fitnessbymaddyy.exlyapp.com/checkout/40plus-strong',
  '12wk': 'https://fitnessbymaddyy.exlyapp.com/checkout/12wk-flagship',
  'zoom_trial': 'https://fitnessbymaddyy.exlyapp.com/checkout/zoom-trial'
};

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = req.body || {};
    const phone = body.mobile || body.phone || body.from || '';
    const text = body.text || body.message || body.body || '';
    const name = body.name || body.pushName || '';

    if (!phone) {
      return res.status(400).json({ error: 'No phone number provided' });
    }

    const db = getSupabase();

    await logMessage({
      phone,
      direction: 'in',
      body: text,
      template_name: null,
      status: 'received'
    });

    const lowerText = text.toLowerCase().trim();

    if (lowerText === 'stop' || lowerText === 'unsubscribe') {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      await db.from('clients').update({ status: 'paused' }).eq('phone', phone);
      console.log(`Opt-out: ${maskPhone(phone)}`);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(text)) {
      const { data: existingClient } = await db
        .from('clients')
        .select('name')
        .eq('phone', phone)
        .single();

      await escalateToMaddy({
        reason: 'Keyword trigger in message',
        phone,
        clientName: existingClient?.name || name,
        message: text
      });
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      const market = detectMarket(phone);
      const { data: newLead } = await db.from('leads').insert({
        phone,
        name: name || null,
        source: 'whatsapp',
        status: 'new',
        first_msg: text,
        last_msg_at: new Date().toISOString(),
        market
      }).select().single();

      const hinglish = isHinglish(market);
      const welcomeTemplate = hinglish ? 'welcome_v1_hi' : 'welcome_v1';
      const welcomeBody = hinglish
        ? "Hi! Maddy's team here. Kaun sa goal hai - fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?"
        : "Hi! Maddy's team here. What's your goal - fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?";

      await sendWhatsApp({
        phone,
        templateName: welcomeTemplate,
        params: [name || 'there'],
        body: welcomeBody
      });

      return res.status(200).json({ action: 'new_lead', leadId: newLead?.id });
    }

    await db.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('phone', phone);

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'lead_dropped', note: 'No further messaging' });
    }

    if (existingLead.status === 'new' || existingLead.status === 'qualified') {
      const matchedProgram = matchProgram(lowerText);

      if (matchedProgram) {
        const market = existingLead.market || detectMarket(phone);
        const hinglish = isHinglish(market);

        await db.from('leads').update({
          status: 'qualified',
          program_interest: matchedProgram
        }).eq('phone', phone);

        const programName = PROGRAM_NAMES[matchedProgram];
        const checkoutLink = CHECKOUT_LINKS[matchedProgram];
        const intakeLink = `https://www.fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;

        const msgBody = hinglish
          ? `${programName} - perfect choice! Yeh raha checkout link: ${checkoutLink}\n\nPehle yeh intake form bhar do: ${intakeLink}`
          : `${programName} - great choice! Here's your checkout link: ${checkoutLink}\n\nPlease fill out this intake form first: ${intakeLink}`;

        await sendWhatsApp({
          phone,
          templateName: 'program_match',
          params: [name || 'there', programName, checkoutLink, intakeLink],
          body: msgBody
        });

        return res.status(200).json({ action: 'qualified', program: matchedProgram });
      }
    }

    return res.status(200).json({ action: 'message_logged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

function matchProgram(text) {
  for (const [keyword, program] of Object.entries(PROGRAM_MAP)) {
    if (text.includes(keyword)) return program;
  }
  return null;
}
