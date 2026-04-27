const { canSendToLead, sendTemplate, sendText, sendDocument } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { phone, type, template_name, params, text, document_url, caption, is_client } = req.body;

    if (!phone) return res.status(400).json({ error: 'phone required' });

    // Rate-limit check for non-clients
    if (!is_client) {
      const allowed = await canSendToLead(phone);
      if (!allowed) {
        return res.status(429).json({ error: 'Rate limited — max 1 msg per 2 hrs for leads' });
      }
    }

    let result;
    if (type === 'template' && template_name) {
      result = await sendTemplate(phone, template_name, params || []);
    } else if (type === 'document' && document_url) {
      result = await sendDocument(phone, document_url, caption || '');
    } else if (text) {
      result = await sendText(phone, text);
    } else {
      return res.status(400).json({ error: 'Provide text, template, or document' });
    }

    return res.json({ success: true, result });

  } catch (err) {
    console.error('Send WA error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
