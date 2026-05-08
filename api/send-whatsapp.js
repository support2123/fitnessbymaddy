const { sendTemplate, sendMessage, sendDocument } = require('../lib/whatsapp');
const { parseBody, handleCors } = require('../lib/helpers');

// Internal helper endpoint for sending WhatsApp messages
// Protected by checking for internal auth header
module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  // Simple internal auth check
  const authHeader = req.headers['x-internal-key'];
  if (authHeader !== process.env.SUPABASE_SERVICE_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const body = await parseBody(req);
  const { phone, type, template_name, params, message, document_url, caption } = body;

  if (!phone) {
    return res.status(400).json({ error: 'phone required' });
  }

  let result;

  switch (type) {
    case 'template':
      if (!template_name) return res.status(400).json({ error: 'template_name required' });
      result = await sendTemplate(phone, template_name, params || []);
      break;

    case 'message':
      if (!message) return res.status(400).json({ error: 'message required' });
      result = await sendMessage(phone, message);
      break;

    case 'document':
      if (!document_url) return res.status(400).json({ error: 'document_url required' });
      result = await sendDocument(phone, document_url, caption || '');
      break;

    default:
      return res.status(400).json({ error: 'type must be template, message, or document' });
  }

  return res.status(200).json(result);
};
