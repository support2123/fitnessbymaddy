const { getSupabase } = require('../lib/supabase');
const { sendTemplate, logMessage, detectMarket, isHinglish, maskPhone } = require('../lib/whatsapp');
const { parseBody, json, cors, isOptOut, needsEscalation, detectProgram } = require('../lib/utils');
const { escalateToMaddy } = require('../lib/escalate');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return json(res, 200, { ok: true });
  if (req.method !== 'POST') return json(res, 405, { error: 'POST only' });

  const body = await parseBody(req);
  const phone = body.phone || body.sender || body.from || body.mobile;
  const text = body.message || body.text || body.body || '';

  if (!phone) return json(res, 400, { error: 'missing phone' });

  const db = getSupabase();
  const market = detectMarket(phone);
  const hinglish = isHinglish(market);

  await logMessage(phone, 'in', text, null);

  if (isOptOut(text)) {
    await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
    return json(res, 200, { action: 'opted_out' });
  }

  if (needsEscalation(text)) {
    await escalateToMaddy(
      'Sensitive keyword detected',
      `Phone: ${maskPhone(phone)}\nMessage: ${text}`
    );
  }

  const { data: existingLead } = await db
    .from('leads')
    .select('*')
    .eq('phone', phone)
    .single();

  if (!existingLead) {
    await db.from('leads').insert({
      phone,
      name: body.name || null,
      source: 'whatsapp',
      status: 'new',
      first_msg: text,
      last_msg_at: new Date().toISOString(),
      market,
    });

    const welcomeParams = hinglish
      ? ['Hi! Maddy\'s team here. Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?']
      : ['Hi! Welcome to Fitness by Maddy. What\'s your goal — fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?'];

    await sendTemplate(phone, 'welcome_v1', welcomeParams);

    return json(res, 200, { action: 'new_lead', market });
  }

  if (existingLead.status === 'dropped') {
    return json(res, 200, { action: 'ignored_dropped' });
  }

  await db.from('leads')
    .update({ last_msg_at: new Date().toISOString() })
    .eq('id', existingLead.id);

  const program = detectProgram(text);
  if (program && existingLead.status === 'new') {
    await db.from('leads')
      .update({ status: 'qualified', program_interest: program })
      .eq('id', existingLead.id);

    const programNames = {
      '6wk_gym': '6-Week Burn & Build',
      'pcos': 'PCOS Warrior Program',
      '40plus': '40+ Strong Program',
      '12wk': '12-Week Custom Flagship',
      'zoom_trial': '$20 Zoom Trial',
    };
    const programName = programNames[program] || program;

    const checkoutMsg = hinglish
      ? [`${programName} — perfect choice! Yeh raha checkout link: https://fitnessbymaddyy.exlyapp.com/checkout/${existingLead.id}\n\nIntake form bhi fill karo: https://fitnessbymaddy.com/intake.html?lead=${existingLead.id}`]
      : [`Great choice — ${programName}! Here's your checkout link: https://fitnessbymaddyy.exlyapp.com/checkout/${existingLead.id}\n\nPlease also fill out the intake form: https://fitnessbymaddy.com/intake.html?lead=${existingLead.id}`];

    await sendTemplate(phone, 'program_checkout', checkoutMsg);

    return json(res, 200, { action: 'qualified', program });
  }

  return json(res, 200, { action: 'reply_logged' });
};
