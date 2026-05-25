const { getClient } = require('../lib/supabase');
const { sendTemplate, maskPhone } = require('../lib/whatsapp');
const { detectMarket, isHinglish } = require('../lib/market');
const { needsEscalation, isOptOut, escalateToMaddy } = require('../lib/escalation');
const { canSendMessage, logMessage } = require('../lib/rate-limit');

const PROGRAM_KEYWORDS = {
  '6wk_gym': ['fat loss', 'weight loss', 'shred', 'weight', 'burn', 'lean'],
  'pcos': ['pcos', 'hormonal', 'hormone', 'irregular period'],
  '40plus': ['40', 'forty', 'menopause', 'joints', 'joint pain', 'over 40'],
  '12wk': ['custom', '12 week', 'serious', 'flagship', 'personalised', 'personalized'],
  'zoom_trial': ['trial', 'zoom', 'not sure', 'try', 'test'],
};

function classifyIntent(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  for (const [program, keywords] of Object.entries(PROGRAM_KEYWORDS)) {
    if (keywords.some((kw) => lower.includes(kw))) return program;
  }
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const db = getClient();
  const body = req.body;

  const phone = body.phone || body.from || body.senderPhone || '';
  const messageText = body.message || body.text || body.body || '';
  const senderName = body.name || body.senderName || '';

  if (!phone) return res.status(400).json({ error: 'No phone number' });

  console.log(`Incoming WA from ${maskPhone(phone)}`);

  await logMessage(phone, 'in', messageText, null);

  if (isOptOut(messageText)) {
    await db
      .from('leads')
      .update({ status: 'dropped', last_msg_at: new Date().toISOString() })
      .eq('phone', phone);
    return res.status(200).json({ action: 'opted_out' });
  }

  if (needsEscalation(messageText)) {
    await escalateToMaddy('Keyword trigger in message', phone, messageText);
  }

  const { data: existingLead } = await db
    .from('leads')
    .select('*')
    .eq('phone', phone)
    .single();

  const market = detectMarket(phone);
  const hinglish = isHinglish(market);

  if (!existingLead) {
    const { data: newLead } = await db
      .from('leads')
      .insert({
        phone,
        name: senderName || null,
        source: 'whatsapp',
        status: 'new',
        first_msg: messageText,
        last_msg_at: new Date().toISOString(),
        market,
        created_at: new Date().toISOString(),
      })
      .select()
      .single();

    const templateName = hinglish ? 'welcome_v1_hi' : 'welcome_v1';
    await sendTemplate(phone, templateName, [senderName || 'there']);
    await logMessage(phone, 'out', 'Welcome template sent', templateName);

    return res.status(200).json({ action: 'new_lead', id: newLead?.id });
  }

  if (existingLead.status === 'dropped') {
    return res.status(200).json({ action: 'ignored_dropped' });
  }

  await db
    .from('leads')
    .update({ last_msg_at: new Date().toISOString() })
    .eq('id', existingLead.id);

  const program = classifyIntent(messageText);
  if (program && existingLead.status === 'new') {
    await db
      .from('leads')
      .update({ status: 'qualified', program_interest: program })
      .eq('id', existingLead.id);

    const allowed = await canSendMessage(phone);
    if (allowed) {
      const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${existingLead.id}`;
      const intakeUrl = `https://www.fitnessbymaddy.com/intake?lead=${existingLead.id}`;

      const templateName = hinglish ? 'qualified_reply_hi' : 'qualified_reply';
      await sendTemplate(phone, templateName, [
        senderName || 'there',
        program,
        checkoutUrl,
        intakeUrl,
      ]);
      await logMessage(phone, 'out', `Qualified: ${program}`, templateName);
    }

    return res.status(200).json({ action: 'qualified', program });
  }

  return res.status(200).json({ action: 'message_logged' });
};
