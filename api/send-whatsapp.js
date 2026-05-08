const { sendWhatsApp, sendFreeformWhatsApp } = require('./_lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { phone, template_name, body, message, is_client } = req.body;

    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    let result;
    if (message) {
      result = await sendFreeformWhatsApp({
        phone,
        message,
        isClient: !!is_client
      });
    } else if (template_name) {
      result = await sendWhatsApp({
        phone,
        templateName: template_name,
        body,
        isClient: !!is_client
      });
    } else {
      return res.status(400).json({ error: 'Provide template_name or message' });
    }

    return res.status(200).json(result);

  } catch (err) {
    console.error('Send WhatsApp error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
