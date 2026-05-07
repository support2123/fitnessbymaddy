const { supabase } = require('./_lib/supabase');
const { sendTemplate, sendText, logMessage, checkRateLimit } = require('./_lib/whatsapp');
const { detectMarket, isHinglish, maskPhone } = require('./_lib/market');
const { needsEscalation, notifyMaddy } = require('./_lib/escalation');

const PROGRAM_ROUTES = {
  'fat loss': '6wk_gym', 'weight': '6wk_gym', 'shred': '6wk_gym', 'burn': '6wk_gym',
  'pcos': 'pcos', 'hormonal': 'pcos', 'hormone': 'pcos',
  '40': '40plus', 'menopause': '40plus', 'joints': '40plus', 'joint': '40plus',
  'custom': '12wk', '12 week': '12wk', 'serious': '12wk', 'flagship': '12wk',
  'trial': 'zoom_trial', 'zoom': 'zoom_trial', 'not sure': 'zoom_trial', 'try': 'zoom_trial'
};

const PROGRAM_NAMES = {
  '6wk_gym': '6-Week Burn & Build',
  'pcos': 'PCOS Warrior Program',
  '40plus': '40+ Strong Program',
  '12wk': '12-Week Custom Flagship',
  'zoom_trial': '$20 Zoom Trial'
};

const CHECKOUT_PATHS = {
  '6wk_gym': 'six-week-burn',
  'pcos': 'pcos-warrior',
  '40plus': 'forty-plus-strong',
  '12wk': 'twelve-week-custom',
  'zoom_trial': 'zoom-trial'
};

function routeProgram(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  for (const [keyword, program] of Object.entries(PROGRAM_ROUTES)) {
    if (lower.includes(keyword)) return program;
  }
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && token === process.env.WA_VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }
    return res.status(403).json({ error: 'Forbidden' });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = req.body;
    const entry = body?.entry?.[0];
    const changes = entry?.changes?.[0]?.value;
    if (!changes?.messages?.[0]) return res.status(200).json({ status: 'no message' });

    const msg = changes.messages[0];
    const contact = changes.contacts?.[0];
    const phone = msg.from;
    const name = contact?.profile?.name || null;
    const text = msg.text?.body || '';

    await logMessage(phone, 'in', text, null);

    if (/^(stop|unsubscribe|opt.?out)$/i.test(text.trim())) {
      await supabase.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.status(200).json({ status: 'opted_out' });
    }

    const esc = needsEscalation(text);
    if (esc.escalate) {
      await notifyMaddy(supabase, sendText, esc.reason, `Phone: ${maskPhone(phone)}, Msg: ${text.substring(0, 200)}`);
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    const { data: existingClient } = await supabase
      .from('clients')
      .select('id')
      .eq('phone', phone)
      .eq('status', 'active')
      .limit(1)
      .single();

    if (existingClient) {
      return res.status(200).json({ status: 'active_client', note: 'Handled by support flow' });
    }

    const market = detectMarket(phone);

    if (!existingLead) {
      const { data: newLead } = await supabase.from('leads').insert({
        phone,
        name,
        source: 'whatsapp',
        status: 'new',
        first_msg: text.substring(0, 1000),
        last_msg_at: new Date().toISOString(),
        market
      }).select().single();

      const welcome = isHinglish(market)
        ? "Hi! Maddy's team here. Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?"
        : "Hi! Welcome to Fitness by Maddy. What's your goal — fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?";

      await sendTemplate(phone, 'welcome_v1', [name || 'there']);

      return res.status(200).json({ status: 'new_lead', id: newLead?.id });
    }

    await supabase.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('id', existingLead.id);

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ status: 'dropped_lead' });
    }

    const program = routeProgram(text);
    if (program) {
      await supabase.from('leads').update({
        status: 'qualified',
        program_interest: program
      }).eq('id', existingLead.id);

      const programName = PROGRAM_NAMES[program];
      const checkoutPath = CHECKOUT_PATHS[program];
      const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${checkoutPath}`;
      const intakeUrl = `https://www.fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;

      const canSend = await checkRateLimit(phone, false);
      if (!canSend) return res.status(200).json({ status: 'rate_limited' });

      if (isHinglish(market)) {
        await sendText(phone,
          `Great choice! ${programName} aapke liye perfect hai.\n\n` +
          `Checkout karo: ${checkoutUrl}\n\n` +
          `Aur yeh form bhi fill karo taaki Maddy aapka plan bana sake: ${intakeUrl}`
        );
      } else {
        await sendText(phone,
          `Great choice! ${programName} sounds perfect for you.\n\n` +
          `Checkout here: ${checkoutUrl}\n\n` +
          `Also fill out this intake form so Maddy can build your plan: ${intakeUrl}`
        );
      }

      return res.status(200).json({ status: 'qualified', program });
    }

    return res.status(200).json({ status: 'message_logged' });

  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(200).json({ status: 'error_handled' });
  }
};
