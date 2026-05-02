const supabase = require('./supabase');

const AISENSY_URL = 'https://backend.aisensy.com/campaign/t1/api/v2';

function maskPhone(phone) {
  if (phone.length <= 6) return phone;
  return phone.slice(0, 3) + 'XXX...' + phone.slice(-3);
}

async function isActiveClient(phone) {
  const { data } = await supabase
    .from('clients')
    .select('id')
    .eq('phone', phone)
    .eq('status', 'active')
    .maybeSingle();
  return !!data;
}

async function checkRateLimit(phone) {
  const active = await isActiveClient(phone);
  if (active) return true;

  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const { data } = await supabase
    .from('messages')
    .select('id')
    .eq('phone', phone)
    .eq('direction', 'out')
    .gte('created_at', twoHoursAgo)
    .limit(1);

  return !data || data.length === 0;
}

async function logMessage(phone, direction, content, templateName) {
  const row = { phone, direction, content };
  if (templateName) row.template_name = templateName;
  const { data, error } = await supabase
    .from('messages')
    .insert(row)
    .select('id')
    .single();
  if (error) console.error('Failed to log message:', error.message);
  return data?.id;
}

async function sendTemplate(phone, templateName, params) {
  const masked = maskPhone(phone);

  const allowed = await checkRateLimit(phone);
  if (!allowed) {
    console.log(`Rate limited: skipping template "${templateName}" to ${masked}`);
    return { success: false, messageId: null };
  }

  const body = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: templateName,
    destination: phone,
    userName: 'FitnessByMaddy',
    templateParams: params,
  };

  console.log(`Sending template "${templateName}" to ${masked}`);

  const res = await fetch(AISENSY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const success = res.ok;
  if (!success) {
    const errText = await res.text();
    console.error(`Template send failed for ${masked}:`, errText);
  }

  const messageId = await logMessage(
    phone,
    'out',
    `[template:${templateName}] ${JSON.stringify(params)}`,
    templateName
  );

  return { success, messageId };
}

async function sendText(phone, text) {
  const masked = maskPhone(phone);

  const allowed = await checkRateLimit(phone);
  if (!allowed) {
    console.log(`Rate limited: skipping text to ${masked}`);
    return { success: false, messageId: null };
  }

  const body = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: 'text_message',
    destination: phone,
    userName: 'FitnessByMaddy',
    message: text,
  };

  console.log(`Sending text to ${masked}`);

  const res = await fetch(AISENSY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const success = res.ok;
  if (!success) {
    const errText = await res.text();
    console.error(`Text send failed for ${masked}:`, errText);
  }

  const messageId = await logMessage(phone, 'out', text);

  return { success, messageId };
}

module.exports = { sendTemplate, sendText, maskPhone };
