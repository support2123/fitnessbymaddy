const { sendTemplate, sendText, sendDocument, canSend } = require('./_lib/whatsapp');
const { handleCors, maskPhone } = require('./_lib/utils');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const authHeader = req.headers['authorization'] || '';
  const expectedKey = process.env.INTERNAL_API_KEY;
  if (expectedKey && authHeader !== `Bearer ${expectedKey}`) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  try {
    const { phone, type, template, params, text, documentUrl, caption, isClient } = req.body;

    if (!phone) return res.status(400).json({ error: 'phone required' });

    const allowed = await canSend(phone, isClient === true);
    if (!allowed) {
      return res.status(429).json({
        error: 'rate_limited',
        message: `Rate limit: max 1 msg per 2hrs for leads. Phone: ${maskPhone(phone)}`
      });
    }

    let result;

    if (type === 'template') {
      if (!template) return res.status(400).json({ error: 'template name required' });
      result = await sendTemplate(phone, template, params || []);
    } else if (type === 'document') {
      if (!documentUrl) return res.status(400).json({ error: 'documentUrl required' });
      result = await sendDocument(phone, documentUrl, caption);
    } else {
      if (!text) return res.status(400).json({ error: 'text required' });
      result = await sendText(phone, text);
    }

    return res.status(200).json({ ok: result.ok, result: result.result || null });
  } catch (err) {
    console.error('[SendWA] Error:', err.message);
    return res.status(500).json({ error: 'internal' });
  }
};
