const { getSupabase } = require('../lib/supabase');
const { sendTemplate, sendText } = require('../lib/whatsapp');
const { cors, parseBody } = require('../lib/helpers');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const authHeader = req.headers.authorization;
  if (!authHeader || authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const supabase = getSupabase();

  let body;
  try {
    body = await parseBody(req);
  } catch {
    return res.status(400).json({ error: 'Invalid body' });
  }

  const { phone, template, params, text } = body;
  if (!phone) return res.status(400).json({ error: 'Missing phone' });

  let result;
  if (template) {
    result = await sendTemplate(phone, template, params || [], { supabase });
  } else if (text) {
    result = await sendText(phone, text, { supabase });
  } else {
    return res.status(400).json({ error: 'Provide template or text' });
  }

  return res.status(result.ok ? 200 : 429).json(result);
};
