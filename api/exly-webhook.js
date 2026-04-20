const crypto = require('crypto');
const { getSupabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');
const { calculateEndDate, maskPhone, jsonResponse, programLabel } = require('../lib/utils');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return jsonResponse(res, 200, { ok: true });
  if (req.method !== 'POST') return jsonResponse(res, 405, { error: 'POST only' });

  try {
    const signature = req.headers['x-exly-signature'] || req.headers['x-webhook-signature'];
    if (process.env.EXLY_WEBHOOK_SECRET && signature) {
      const expected = crypto
        .createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
        .update(JSON.stringify(req.body))
        .digest('hex');
      if (signature !== expected) {
        return jsonResponse(res, 401, { error: 'Invalid signature' });
      }
    }

    const {
      phone,
      email,
      name,
      amount,
      checkout_id,
      product_name,
      status: paymentStatus
    } = req.body;

    if (!phone) return jsonResponse(res, 400, { error: 'Missing phone' });
    if (paymentStatus && paymentStatus !== 'success' && paymentStatus !== 'completed') {
      console.log(`[EXLY] Non-success payment for ${maskPhone(phone)}: ${paymentStatus}`);
      return jsonResponse(res, 200, { action: 'ignored_non_success' });
    }

    const db = getSupabase();

    const program = detectProgram(product_name, checkout_id, amount);

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (lead) {
      await db.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    const now = new Date();
    const { data: client, error: clientErr } = await db.from('clients').upsert({
      phone,
      lead_id: lead?.id || null,
      name: name || lead?.name || null,
      email: email || null,
      program,
      program_started_at: now.toISOString(),
      program_ends_at: calculateEndDate(now, program),
      paid_amount: amount ? parseInt(amount) : null,
      checkout_id: checkout_id || null,
      folder_url: null,
      status: 'active'
    }, { onConflict: 'phone' }).select().single();

    if (clientErr) {
      console.error(`[EXLY] Client upsert error: ${clientErr.message}`);
      return jsonResponse(res, 500, { error: 'Failed to create client' });
    }

    const folderPath = `${client.id}/`;
    await db.storage.from('clients').upload(`${folderPath}.keep`, new Uint8Array(0), { upsert: true });
    await db.from('clients').update({ folder_url: folderPath }).eq('id', client.id);

    const templateName = `onboard_${program}`;
    await sendTemplate(phone, templateName, [name || 'there', programLabel(program)]);

    if (program === '12wk') {
      try {
        const baseUrl = `https://${req.headers.host}`;
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id, week_no: 1 })
        });
      } catch (genErr) {
        console.error(`[PROGRAM GEN] ${genErr.message}`);
      }
    }

    console.log(`[CONVERSION] ${maskPhone(phone)} → ${program} ($${amount || '?'})`);

    return jsonResponse(res, 200, {
      ok: true,
      client_id: client.id,
      program
    });
  } catch (err) {
    console.error(`[EXLY ERROR] ${err.message}`);
    return jsonResponse(res, 500, { error: 'Internal error' });
  }
};

function detectProgram(productName, checkoutId, amount) {
  const text = `${productName || ''} ${checkoutId || ''}`.toLowerCase();

  if (text.includes('pcos') || text.includes('hormonal')) return 'pcos';
  if (text.includes('40') || text.includes('strong')) return '40plus';
  if (text.includes('12') || text.includes('custom') || text.includes('flagship')) return '12wk';
  if (text.includes('trial') || text.includes('zoom')) return 'zoom_trial';
  if (text.includes('home')) return '6wk_home';
  if (text.includes('6') || text.includes('shred') || text.includes('burn')) return '6wk_gym';

  if (amount) {
    const a = parseInt(amount);
    if (a <= 25) return 'zoom_trial';
    if (a <= 50) return 'pcos';
    if (a <= 100) return '6wk_gym';
    if (a >= 150) return '12wk';
  }

  return '6wk_gym';
}
