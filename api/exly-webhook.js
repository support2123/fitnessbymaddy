const crypto = require('crypto');
const { supabase } = require('./lib/supabase');
const { sendTemplate } = require('./lib/whatsapp');
const { parseBody, corsHeaders, json, normalizePhone, PROGRAM_NAMES } = require('./lib/helpers');
const { escalateToMaddy } = require('./lib/escalation');

function verifyExlySignature(body, signature) {
  const secret = process.env.EXLY_WEBHOOK_SECRET;
  if (!secret) return true;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(JSON.stringify(body))
    .digest('hex');
  return crypto.timingSafeEqual(
    Buffer.from(signature || ''),
    Buffer.from(expected)
  );
}

module.exports = async function handler(req, res) {
  corsHeaders(res);
  if (req.method === 'OPTIONS') return json(res, 200, { ok: true });
  if (req.method !== 'POST') return json(res, 405, { error: 'POST only' });

  try {
    const body = await parseBody(req);
    const signature = req.headers['x-exly-signature'] || '';

    if (process.env.EXLY_WEBHOOK_SECRET && !verifyExlySignature(body, signature)) {
      return json(res, 401, { error: 'Invalid signature' });
    }

    const {
      phone: rawPhone, name, email, amount,
      checkout_id, product_name, status: paymentStatus
    } = body;

    if (!rawPhone) return json(res, 400, { error: 'phone required' });
    if (paymentStatus && paymentStatus !== 'success') {
      if (paymentStatus === 'failed') {
        await escalateToMaddy('Payment failure', {
          phone: rawPhone,
          name,
          details: `Checkout ${checkout_id} failed for ${product_name}`
        });
      }
      return json(res, 200, { action: 'payment_not_success', status: paymentStatus });
    }

    const phone = normalizePhone(rawPhone);

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (lead) {
      await supabase.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    const program = mapProductToProgram(product_name);
    const programWeeks = program === '12wk' ? 12 : 6;
    const endsAt = new Date();
    endsAt.setDate(endsAt.getDate() + programWeeks * 7);

    const { data: client, error: clientError } = await supabase.from('clients').upsert({
      lead_id: lead?.id,
      phone,
      name: name || lead?.name,
      email,
      program,
      paid_amount: amount ? parseInt(amount) : null,
      checkout_id,
      folder_url: `/clients/${lead?.id || 'new'}/`,
      status: 'active',
      program_started_at: new Date().toISOString(),
      program_ends_at: endsAt.toISOString()
    }, { onConflict: 'phone' }).select().single();

    if (client) {
      await supabase.storage
        .from('clients')
        .upload(`${client.id}/.keep`, new Blob(['']));
    }

    const programLabel = PROGRAM_NAMES[program] || program;
    await sendTemplate(phone, `onboard_${program}`, [
      name || lead?.name || 'there',
      programLabel
    ]);

    if (program === '12wk' && client) {
      const baseUrl = process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : 'https://www.fitnessbymaddy.com';
      await fetch(`${baseUrl}/api/generate-program`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: client.id, week_no: 1 })
      });
    }

    return json(res, 200, {
      ok: true,
      action: 'converted',
      client_id: client?.id,
      program
    });

  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return json(res, 500, { error: 'Internal error' });
  }
};

function mapProductToProgram(productName) {
  if (!productName) return '6wk_gym';
  const lower = productName.toLowerCase();
  if (lower.includes('12') || lower.includes('custom') || lower.includes('flagship')) return '12wk';
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40') || lower.includes('strong')) return '40plus';
  if (lower.includes('trial') || lower.includes('zoom')) return 'zoom_trial';
  if (lower.includes('home')) return '6wk_home';
  return '6wk_gym';
}
