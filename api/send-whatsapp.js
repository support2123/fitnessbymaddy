const { getSupabase } = require('./_lib/supabase');
const { sendTemplate, sendMediaTemplate, checkRateLimit } = require('./_lib/whatsapp');
const { maskPhone } = require('./_lib/mask');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    var auth = req.headers.authorization;
    if (!auth || auth !== 'Bearer ' + process.env.CRON_SECRET) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    var b = req.body;
    if (!b.phone || !b.template) {
      return res.status(400).json({ error: 'phone and template required' });
    }

    var isClient = false;
    if (b.skip_rate_limit) {
      isClient = true;
    } else {
      var supabase = getSupabase();
      var clientRes = await supabase
        .from('clients')
        .select('id')
        .eq('phone', b.phone)
        .eq('status', 'active')
        .limit(1)
        .single();
      isClient = !!clientRes.data;
    }

    if (!isClient) {
      var limited = await checkRateLimit(b.phone);
      if (limited) {
        return res.status(429).json({
          error: 'Rate limited',
          message: 'Max 1 message per 2 hours for non-clients'
        });
      }
    }

    var result;
    if (b.media_url) {
      result = await sendMediaTemplate(b.phone, b.template, b.params || [], b.media_url);
    } else {
      result = await sendTemplate(b.phone, b.template, b.params || []);
    }

    return res.status(result.ok ? 200 : 502).json({
      status: result.ok ? 'sent' : 'failed',
      phone_masked: maskPhone(b.phone)
    });
  } catch (err) {
    console.error('Send WA error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
