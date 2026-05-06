const { sendTemplate, sendSessionMessage } = require('../lib/whatsapp');
const { handleOptions } = require('../lib/utils');

module.exports = async function handler(req, res) {
  if (handleOptions(req, res)) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const internalKey = req.headers['x-internal-key'];
  if (internalKey !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { phone, templateName, params, message } = req.body;

  if (!phone) {
    return res.status(400).json({ error: 'phone is required' });
  }

  let result;
  if (templateName) {
    result = await sendTemplate(phone, templateName, params || []);
  } else if (message) {
    result = await sendSessionMessage(phone, message);
  } else {
    return res.status(400).json({ error: 'templateName or message required' });
  }

  return res.status(200).json(result);
};
