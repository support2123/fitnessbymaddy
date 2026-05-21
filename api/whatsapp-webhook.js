const { getSupabase } = require('./lib/supabase');
const { sendWhatsApp } = require('./lib/whatsapp');
const { detectMarket, isHinglish } = require('./lib/market');
const { needsEscalation, isOptOut, escalateToMaddy } = require('./lib/escalation');

const PROGRAM_MAP = {
  'fat loss': '6wk_gym', 'weight': '6wk_gym', 'shred': '6wk_gym', 'fat': '6wk_gym',
  'pcos': 'pcos', 'hormonal': 'pcos', 'hormone': 'pcos',
  '40': '40plus', 'menopause': '40plus', 'joints': '40plus', 'joint': '40plus',
  'custom': '12wk', '12 week': '12wk', 'serious': '12wk', 'flagship': '12wk',
  'trial': 'zoom_trial', 'zoom': 'zoom_trial', 'not sure': 'zoom_trial', 'try': 'zoom_trial',
  'home': '6wk_home',
};

const PROGRAM_NAMES = {
  '6wk_gym': '6-Week Burn & Build (Gym)',
  '6wk_home': '6-Week Burn & Build (Home)',
  '12wk': '12-Week Flagship Program',
  'pcos': 'PCOS Warrior Program',
  '40plus': '40+ Strong Program',
  'zoom_trial': '$20 Zoom Trial Session',
  'zoom_pack': 'Zoom Session Pack',
};

const CHECKOUT_LINKS = {
  '6wk_gym': 'https://fitnessbymaddyy.exlyapp.com/checkout/6wk-gym',
  '6wk_home': 'https://fitnessbymaddyy.exlyapp.com/checkout/6wk-home',
  '12wk': 'https://fitnessbymaddyy.exlyapp.com/checkout/12wk',
  'pcos': 'https://fitnessbymaddyy.exlyapp.com/checkout/pcos',
  '40plus': 'https://fitnessbymaddyy.exlyapp.com/checkout/40plus',
  'zoom_trial': 'https://fitnessbymaddyy.exlyapp.com/checkout/zoom-trial',
};

function matchProgram(message) {
  if (!message) return null;
  const lower = message.toLowerCase();
  for (const [keyword, program] of Object.entries(PROGRAM_MAP)) {
    if (lower.includes(keyword)) return program;
  }
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const db = getSupabase();

  try {
    const { mobile, message, name, waId } = req.body;
    const phone = mobile || waId;
    if (!phone) return res.status(400).json({ error: 'No phone number' });

    const msgBody = (message || '').trim();

    await db.from('messages').insert({
      phone,
      direction: 'in',
      body: msgBody,
    });

    if (isOptOut(msgBody)) {
      await db.from('leads').update({ status: 'dropped', opted_out: true }).eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    const escalationKeyword = needsEscalation(msgBody);
    if (escalationKeyword) {
      const client = await db.from('clients').select('id').eq('phone', phone).limit(1);
      await escalateToMaddy({
        phone,
        reason: `Keyword detected: "${escalationKeyword}"`,
        messageBody: msgBody,
        clientId: client.data?.[0]?.id,
      });
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .limit(1)
      .single();

    const market = detectMarket(phone);
    const hinglish = isHinglish(market);

    if (!existingLead) {
      const { data: newLead } = await db.from('leads').insert({
        phone,
        name: name || null,
        source: 'whatsapp',
        status: 'new',
        first_msg: msgBody,
        last_msg_at: new Date().toISOString(),
        market,
      }).select().single();

      const welcomeValues = hinglish
        ? ['Hi! Maddy\'s team here. Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?']
        : ['Hi! Welcome to Fitness by Maddy. What\'s your goal — fat loss, PCOS management, strength, 40+ fitness, or would you like to try a trial session first?'];

      await sendWhatsApp({
        phone,
        templateName: 'welcome_v1',
        bodyValues: welcomeValues,
      });

      return res.status(200).json({ action: 'new_lead', id: newLead?.id });
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'lead_dropped' });
    }

    await db.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('id', existingLead.id);

    if (existingLead.status === 'new' || existingLead.status === 'qualified') {
      const program = matchProgram(msgBody);

      if (program) {
        await db.from('leads').update({
          status: 'qualified',
          program_interest: program,
        }).eq('id', existingLead.id);

        const programName = PROGRAM_NAMES[program];
        const checkoutLink = CHECKOUT_LINKS[program];
        const intakeLink = `https://www.fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;

        const qualifyValues = hinglish
          ? [
              `${programName} — perfect choice!`,
              `Checkout: ${checkoutLink}`,
              `Pehle yeh form bhar do: ${intakeLink}`,
            ]
          : [
              `${programName} — great choice!`,
              `Checkout here: ${checkoutLink}`,
              `Please fill this intake form first: ${intakeLink}`,
            ];

        await sendWhatsApp({
          phone,
          templateName: 'program_qualify',
          bodyValues: qualifyValues,
        });

        return res.status(200).json({ action: 'qualified', program });
      }
    }

    return res.status(200).json({ action: 'message_logged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
