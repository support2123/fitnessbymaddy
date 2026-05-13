const { getSupabase } = require('./_lib/supabase');
const { sendTemplate, notifyMaddy } = require('./_lib/whatsapp');
const { maskPhone } = require('./_lib/market');
const crypto = require('crypto');

const PROGRAM_MAP = {
  '6-week-burn-and-build':      '6wk_gym',
  '6-week-burn-and-build-home': '6wk_home',
  'pcos-warrior':               'pcos',
  '40plus-strong':              '40plus',
  '12-week-flagship':           '12wk',
  'zoom-trial':                 'zoom_trial',
  'zoom-pack':                  'zoom_pack'
};

const PROGRAM_DURATION_WEEKS = {
  '6wk_gym':    6,
  '6wk_home':   6,
  'pcos':       6,
  '40plus':     8,
  '12wk':       12,
  'zoom_trial': 1,
  'zoom_pack':  4
};

function verifyWebhookSignature(req) {
  const secret = process.env.EXLY_WEBHOOK_SECRET;
  if (!secret) return true; // skip verification if not configured
  const signature = req.headers['x-exly-signature'] || req.headers['x-webhook-signature'];
  if (!signature) return false;
  const expected = crypto.createHmac('sha256', secret).update(JSON.stringify(req.body)).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    if (!verifyWebhookSignature(req)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const {
      phone, email, name, checkout_id,
      product_slug, product_name, amount
    } = req.body;

    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    const program = PROGRAM_MAP[product_slug] || inferProgram(product_name);
    if (!program) {
      console.error('Unknown product:', product_slug, product_name);
      return res.status(400).json({ error: 'Unknown product' });
    }

    const { data: lead } = await getSupabase()
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    const leadId = lead?.id || null;

    if (leadId) {
      await getSupabase()
        .from('leads')
        .update({ status: 'converted' })
        .eq('id', leadId);
    }

    const durationWeeks = PROGRAM_DURATION_WEEKS[program] || 6;
    const startsAt = new Date();
    const endsAt = new Date(startsAt.getTime() + durationWeeks * 7 * 24 * 60 * 60 * 1000);

    const { data: client, error: clientErr } = await getSupabase()
      .from('clients')
      .insert({
        lead_id: leadId,
        phone,
        name: name || lead?.name,
        email,
        program,
        program_started_at: startsAt.toISOString(),
        program_ends_at: endsAt.toISOString(),
        paid_amount: amount ? Math.round(amount * 100) : null,
        checkout_id,
        status: 'active'
      })
      .select()
      .single();

    if (clientErr) throw clientErr;

    const folderPath = `clients/${client.id}/`;
    await getSupabase().storage
      .from('client-files')
      .upload(`${folderPath}.keep`, new Uint8Array(0), { upsert: true });

    await getSupabase()
      .from('clients')
      .update({ folder_url: folderPath })
      .eq('id', client.id);

    const templateName = `onboard_${program}`;
    await sendTemplate(phone, templateName, [name || 'there'], name);

    if (program === '12wk') {
      try {
        const origin = `https://${req.headers.host || 'fitnessbymaddy.com'}`;
        await fetch(`${origin}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id, week_no: 1 })
        });
      } catch (genErr) {
        console.error('Week 1 generation failed:', genErr.message);
      }
    }

    return res.json({ success: true, client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);

    if (req.body?.phone) {
      await notifyMaddy(
        'Payment webhook error',
        `Phone: ${maskPhone(req.body.phone)}\nError: ${err.message}`
      ).catch(() => {});
    }

    return res.status(500).json({ error: 'Internal error' });
  }
};

function inferProgram(productName) {
  if (!productName) return null;
  const lower = productName.toLowerCase();
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40+') || lower.includes('40 plus')) return '40plus';
  if (lower.includes('12') && lower.includes('week')) return '12wk';
  if (lower.includes('zoom') && lower.includes('trial')) return 'zoom_trial';
  if (lower.includes('zoom')) return 'zoom_pack';
  if (lower.includes('6') && lower.includes('home')) return '6wk_home';
  if (lower.includes('6') || lower.includes('shred') || lower.includes('burn')) return '6wk_gym';
  return null;
}
