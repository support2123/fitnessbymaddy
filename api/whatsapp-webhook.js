const { getClient } = require('../lib/supabase');
const { sendTemplate, sendText, sendToMaddy, logMessage } = require('../lib/whatsapp');
const { detectMarket, isHinglish, maskPhone } = require('../lib/market');
const { needsEscalation, getEscalationReason } = require('../lib/escalation');
const { canSendMessage } = require('../lib/rate-limit');

const PROGRAM_ROUTES = [
  { keys: ['fat loss', 'weight loss', 'weight', 'shred', 'lean', 'burn'], program: '6wk_gym', label: '6-Week Burn & Build' },
  { keys: ['pcos', 'hormonal', 'hormone', 'pcod'], program: 'pcos', label: 'PCOS Warrior' },
  { keys: ['40', 'menopause', 'joints', 'joint', 'senior', '40+', 'forty'], program: '40plus', label: '40+ Strong' },
  { keys: ['custom', '12 week', '12-week', 'serious', 'flagship', 'personalised', 'personalized'], program: '12wk', label: '12-Week Custom' },
  { keys: ['trial', 'zoom', 'not sure', 'try', 'test'], program: 'zoom_trial', label: 'Zoom Trial' },
  { keys: ['home', 'no gym', 'bodyweight', 'at home'], program: '6wk_home', label: '6-Week Home' }
];

const STOP_WORDS = ['stop', 'unsubscribe', 'opt out', 'optout', 'cancel'];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const sb = getClient();
  const payload = req.body;

  const phone = normalizePhone(payload.mobile || payload.phone || payload.from || '');
  const messageBody = (payload.message || payload.text || payload.body || '').trim();
  const senderName = payload.name || payload.pushName || null;

  if (!phone) return res.status(400).json({ error: 'No phone number' });

  await logMessage(phone, 'in', messageBody, null);

  if (STOP_WORDS.some(w => messageBody.toLowerCase().includes(w))) {
    await sb.from('leads').update({ status: 'dropped' }).eq('phone', phone);
    return res.status(200).json({ action: 'opted_out' });
  }

  if (needsEscalation(messageBody)) {
    const reason = getEscalationReason(messageBody);
    await sendToMaddy(
      `ESCALATION [${reason}]\nFrom: ${maskPhone(phone)}\nMessage: "${messageBody.substring(0, 200)}"`
    );
    const market = detectMarket(phone);
    const ack = isHinglish(market)
      ? 'Aapka message Maddy tak pahunch gaya hai. Woh jaldi aapse connect karengi.'
      : 'Your message has been forwarded to Maddy. She will get back to you shortly.';
    await sendText(phone, ack);
    return res.status(200).json({ action: 'escalated', reason });
  }

  const { data: existingLead } = await sb
    .from('leads')
    .select('*')
    .eq('phone', phone)
    .single();

  if (!existingLead) {
    return await handleNewLead(sb, phone, messageBody, senderName, res);
  }

  if (existingLead.status === 'dropped') {
    return res.status(200).json({ action: 'ignored_dropped' });
  }

  if (existingLead.status === 'converted') {
    return res.status(200).json({ action: 'already_converted' });
  }

  await sb.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('id', existingLead.id);

  return await handleQualification(sb, existingLead, messageBody, res);
};

async function handleNewLead(sb, phone, messageBody, name, res) {
  const market = detectMarket(phone);

  const { data: lead } = await sb.from('leads').insert({
    phone,
    name,
    source: 'whatsapp',
    status: 'new',
    first_msg: messageBody.substring(0, 500),
    last_msg_at: new Date().toISOString(),
    market,
    created_at: new Date().toISOString()
  }).select().single();

  const hinglish = isHinglish(market);

  await sendTemplate(phone, 'welcome_v1', {
    name: name || 'there',
    templateParams: hinglish
      ? ['there']
      : ['there']
  });

  return res.status(200).json({ action: 'new_lead', leadId: lead?.id });
}

async function handleQualification(sb, lead, message, res) {
  const lower = message.toLowerCase();
  const market = lead.market || detectMarket(lead.phone);
  const hinglish = isHinglish(market);

  let matched = null;
  for (const route of PROGRAM_ROUTES) {
    if (route.keys.some(k => lower.includes(k))) {
      matched = route;
      break;
    }
  }

  if (!matched) {
    const allowed = await canSendMessage(lead.phone, false);
    if (allowed) {
      const fallback = hinglish
        ? 'Koi baat nahi! Batao — fat loss, PCOS, 40+ fitness, ya 12-week custom program? Ya pehle $20 zoom trial try karna hai?'
        : 'No worries! What are you looking for — fat loss, PCOS support, 40+ fitness, 12-week custom, or a $20 zoom trial first?';
      await sendText(lead.phone, fallback);
    }
    return res.status(200).json({ action: 'awaiting_clear_intent' });
  }

  await sb.from('leads').update({
    status: 'qualified',
    program_interest: matched.program
  }).eq('id', lead.id);

  const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${lead.id}`;
  const intakeUrl = `https://www.fitnessbymaddy.com/intake.html?lead=${lead.id}`;

  const msg = hinglish
    ? `Great choice! ${matched.label} program aapke liye perfect hai.\n\nCheckout: ${checkoutUrl}\n\nPayment ke baad yeh form fill karo:\n${intakeUrl}`
    : `Great choice! The ${matched.label} program is perfect for your goals.\n\nCheckout here: ${checkoutUrl}\n\nAfter payment, fill out your intake form:\n${intakeUrl}`;

  await sendText(lead.phone, msg);

  return res.status(200).json({ action: 'qualified', program: matched.program });
}

function normalizePhone(raw) {
  let phone = raw.replace(/[^0-9+]/g, '');
  if (!phone.startsWith('+') && phone.length >= 10) {
    if (phone.startsWith('91') && phone.length >= 12) phone = '+' + phone;
    else if (phone.startsWith('971')) phone = '+' + phone;
    else if (phone.startsWith('44')) phone = '+' + phone;
    else phone = '+' + phone;
  }
  return phone;
}
