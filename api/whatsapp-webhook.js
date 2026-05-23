const { getSupabase } = require('./lib/supabase');
const { sendTemplate, logMessage, notifyMaddy } = require('./lib/whatsapp');
const { detectMarket, isHinglish, maskPhone } = require('./lib/market');
const { checkEscalation, checkOptOut } = require('./lib/escalation');

const PROGRAM_ROUTES = [
  { keywords: ['fat loss', 'weight', 'shred', 'lose', 'slim', 'patla'], program: '6wk_gym', name: '6-Week Burn & Build', price: '$97' },
  { keywords: ['pcos', 'hormonal', 'pcod', 'hormone'], program: 'pcos', name: 'PCOS Warrior', price: '$45' },
  { keywords: ['40', 'menopause', 'joints', 'joint', 'age'], program: '40plus', name: '40+ Strong', price: '$50' },
  { keywords: ['custom', '12 week', 'serious', 'flagship', 'advanced'], program: '12wk', name: '12-Week Flagship', price: '$200' },
  { keywords: ['trial', 'zoom', 'not sure', 'try', 'test', 'dekh'], program: 'zoom_trial', name: 'Zoom Trial', price: '$20' },
  { keywords: ['home', 'ghar', 'no gym', 'bodyweight'], program: '6wk_home', name: '6-Week Home Program', price: '$77' },
];

function routeToProgram(message) {
  if (!message) return null;
  const lower = message.toLowerCase();
  for (const route of PROGRAM_ROUTES) {
    if (route.keywords.some(k => lower.includes(k))) return route;
  }
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
    return res.status(200).json({ status: 'ok', service: 'whatsapp-webhook' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const payload = req.body;
    const phone = payload.phone || payload.from || payload.sender;
    const messageBody = payload.message || payload.text || payload.body || '';
    const senderName = payload.name || payload.pushName || null;

    if (!phone) {
      return res.status(400).json({ error: 'Missing phone' });
    }

    const sb = getSupabase();
    const market = detectMarket(phone);

    await logMessage(phone, 'in', messageBody, null);

    if (checkOptOut(messageBody)) {
      await sb.from('leads').update({ status: 'dropped', opted_out: true }).eq('phone', phone);
      console.log(`Opt-out: ${maskPhone(phone)}`);
      return res.status(200).json({ action: 'opted_out' });
    }

    const escalationTrigger = checkEscalation(messageBody);
    if (escalationTrigger) {
      await sb.from('escalations').insert({
        phone,
        reason: escalationTrigger,
        message_body: messageBody
      });
      await notifyMaddy(
        `Escalation keyword: "${escalationTrigger}"`,
        `From: ${maskPhone(phone)}\nMessage: ${messageBody.substring(0, 300)}`
      );
      return res.status(200).json({ action: 'escalated', trigger: escalationTrigger });
    }

    const { data: existingLead } = await sb
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      await sb.from('leads').insert({
        phone,
        name: senderName,
        source: 'whatsapp',
        status: 'new',
        first_msg: messageBody,
        last_msg_at: new Date().toISOString(),
        market
      });

      const templateName = isHinglish(market) ? 'welcome_v1_hi' : 'welcome_v1';
      await sendTemplate(phone, templateName, [senderName || 'there']);

      return res.status(200).json({ action: 'new_lead', market });
    }

    if (existingLead.opted_out) {
      return res.status(200).json({ action: 'ignored_opted_out' });
    }

    await sb.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('id', existingLead.id);

    if (existingLead.status === 'new') {
      const program = routeToProgram(messageBody);
      if (program) {
        await sb.from('leads').update({
          status: 'qualified',
          program_interest: program.program
        }).eq('id', existingLead.id);

        const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${program.program}`;
        const intakeUrl = `https://fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;

        if (isHinglish(market)) {
          await sendTemplate(phone, 'program_match_hi', [
            senderName || 'there',
            program.name,
            program.price,
            checkoutUrl,
            intakeUrl
          ]);
        } else {
          await sendTemplate(phone, 'program_match', [
            senderName || 'there',
            program.name,
            program.price,
            checkoutUrl,
            intakeUrl
          ]);
        }

        return res.status(200).json({ action: 'qualified', program: program.program });
      }
    }

    return res.status(200).json({ action: 'message_logged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
