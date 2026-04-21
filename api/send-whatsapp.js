const { sendWhatsApp, sendFreeformWhatsApp } = require('./lib/whatsapp');
const { cors, parseBody } = require('./lib/helpers');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (!authHeader || authHeader !== `Bearer ${process.env.INTERNAL_API_KEY || process.env.SUPABASE_SERVICE_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const body = await parseBody(req);
  const { phone, template_name, params, message, media_url } = body;

  if (!phone) return res.status(400).json({ error: 'Missing phone' });

  let result;
  if (template_name) {
    result = await sendWhatsApp({
      phone,
      templateName: template_name,
      params: params || [],
      mediaUrl: media_url,
    });
  } else if (message) {
    result = await sendFreeformWhatsApp({ phone, message });
  } else {
    return res.status(400).json({ error: 'Provide template_name or message' });
  }

  return res.status(200).json(result);
};
