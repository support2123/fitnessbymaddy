const ESCALATION_KEYWORDS = [
  'injury', 'injured', 'medical', 'condition', 'pregnancy', 'pregnant',
  'medication', 'medicine', 'pain', 'dizziness', 'dizzy', 'faint',
  'eating disorder', 'anorex', 'bulimi', 'purge', 'binge',
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'not working', 'scam', 'legal'
];

function needsEscalation(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, 4) + 'XXX...' + phone.slice(-3);
}

async function notifyMaddy(reason, details) {
  const MADDY_PHONE = '+917082478374';
  const apiKey = process.env.AISENSY_API_KEY;
  if (!apiKey) return;

  const body = {
    apiKey,
    campaignName: 'escalation_alert',
    destination: MADDY_PHONE,
    userName: 'System',
    templateParams: [
      reason,
      details.substring(0, 200)
    ]
  };

  try {
    await fetch('https://backend.aisensy.com/campaign/t1/api/v2', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
  } catch (err) {
    console.error('Escalation notification failed:', err.message);
  }
}

module.exports = { needsEscalation, maskPhone, notifyMaddy };
