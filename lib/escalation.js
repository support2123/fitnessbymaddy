const { supabase } = require('./supabase');

const MADDY_PHONE = '917082478374';

const ESCALATION_KEYWORDS = [
  'injury', 'injured', 'medical', 'condition', 'pregnancy', 'pregnant',
  'medication', 'medicine', 'pain', 'dizziness', 'dizzy', 'eating disorder',
  'anorexia', 'bulimia', 'purge', 'refund', 'lawyer', 'complaint',
  "didn't work", 'side effect', 'side effects'
];

function needsEscalation(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

function isOptOut(text) {
  if (!text) return false;
  const lower = text.trim().toLowerCase();
  return lower === 'stop' || lower === 'unsubscribe';
}

async function notifyMaddy(reason, phone, context) {
  const masked = maskPhone(phone);
  const body = `ESCALATION: ${reason} | Lead: ${masked} | ${context || 'No details'}`;

  await supabase.from('messages').insert({
    phone: MADDY_PHONE,
    direction: 'out',
    body,
    template_name: 'escalation_alert',
    status: 'pending'
  });

  try {
    const response = await fetch('https://backend.aisensy.com/campaign/t1/api/v2', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-AiSensy-Project-API-Pwd': process.env.AISENSY_API_KEY
      },
      body: JSON.stringify({
        apiKey: process.env.AISENSY_API_KEY,
        campaignName: 'escalation_alert',
        destination: MADDY_PHONE,
        userName: 'System',
        templateParams: [reason, masked, (context || '').slice(0, 200)],
        source: 'automation'
      })
    });

    await supabase.from('messages')
      .update({ status: response.ok ? 'sent' : 'failed' })
      .eq('phone', MADDY_PHONE)
      .eq('body', body);
  } catch (err) {
    console.error('Failed to notify Maddy:', err.message);
  }
}

function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, 3) + 'XXX...' + phone.slice(-3);
}

module.exports = { needsEscalation, isOptOut, notifyMaddy, maskPhone, MADDY_PHONE };
