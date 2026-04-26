const AISENSY_API = 'https://backend.aisensy.com/campaign/t1/api/v2';

async function sendWhatsApp(phone, templateName, templateParams = [], mediaUrl = null) {
  const body = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: templateName,
    destination: phone,
    userName: 'FitnessByMaddy',
    templateParams,
  };
  if (mediaUrl) {
    body.mediaUrl = mediaUrl;
    body.mediaFilename = 'program.pdf';
  }

  const res = await fetch(AISENSY_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  return { ok: res.ok, data };
}

module.exports = { sendWhatsApp };
