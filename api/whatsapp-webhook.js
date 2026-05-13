const { getSupabase } = require('./_lib/supabase');
const { sendTemplate, notifyMaddy } = require('./_lib/whatsapp');
const { detectMarket, isHinglish, maskPhone } = require('./_lib/market');
const { needsEscalation, classifyEscalation } = require('./_lib/escalation');

const PROGRAM_ROUTES = {
  '6wk_gym':    ['fat loss', 'weight', 'shred', 'lose', 'burn', 'slim', 'lean'],
  'pcos':       ['pcos', 'hormonal', 'hormone', 'pcod', 'irregular period'],
  '40plus':     ['40', 'menopause', 'joints', 'joint pain', 'senior', 'over 40'],
  '12wk':       ['custom', '12 week', 'serious', 'personalised', 'personalized', 'flagship'],
  'zoom_trial': ['trial', 'zoom', 'not sure', 'try', 'test', 'demo']
};

const STOP_WORDS = ['stop', 'unsubscribe', 'opt out', 'optout', 'cancel messages'];

function routeProgram(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  for (const [program, keywords] of Object.entries(PROGRAM_ROUTES)) {
    if (keywords.some(kw => lower.includes(kw))) return program;
  }
  return null;
}

function programCheckoutUrl(program) {
  const slugs = {
    '6wk_gym':    '6-week-burn-and-build',
    '6wk_home':   '6-week-burn-and-build-home',
    'pcos':       'pcos-warrior',
    '40plus':     '40plus-strong',
    '12wk':       '12-week-flagship',
    'zoom_trial': 'zoom-trial',
    'zoom_pack':  'zoom-pack'
  };
  return `https://fitnessbymaddyy.exlyapp.com/checkout/${slugs[program] || program}`;
}

function programDisplayName(program) {
  const names = {
    '6wk_gym':    '6-Week Burn & Build (Gym)',
    '6wk_home':   '6-Week Burn & Build (Home)',
    'pcos':       'PCOS Warrior Program',
    '40plus':     '40+ Strong Program',
    '12wk':       '12-Week Custom Flagship',
    'zoom_trial': '$20 Zoom Trial',
    'zoom_pack':  'Zoom Session Pack'
  };
  return names[program] || program;
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { senderPhone, senderName, message, text, from, name: webhookName } = req.body;
    const phone = senderPhone || from || req.body.phone;
    const senderText = message || text || req.body.body || '';
    const contactName = senderName || webhookName || '';

    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    const market = detectMarket(phone);
    const hinglish = isHinglish(market);

    await getSupabase().from('messages').insert({
      phone,
      direction: 'in',
      body: senderText
    });

    if (STOP_WORDS.some(w => senderText.toLowerCase().includes(w))) {
      await getSupabase()
        .from('leads')
        .update({ status: 'dropped', last_msg_at: new Date().toISOString() })
        .eq('phone', phone);
      console.log(`Opted out: ${maskPhone(phone)}`);
      return res.json({ action: 'opted_out' });
    }

    if (needsEscalation(senderText)) {
      const type = classifyEscalation(senderText);
      await notifyMaddy(
        `Escalation (${type})`,
        `Phone: ${maskPhone(phone)}\nName: ${contactName}\nMessage: ${senderText}`
      );
      return res.json({ action: 'escalated', type });
    }

    const { data: existingLead } = await getSupabase()
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      await getSupabase().from('leads').insert({
        phone,
        name: contactName,
        source: 'whatsapp',
        status: 'new',
        first_msg: senderText,
        last_msg_at: new Date().toISOString(),
        market
      });

      await sendTemplate(phone, 'welcome_v1', [contactName || 'there'], contactName);
      return res.json({ action: 'new_lead', market });
    }

    await getSupabase()
      .from('leads')
      .update({ last_msg_at: new Date().toISOString(), name: contactName || existingLead.name })
      .eq('id', existingLead.id);

    if (existingLead.status === 'new' || existingLead.status === 'qualified') {
      const program = routeProgram(senderText);

      if (program) {
        await getSupabase()
          .from('leads')
          .update({ status: 'qualified', program_interest: program })
          .eq('id', existingLead.id);

        const checkoutUrl = programCheckoutUrl(program);
        const displayName = programDisplayName(program);
        const intakeUrl = `https://fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;

        if (hinglish) {
          await sendTemplate(phone, 'program_link_hi', [
            contactName || 'there',
            displayName,
            checkoutUrl,
            intakeUrl
          ], contactName);
        } else {
          await sendTemplate(phone, 'program_link_en', [
            contactName || 'there',
            displayName,
            checkoutUrl,
            intakeUrl
          ], contactName);
        }

        return res.json({ action: 'qualified', program });
      }
    }

    return res.json({ action: 'logged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
