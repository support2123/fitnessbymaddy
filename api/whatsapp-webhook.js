const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp, maskPhone } = require('../lib/whatsapp');
const { detectMarket, classifyIntent, programLabel, json, parseBody } = require('../lib/utils');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return json(res, { ok: true });
  if (req.method !== 'POST') return json(res, { error: 'POST only' }, 405);

  const body = await parseBody(req);
  const phone = body.mobile || body.from || body.senderMobile || '';
  const text = body.text || body.message || body.body || '';
  const name = body.name || body.senderName || '';

  if (!phone) return json(res, { error: 'no phone' }, 400);

  const db = getSupabase();

  await db.from('messages').insert({
    phone: maskPhone(phone),
    direction: 'in',
    body: text,
    status: 'received',
  });

  const intent = classifyIntent(text);

  if (intent === 'STOP') {
    await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
    await db.from('clients').update({ status: 'paused' }).eq('phone', phone);
    return json(res, { action: 'opted_out' });
  }

  if (intent === 'ESCALATION') {
    await notifyMaddy(db, phone, text);
    return json(res, { action: 'escalated' });
  }

  const { data: existingLead } = await db
    .from('leads')
    .select('*')
    .eq('phone', phone)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (existingLead) {
    await db.from('leads').update({
      last_msg_at: new Date().toISOString(),
      first_msg: existingLead.first_msg || text,
    }).eq('id', existingLead.id);

    if (existingLead.status === 'dropped') {
      return json(res, { action: 'lead_dropped_no_reply' });
    }

    if (intent && existingLead.status === 'new') {
      await handleQualification(db, existingLead, intent, phone, name);
      return json(res, { action: 'qualified', program: intent });
    }

    return json(res, { action: 'existing_lead_updated' });
  }

  const market = detectMarket(phone);
  const { data: newLead } = await db.from('leads').insert({
    phone,
    name: name || null,
    source: 'whatsapp',
    status: 'new',
    first_msg: text,
    market,
  }).select().single();

  const isHinglish = market === 'IN';
  await sendWhatsApp(phone, 'welcome_v1', {
    name: name || 'there',
    templateParams: isHinglish
      ? [name || 'there']
      : [name || 'there'],
  });

  scheduleNudge(phone, newLead?.id);

  if (intent) {
    await handleQualification(db, newLead, intent, phone, name);
    return json(res, { action: 'new_lead_qualified', program: intent });
  }

  return json(res, { action: 'new_lead_created', id: newLead?.id });
};

async function handleQualification(db, lead, intent, phone, name) {
  const programMap = {
    '6wk': '6wk_gym',
    pcos: 'pcos',
    '40plus': '40plus',
    '12wk': '12wk',
    zoom_trial: 'zoom_trial',
  };
  const program = programMap[intent] || intent;

  await db.from('leads').update({
    status: 'qualified',
    program_interest: program,
  }).eq('id', lead.id);

  const market = detectMarket(phone);
  const isHinglish = market === 'IN';

  await sendWhatsApp(phone, 'program_info', {
    name: name || lead.name || 'there',
    templateParams: [
      name || lead.name || 'there',
      programLabel(program),
      `https://fitnessbymaddyy.exlyapp.com/checkout/${lead.id}`,
      `https://fitnessbymaddy.com/intake.html?lead=${lead.id}`,
    ],
  });
}

async function notifyMaddy(db, phone, text) {
  const masked = maskPhone(phone);
  await sendWhatsApp(process.env.MADDY_PHONE || '+917082478374', 'escalation_alert', {
    name: 'Maddy',
    templateParams: [
      masked,
      text.substring(0, 200),
      new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
    ],
  });

  await db.from('messages').insert({
    phone: masked,
    direction: 'out',
    body: `ESCALATION: ${text.substring(0, 200)}`,
    template_name: 'escalation_alert',
    status: 'sent',
  });
}

function scheduleNudge(phone, leadId) {
  // Nudge scheduling handled by the cron job /api/cron/nudge-dropped
  // which checks leads with status='new' and no reply after 2hrs/24hrs
}
