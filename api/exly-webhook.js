const crypto = require('crypto');
const { supabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');
const { sendJson, parseBody, maskPhone } = require('../lib/utils');

const PROGRAM_DURATIONS = {
  '6wk_gym': 42,
  '6wk_home': 42,
  '12wk': 84,
  'pcos': 42,
  '40plus': 42,
  'zoom_trial': 7,
  'zoom_pack': 30,
};

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return sendJson(res, 200, { ok: true });
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });

  try {
    const body = await parseBody(req);

    if (process.env.EXLY_WEBHOOK_SECRET) {
      const signature = req.headers['x-exly-signature'] || req.headers['x-webhook-signature'];
      if (signature) {
        const expected = crypto
          .createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
          .update(JSON.stringify(body))
          .digest('hex');
        if (signature !== expected) {
          return sendJson(res, 401, { error: 'Invalid signature' });
        }
      }
    }

    const phone = body.phone || body.customer_phone || body.mobile;
    const email = body.email || body.customer_email;
    const name = body.name || body.customer_name;
    const checkoutId = body.checkout_id || body.order_id || body.transaction_id;
    const amount = body.amount || body.paid_amount;
    const productName = body.product_name || body.item_name || '';

    if (!phone) return sendJson(res, 400, { error: 'No phone number' });

    console.log(`[EXLY] Purchase from ${maskPhone(phone)}: ${productName}`);

    const program = detectProgram(productName, body.product_id);

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .order('created_at', { ascending: false })
      .limit(1);

    const leadRecord = lead?.[0];

    if (leadRecord) {
      await supabase.from('leads').update({ status: 'converted' }).eq('id', leadRecord.id);
    }

    const now = new Date();
    const durationDays = PROGRAM_DURATIONS[program] || 42;
    const endsAt = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);

    const { data: client, error } = await supabase
      .from('clients')
      .upsert({
        lead_id: leadRecord?.id || null,
        phone,
        name: name || leadRecord?.name,
        email,
        program,
        program_started_at: now.toISOString(),
        program_ends_at: endsAt.toISOString(),
        paid_amount: amount ? parseInt(amount) : null,
        checkout_id: checkoutId,
        status: 'active',
      }, {
        onConflict: 'phone',
        ignoreDuplicates: false,
      })
      .select()
      .single();

    if (error) throw error;

    const folderPath = `clients/${client.id}`;
    await supabase.storage.from('clients').upload(`${folderPath}/.keep`, new Uint8Array(0), {
      upsert: true,
    });

    await supabase.from('clients').update({ folder_url: folderPath }).eq('id', client.id);

    await sendTemplate(phone, `onboard_${program}`, [
      name || 'there',
      durationDays + ' days',
    ]);

    if (program === '12wk') {
      try {
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'https://fitnessbymaddy.com';

        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id, week_no: 1 }),
        });
      } catch (genErr) {
        console.error('[EXLY] Week-1 program gen failed:', genErr.message);
      }
    }

    return sendJson(res, 200, { success: true, client_id: client.id, program });
  } catch (err) {
    console.error('[EXLY] Error:', err.message);
    return sendJson(res, 500, { error: 'Internal error' });
  }
};

function detectProgram(productName, productId) {
  const name = (productName || '').toLowerCase();
  if (name.includes('12') || name.includes('flagship') || name.includes('custom')) return '12wk';
  if (name.includes('pcos')) return 'pcos';
  if (name.includes('40') || name.includes('strong')) return '40plus';
  if (name.includes('home')) return '6wk_home';
  if (name.includes('trial') || name.includes('zoom trial')) return 'zoom_trial';
  if (name.includes('zoom') || name.includes('pack')) return 'zoom_pack';
  return '6wk_gym';
}
