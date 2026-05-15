const crypto = require('crypto');
const { getSupabase } = require('./_lib/supabase');
const { sendTemplate, notifyMaddy } = require('./_lib/whatsapp');
const { maskPhone, jsonResponse, PROGRAM_NAMES } = require('./_lib/utils');

function verifySignature(body, signature) {
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
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return jsonResponse(res, 405, { error: 'Method not allowed' });

  const signature = req.headers['x-exly-signature'];
  if (process.env.EXLY_WEBHOOK_SECRET && !verifySignature(req.body, signature)) {
    return jsonResponse(res, 401, { error: 'Invalid signature' });
  }

  const db = getSupabase();

  try {
    const {
      phone, email, name, amount, checkout_id,
      product_name, product_id
    } = req.body;

    if (!phone) return jsonResponse(res, 400, { error: 'Missing phone' });

    const programMap = {
      'shred': '6wk_gym',
      'burn': '6wk_gym',
      '6_week': '6wk_gym',
      '6week': '6wk_gym',
      'home': '6wk_home',
      '12_week': '12wk',
      '12week': '12wk',
      'custom': '12wk',
      'flagship': '12wk',
      'pcos': 'pcos',
      'warrior': 'pcos',
      '40': '40plus',
      'strong': '40plus',
      'trial': 'zoom_trial',
      'zoom': 'zoom_trial'
    };

    let program = null;
    const pName = (product_name || product_id || '').toLowerCase();
    for (const [key, val] of Object.entries(programMap)) {
      if (pName.includes(key)) { program = val; break; }
    }
    program = program || '6wk_gym';

    const durationWeeks = program === '12wk' ? 12 : 6;
    const programEnds = new Date();
    programEnds.setDate(programEnds.getDate() + durationWeeks * 7);

    const { data: lead } = await db
      .from('leads')
      .select('id')
      .eq('phone', phone)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (lead) {
      await db.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    const folderPath = `clients/${checkout_id || Date.now()}`;

    const { data: client } = await db.from('clients').upsert({
      lead_id: lead?.id,
      phone,
      name,
      email,
      program,
      paid_amount: amount ? parseInt(amount) : null,
      checkout_id,
      folder_url: folderPath,
      program_started_at: new Date().toISOString(),
      program_ends_at: programEnds.toISOString(),
      status: 'active'
    }, { onConflict: 'phone' }).select().single();

    const templateName = `onboard_${program}`;
    await sendTemplate(phone, templateName, [
      name || 'there',
      PROGRAM_NAMES[program] || program,
      `${durationWeeks} weeks`
    ]);

    if (program === '12wk' && client) {
      try {
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'https://fitnessbymaddy.com';

        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id, week_no: 1 })
        });
      } catch (e) {
        console.error('[Exly] Week-1 program generation failed:', e.message);
      }
    }

    console.log(`[Exly] Converted: ${maskPhone(phone)} → ${program}`);
    return jsonResponse(res, 200, { ok: true, client_id: client?.id });
  } catch (err) {
    console.error('[Exly Webhook Error]', err.message);
    return jsonResponse(res, 500, { error: 'Internal error' });
  }
};
