const { sendTemplate, sendText, sendDocument, canSendToLead } = require('./lib/whatsapp');
const { cors, parseBody } = require('./lib/helpers');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const body = await parseBody(req);
  const { phone, type, template_name, params, text, document_url, caption, force } = body;

  if (!phone) return res.status(400).json({ error: 'phone required' });

  if (!force) {
    const canSend = await canSendToLead(phone);
    if (!canSend) {
      return res.status(429).json({ error: 'Rate limited — max 1 msg per 2hrs for leads' });
    }
  }

  let result;
  switch (type) {
    case 'template':
      if (!template_name) return res.status(400).json({ error: 'template_name required' });
      result = await sendTemplate(phone, template_name, params || []);
      break;

    case 'text':
      if (!text) return res.status(400).json({ error: 'text required' });
      result = await sendText(phone, text);
      break;

    case 'document':
      if (!document_url) return res.status(400).json({ error: 'document_url required' });
      result = await sendDocument(phone, document_url, caption || '');
      break;

    default:
      return res.status(400).json({ error: 'type must be template|text|document' });
  }

  return res.json({ success: true, result });
};
