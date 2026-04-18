const { sendTemplate } = require('../lib/whatsapp');
const { cors, parseBody } = require('../lib/helpers');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const body = await parseBody(req);
  const { name, phone, preferred_date, preferred_time, reason } = body;

  if (!name || !phone || !preferred_date || !preferred_time) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  await sendTemplate(process.env.MADDY_PHONE || '+917082478374', 'reschedule_request', [
    name,
    preferred_date,
    preferred_time,
    reason || 'No reason given',
  ]);

  return res.status(200).json({ success: true });
};
