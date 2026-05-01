const { cors } = require('../lib/helpers');
const { sendTemplate, sendText } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const authHeader = req.headers.authorization || '';
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { phone, type, template_name, params, text } = req.body;

  if (!phone) return res.status(400).json({ error: 'Missing phone' });

  let result;
  if (type === 'template' && template_name) {
    result = await sendTemplate(phone, template_name, params || []);
  } else if (type === 'text' && text) {
    result = await sendText(phone, text);
  } else {
    return res.status(400).json({ error: 'Specify type=template or type=text' });
  }

  return res.json(result);
};
