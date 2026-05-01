const { getSupabase } = require('./_lib/supabase');
const { sendTemplate, logMessage, maskPhone } = require('./_lib/whatsapp');
const { detectMarket, isHinglish } = require('./_lib/market');
const { needsEscalation, getEscalationReason, notifyMaddy } = require('./_lib/escalation');

const PROGRAM_ROUTES = {
  'fat loss': '6wk_gym',
  'weight': '6wk_gym',
  'shred': '6wk_gym',
  'lose': '6wk_gym',
  'burn': '6wk_gym',
  'pcos': 'pcos',
  'hormonal': 'pcos',
  'hormone': 'pcos',
  '40': '40plus',
  'menopause': '40plus',
  'joints': '40plus',
  'joint': '40plus',
  'custom': '12wk',
  '12 week': '12wk',
  'serious': '12wk',
  'personalised': '12wk',
  'personalized': '12wk',
  'trial': 'zoom_trial',
  'zoom': 'zoom_trial',
  'not sure': 'zoom_trial',
  'try': 'zoom_trial',
};

const PROGRAM_NAMES = {
  '6wk_gym': '6-Week Burn & Build',
  '6wk_home': '6-Week Home Shred',
  '12wk': '12-Week Custom Program',
  'pcos': 'PCOS Warrior Program',
  '40plus': '40+ Strong Program',
  'zoom_trial': 'Zoom Trial Session',
};

const CHECKOUT_LINKS = {
  '6wk_gym': 'https://fitnessbymaddyy.exlyapp.com/checkout/6wk-burn',
  '6wk_home': 'https://fitnessbymaddyy.exlyapp.com/checkout/6wk-home',
  '12wk': 'https://fitnessbymaddyy.exlyapp.com/checkout/12wk-custom',
  'pcos': 'https://fitnessbymaddyy.exlyapp.com/checkout/pcos-warrior',
  '40plus': 'https://fitnessbymaddyy.exlyapp.com/checkout/40plus-strong',
  'zoom_trial': 'https://fitnessbymaddyy.exlyapp.com/checkout/zoom-trial',
};

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const body = req.body;
    const phone = body.mobile || body.from || body.sender;
    const message = body.message || body.text || body.body || '';
    const name = body.name || body.pushName || null;

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    const db = getSupabase();
    const market = detectMarket(phone);

    await logMessage(phone, 'in', message, null);

    // Check opt-out
    const lower = message.toLowerCase().trim();
    if (lower === 'stop' || lower === 'unsubscribe') {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      await db.from('clients').update({ status: 'paused' }).eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    // Check escalation
    if (needsEscalation(message)) {
      const reason = getEscalationReason(message);
      await notifyMaddy('WhatsApp message', maskPhone(phone), reason);
      return res.status(200).json({ action: 'escalated', reason });
    }

    // Check if existing lead
    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      // FLOW A: New lead
      await db.from('leads').insert({
        phone,
        name,
        source: 'whatsapp',
        status: 'new',
        first_msg: message,
        last_msg_at: new Date().toISOString(),
        market,
      });

      const templateName = isHinglish(market) ? 'welcome_v1_hi' : 'welcome_v1';
      await sendTemplate(phone, templateName, [name || 'there']);

      return res.status(200).json({ action: 'new_lead', market });
    }

    // Update last message
    await db.from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('id', existingLead.id);

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'dropped_lead_ignored' });
    }

    // FLOW B: Lead qualification — route based on keywords
    if (existingLead.status === 'new') {
      let matchedProgram = null;
      for (const [keyword, program] of Object.entries(PROGRAM_ROUTES)) {
        if (lower.includes(keyword)) {
          matchedProgram = program;
          break;
        }
      }

      if (matchedProgram) {
        await db.from('leads')
          .update({ status: 'qualified', program_interest: matchedProgram })
          .eq('id', existingLead.id);

        const programName = PROGRAM_NAMES[matchedProgram];
        const checkoutLink = CHECKOUT_LINKS[matchedProgram];
        const intakeLink = `https://fitnessbymaddy.com/intake?lead=${existingLead.id}`;

        if (isHinglish(market)) {
          await sendTemplate(phone, 'program_match_hi', [
            name || 'there',
            programName,
            checkoutLink,
            intakeLink,
          ]);
        } else {
          await sendTemplate(phone, 'program_match', [
            name || 'there',
            programName,
            checkoutLink,
            intakeLink,
          ]);
        }

        return res.status(200).json({ action: 'qualified', program: matchedProgram });
      }

      // No keyword match — send default reply pushing trial
      const trialLink = CHECKOUT_LINKS['zoom_trial'];
      await sendTemplate(phone, isHinglish(market) ? 'nudge_trial_hi' : 'nudge_trial', [
        name || 'there',
        trialLink,
      ]);

      return res.status(200).json({ action: 'no_match_nudged' });
    }

    return res.status(200).json({ action: 'existing_lead', status: existingLead.status });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
