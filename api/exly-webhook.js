const crypto = require('crypto');
const { getSupabase } = require('./_lib/supabase');
const { sendWhatsApp } = require('./_lib/whatsapp');
const { detectMarket, isHinglish } = require('./_lib/market');
const { getProgramDetails } = require('./_lib/qualify');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    if (process.env.EXLY_WEBHOOK_SECRET) {
      const sig = req.headers['x-exly-signature'] || req.headers['x-webhook-signature'] || '';
      const expected = crypto
        .createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
        .update(JSON.stringify(req.body))
        .digest('hex');
      if (sig !== expected) {
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    const {
      phone, email, name, amount, checkout_id,
      product_name, status: paymentStatus,
    } = req.body;

    if (!phone || paymentStatus !== 'completed') {
      return res.status(200).json({ action: 'ignored' });
    }

    const db = getSupabase();

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .maybeSingle();

    const program = lead?.program_interest || inferProgram(product_name, amount);
    const programDetails = getProgramDetails(program);
    const market = lead ? lead.market : detectMarket(phone);
    const hinglish = isHinglish(market);

    const programWeeks = program === '12wk' ? 12 : program?.startsWith('6wk') ? 6 : 4;
    const endsAt = new Date();
    endsAt.setDate(endsAt.getDate() + programWeeks * 7);

    const { data: client, error: clientErr } = await db.from('clients').insert({
      lead_id: lead?.id || null,
      phone,
      name: name || lead?.name || null,
      email: email || null,
      program: program || '6wk_gym',
      program_started_at: new Date().toISOString(),
      program_ends_at: endsAt.toISOString(),
      paid_amount: amount ? parseInt(amount, 10) : programDetails?.price || 0,
      checkout_id: checkout_id || null,
      folder_url: null,
      status: 'active',
    }).select().single();

    if (clientErr) {
      console.error('Client insert error:', clientErr.message);
      return res.status(500).json({ error: 'Failed to create client' });
    }

    if (lead) {
      await db.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    const folderPath = `clients/${client.id}`;
    await db.storage.from('clients').upload(`${folderPath}/.keep`, new Uint8Array(0), {
      contentType: 'application/octet-stream',
      upsert: true,
    });
    await db.from('clients').update({ folder_url: folderPath }).eq('id', client.id);

    const onboardTemplate = `onboard_${program || 'general'}`;
    const welcomeMsg = hinglish
      ? `Welcome to FitnessByMaddy! Tumhara ${programDetails?.name || 'program'} start ho gaya hai. Week 1 ka plan jaldi aayega!`
      : `Welcome to FitnessByMaddy! Your ${programDetails?.name || 'program'} has started. Week 1 plan coming soon!`;

    await sendWhatsApp({
      phone,
      templateName: onboardTemplate,
      bodyValues: [welcomeMsg],
    });

    if (program === '12wk') {
      try {
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'https://www.fitnessbymaddy.com';

        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id, week_no: 1 }),
        });
      } catch (genErr) {
        console.error('Week-1 generation trigger failed:', genErr.message);
      }
    }

    return res.status(200).json({ ok: true, client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function inferProgram(productName, amount) {
  if (!productName) return '6wk_gym';
  const lower = productName.toLowerCase();
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40')) return '40plus';
  if (lower.includes('12') || lower.includes('flagship') || lower.includes('custom')) return '12wk';
  if (lower.includes('trial') || lower.includes('zoom')) return 'zoom_trial';
  if (lower.includes('home')) return '6wk_home';
  return '6wk_gym';
}
