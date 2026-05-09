const { sendWhatsApp, sendTextMessage } = require('./lib/whatsapp');
const { corsHeaders, parseBody } = require('./lib/helpers');

module.exports = async function handler(req, res) {
  corsHeaders(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    // Simple auth — require service key in header
    const authHeader = req.headers.authorization || '';
    if (authHeader !== `Bearer ${process.env.SUPABASE_SERVICE_KEY}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const body = await parseBody(req);
    const { phone, template_name, params, text, is_client } = body;

    if (!phone) return res.status(400).json({ error: 'phone required' });

    let result;
    if (template_name) {
      result = await sendWhatsApp(phone, template_name, params || [], !!is_client);
    } else if (text) {
      result = await sendTextMessage(phone, text, !!is_client);
    } else {
      return res.status(400).json({ error: 'template_name or text required' });
    }

    return res.status(result.success ? 200 : 429).json(result);
  } catch (err) {
    console.error('Send WA error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
