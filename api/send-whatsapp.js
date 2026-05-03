const { sendTemplate, sendClientMessage, canSendMessage } = require('./_lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  // Internal-only: verify via secret header
  const authHeader = req.headers['x-internal-key'];
  if (authHeader !== process.env.SUPABASE_SERVICE_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, template_name, params, is_client } = req.body;

    if (!phone || !template_name) {
      return res.status(400).json({ error: 'Missing phone or template_name' });
    }

    const fn = is_client ? sendClientMessage : sendTemplate;
    const result = await fn(phone, template_name, params || {});

    return res.status(result.ok ? 200 : 429).json(result);
  } catch (err) {
    console.error('Send WA error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
