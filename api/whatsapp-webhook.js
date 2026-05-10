const supabase = require('./_lib/supabase');
const { sendTemplate, logMessage } = require('./_lib/whatsapp');
const { detectMarket, isHinglish } = require('./_lib/market');
const { needsEscalation, escalate } = require('./_lib/escalation');

const PROGRAM_MAP = {
  'fat loss': '6wk_gym', weight: '6wk_gym', shred: '6wk_gym', burn: '6wk_gym',
  pcos: 'pcos', hormonal: 'pcos',
  '40': '40plus', menopause: '40plus', joints: '40plus',
  custom: '12wk', '12 week': '12wk', serious: '12wk', flagship: '12wk',
  trial: 'zoom_trial', zoom: 'zoom_trial', 'not sure': 'zoom_trial',
  home: '6wk_home',
};

const PROGRAM_NAMES = {
  '6wk_gym': '6-Week Burn & Build (Gym)',
  '6wk_home': '6-Week Burn & Build (Home)',
  '12wk': '12-Week Custom Flagship',
  pcos: 'PCOS Warrior Program',
  '40plus': '40+ Strong Program',
  zoom_trial: 'Zoom Trial Session',
  zoom_pack: 'Zoom Pack',
};

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const payload = req.body;
    const phone = normalizePhone(payload.mobile || payload.from || payload.senderMobile || '');
    const msgBody = (payload.message || payload.text || payload.body || '').trim();

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    await logMessage(phone, 'in', msgBody, null);

    if (isOptOut(msgBody)) {
      await supabase.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.json({ action: 'opted_out' });
    }

    if (needsEscalation(msgBody)) {
      await escalate(phone, 'keyword_trigger', msgBody);
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .maybeSingle();

    if (!existingLead) {
      return await handleNewLead(phone, msgBody, res);
    }

    if (existingLead.status === 'dropped') {
      return res.json({ action: 'ignored_dropped' });
    }

    if (existingLead.status === 'new') {
      return await handleQualification(existingLead, msgBody, res);
    }

    await supabase.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('id', existingLead.id);
    return res.json({ action: 'updated' });
  } catch (err) {
    console.error('Webhook error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function handleNewLead(phone, msgBody, res) {
  const market = detectMarket(phone);

  const { data: lead } = await supabase.from('leads').insert({
    phone,
    source: 'whatsapp',
    status: 'new',
    first_msg: msgBody.substring(0, 500),
    last_msg_at: new Date().toISOString(),
    market,
  }).select().single();

  if (isHinglish(market)) {
    await sendTemplate(phone, 'welcome_v1', [
      "Hi! Maddy's team here. Kaun sa goal hai - fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?"
    ]);
  } else {
    await sendTemplate(phone, 'welcome_v1', [
      "Hi! Maddy's team here. What's your goal - fat loss, PCOS management, strength, or 40+ fitness? Or want to try a trial session first?"
    ]);
  }

  return res.json({ action: 'new_lead', lead_id: lead.id });
}

async function handleQualification(lead, msgBody, res) {
  const lower = msgBody.toLowerCase();
  let matchedProgram = null;

  for (const [keyword, program] of Object.entries(PROGRAM_MAP)) {
    if (lower.includes(keyword)) {
      matchedProgram = program;
      break;
    }
  }

  if (!matchedProgram) {
    matchedProgram = 'zoom_trial';
  }

  await supabase.from('leads').update({
    status: 'qualified',
    program_interest: matchedProgram,
    last_msg_at: new Date().toISOString(),
  }).eq('id', lead.id);

  const programName = PROGRAM_NAMES[matchedProgram] || matchedProgram;
  const hin = isHinglish(lead.market);

  const msg = hin
    ? `Great choice! ${programName} aapke liye perfect hai. Yeh raha checkout link aur intake form - dono fill kar do toh hum turant start kar sakte hain!`
    : `Great choice! ${programName} is perfect for you. Here's your checkout link and intake form - complete both and we'll get you started right away!`;

  await sendTemplate(lead.phone, 'program_qualified', [
    msg,
    `https://fitnessbymaddyy.exlyapp.com/checkout/${lead.id}`,
    `https://fitnessbymaddy.com/intake.html?lead=${lead.id}`,
  ]);

  return res.json({ action: 'qualified', program: matchedProgram });
}

function normalizePhone(phone) {
  let p = phone.replace(/[\s\-\(\)]/g, '');
  if (p && !p.startsWith('+')) p = '+' + p;
  return p || null;
}

function isOptOut(msg) {
  if (!msg) return false;
  const lower = msg.toLowerCase().trim();
  return lower === 'stop' || lower === 'unsubscribe' || lower === 'opt out' || lower === 'optout';
}
