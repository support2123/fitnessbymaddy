const { getSupabase } = require('./_lib/supabase');
const { sendTemplate, sendText, maskPhone, detectMarket } = require('./_lib/whatsapp');
const { needsEscalation, getEscalationReason, isOptOut, MADDY_PHONE } = require('./_lib/escalation');
const { canSendMessage, logMessage } = require('./_lib/rate-limit');

const PROGRAM_ROUTES = [
  { keywords: ['fat loss', 'weight', 'shred', 'fat', 'lose weight', 'slim'], program: '6wk_gym', label: '6-Week Burn & Build' },
  { keywords: ['pcos', 'hormonal', 'hormone', 'period', 'irregular'], program: 'pcos', label: 'PCOS Warrior' },
  { keywords: ['40', 'menopause', 'joints', 'joint', 'knee', 'back pain', '40+', 'forty'], program: '40plus', label: '40+ Strong' },
  { keywords: ['custom', '12 week', '12wk', 'serious', 'flagship', 'personalised', 'personalized'], program: '12wk', label: '12-Week Flagship' },
  { keywords: ['trial', 'zoom', 'not sure', 'try', 'test'], program: 'zoom_trial', label: 'Zoom Trial' }
];

function routeToProgram(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  for (const route of PROGRAM_ROUTES) {
    if (route.keywords.some(kw => lower.includes(kw))) return route;
  }
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = req.body;
    const phone = body.mobile || body.phone || body.from || '';
    const messageText = body.message || body.text || body.body || '';
    const senderName = body.name || body.pushName || '';

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    const db = getSupabase();
    const market = detectMarket(phone);

    await logMessage(phone, 'in', messageText, null);

    if (isOptOut(messageText)) {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      console.log(`Opt-out: ${maskPhone(phone)}`);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(messageText)) {
      const reason = getEscalationReason(messageText);
      await sendTemplate(MADDY_PHONE, 'escalation_alert', [
        maskPhone(phone),
        reason,
        messageText.slice(0, 200)
      ]);
      await logMessage(MADDY_PHONE, 'out', `ESCALATION: ${reason} from ${maskPhone(phone)}`, 'escalation_alert');
      console.log(`Escalation triggered for ${maskPhone(phone)}: ${reason}`);
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      await db.from('leads').insert({
        phone,
        name: senderName || null,
        source: 'whatsapp',
        status: 'new',
        first_msg: messageText,
        last_msg_at: new Date().toISOString(),
        market
      });

      const welcomeMsg = market === 'IN'
        ? 'Hi! Maddy\'s team here. Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?'
        : 'Hi! Maddy\'s team here. What\'s your goal — fat loss, PCOS management, strength, or 40+ fitness? Or try a trial session first?';

      if (await canSendMessage(phone)) {
        await sendTemplate(phone, 'welcome_v1', [senderName || 'there']);
        await logMessage(phone, 'out', welcomeMsg, 'welcome_v1');
      }

      return res.status(200).json({ action: 'new_lead', market });
    }

    await db.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('phone', phone);

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'lead_dropped_ignored' });
    }

    if (existingLead.status === 'new') {
      const route = routeToProgram(messageText);
      if (route) {
        await db.from('leads').update({
          status: 'qualified',
          program_interest: route.program
        }).eq('phone', phone);

        if (await canSendMessage(phone)) {
          const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${existingLead.id}`;
          const intakeUrl = `https://www.fitnessbymaddy.com/intake?lead=${existingLead.id}`;

          const msg = market === 'IN'
            ? `Great choice! ${route.label} program perfect hai aapke liye. Yahan se start karo:\n\nCheckout: ${checkoutUrl}\n\nIntake form bhi fill karo: ${intakeUrl}`
            : `Great choice! The ${route.label} program is perfect for you. Get started here:\n\nCheckout: ${checkoutUrl}\n\nAlso fill out your intake form: ${intakeUrl}`;

          await sendText(phone, msg);
          await logMessage(phone, 'out', msg, null);
        }

        return res.status(200).json({ action: 'qualified', program: route.program });
      }

      if (!(await canSendMessage(phone))) {
        return res.status(200).json({ action: 'rate_limited' });
      }

      const clarifyMsg = market === 'IN'
        ? 'Thoda aur batao — kya goal hai? Fat loss, PCOS, 40+ fitness, ya full 12-week custom program? Ya pehle $20 trial try karoge?'
        : 'Tell me more — what\'s your goal? Fat loss, PCOS, 40+ fitness, or a full 12-week custom program? Or try the $20 trial first?';

      await sendText(phone, clarifyMsg);
      await logMessage(phone, 'out', clarifyMsg, null);

      return res.status(200).json({ action: 'clarification_sent' });
    }

    return res.status(200).json({ action: 'existing_lead', status: existingLead.status });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
