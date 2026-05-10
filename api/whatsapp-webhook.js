const { getSupabase } = require('../lib/supabase');
const { sendTemplate, maskPhone, detectMarket } = require('../lib/whatsapp');
const { detectProgram, needsEscalation, isOptOut, isHinglish, cors, parseBody } = require('../lib/helpers');
const { escalateToMaddy } = require('../lib/escalate');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const supabase = getSupabase();

  let body;
  try {
    body = await parseBody(req);
  } catch {
    return res.status(400).json({ error: 'Invalid body' });
  }

  const phone = body.senderPhone || body.from || body.waId || '';
  const text = body.text || body.message || body.body || '';
  const senderName = body.senderName || body.pushName || '';

  if (!phone) return res.status(400).json({ error: 'No phone number' });

  await supabase.from('messages').insert({
    phone: maskPhone(phone),
    direction: 'in',
    body: text.substring(0, 500),
    template_name: null,
    sent_at: new Date().toISOString(),
    status: 'received',
  });

  if (isOptOut(text)) {
    await supabase
      .from('leads')
      .update({ status: 'dropped' })
      .eq('phone', phone);
    return res.status(200).json({ action: 'opted_out' });
  }

  if (needsEscalation(text)) {
    await escalateToMaddy('Sensitive keyword detected', { phone: maskPhone(phone), text }, { supabase });
  }

  const { data: existingLead } = await supabase
    .from('leads')
    .select('*')
    .eq('phone', phone)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (!existingLead) {
    const market = detectMarket(phone);
    const { data: newLead } = await supabase
      .from('leads')
      .insert({
        phone,
        name: senderName,
        source: 'whatsapp',
        status: 'new',
        first_msg: text.substring(0, 500),
        last_msg_at: new Date().toISOString(),
        market,
        created_at: new Date().toISOString(),
      })
      .select()
      .single();

    const hinglish = isHinglish(market);

    await sendTemplate(phone, 'welcome_v1', [
      senderName || 'there',
    ], { supabase });

    scheduleNudge(phone, newLead?.id, supabase);

    return res.status(200).json({ action: 'new_lead', id: newLead?.id });
  }

  if (existingLead.status === 'dropped') {
    return res.status(200).json({ action: 'ignored_dropped' });
  }

  await supabase
    .from('leads')
    .update({ last_msg_at: new Date().toISOString() })
    .eq('id', existingLead.id);

  const program = detectProgram(text);
  if (program && existingLead.status === 'new') {
    await supabase
      .from('leads')
      .update({
        status: 'qualified',
        program_interest: program,
      })
      .eq('id', existingLead.id);

    const market = existingLead.market || detectMarket(phone);
    const hinglish = isHinglish(market);

    const checkoutParam = encodeURIComponent(program);
    const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${checkoutParam}`;
    const intakeUrl = `https://www.fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;

    const programNames = {
      '6wk_gym': '6-Week Burn & Build',
      'pcos': 'PCOS Warrior Program',
      '40plus': '40+ Strong Program',
      '12wk': '12-Week Custom Training',
      'zoom_trial': '$20 Zoom Trial',
    };

    await sendTemplate(phone, 'program_offer', [
      senderName || existingLead.name || 'there',
      programNames[program] || program,
      checkoutUrl,
      intakeUrl,
    ], { supabase });

    return res.status(200).json({ action: 'qualified', program });
  }

  return res.status(200).json({ action: 'acknowledged' });
};

async function scheduleNudge(phone, leadId, supabase) {
  // Nudge scheduling is handled by the cron job /api/cron/nudge-dropped
  // which checks leads with status=new and no reply within time windows
}
