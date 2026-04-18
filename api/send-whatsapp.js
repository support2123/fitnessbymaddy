const { sendTemplate, sendText } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  var authHeader = req.headers.authorization;
  if (authHeader !== 'Bearer ' + process.env.INTERNAL_API_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    var body = req.body;
    if (!body.phone) return res.status(400).json({ error: 'Missing phone' });

    var result;
    if (body.type === 'template' && body.template_name) {
      result = await sendTemplate(body.phone, body.template_name, body.params || [], !!body.is_client);
    } else if (body.type === 'text' && body.text) {
      result = await sendText(body.phone, body.text, !!body.is_client);
    } else {
      return res.status(400).json({ error: 'Need type=template with template_name, or type=text with text' });
    }

    return res.status(200).json(result);
  } catch (err) {
    console.error('Send WA error:', err.message);
    return res.status(500).json({ error: 'Failed to send' });
  }
};
