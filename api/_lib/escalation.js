const TRIGGER_KEYWORDS = [
  'eating disorder',
  'side effect',
  "didn't work",
  'not working',
  'anorexia',
  'bulimia',
  'pregnant',
  'pregnancy',
  'medication',
  'medicine',
  'dizziness',
  'complaint',
  'medical',
  'injury',
  'refund',
  'lawyer',
  'dizzy',
  'pain',
];

function checkEscalation(messageBody) {
  const lower = (messageBody || '').toLowerCase();

  for (const keyword of TRIGGER_KEYWORDS) {
    if (lower.includes(keyword)) {
      const reason = `Message contains sensitive keyword: "${keyword}"`;
      notifyMaddy(reason, null).catch(() => {});
      return { needsEscalation: true, reason };
    }
  }

  return { needsEscalation: false, reason: '' };
}

async function notifyMaddy(reason, phone) {
  const maddyPhone = process.env.MADDY_PHONE;
  if (!maddyPhone) return;

  const apiKey = process.env.AISENSY_API_KEY;
  if (!apiKey) return;

  const payload = {
    apiKey,
    campaignName: 'escalation_alert',
    destination: maddyPhone,
    userName: 'Maddy',
    templateParams: [
      reason,
      phone || 'unknown',
    ],
    source: 'fitnessbymaddy',
  };

  try {
    await fetch('https://backend.aisensy.com/campaign/t1/api/v2', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.error('Failed to notify Maddy for escalation:', err.message);
  }
}

module.exports = { checkEscalation };
