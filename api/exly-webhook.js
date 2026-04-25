const { getSupabase } = require('./_lib/supabase');
const { sendTemplate, sendText } = require('./_lib/whatsapp');
const { handleCors, cleanPhone, detectMarket, isHinglish, programLabel } = require('./_lib/utils');
const { escalatePaymentFailure } = require('./_lib/escalation');
const crypto = require('crypto');

function programDurationWeeks(program) {
  const durations = {
    '6wk_gym': 6, '6wk_home': 6, '12wk': 12,
    'pcos': 8, '40plus': 8, 'zoom_trial': 1, 'zoom_pack': 4
  };
  return durations[program] || 6;
}

function mapExlyProduct(productName) {
  if (!productName) return '6wk_gym';
  const lower = productName.toLowerCase();
  if (lower.includes('12') || lower.includes('flagship') || lower.includes('custom')) return '12wk';
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40') || lower.includes('plus')) return '40plus';
  if (lower.includes('home')) return '6wk_home';
  if (lower.includes('trial') || lower.includes('zoom trial')) return 'zoom_trial';
  if (lower.includes('zoom') || lower.includes('pack')) return 'zoom_pack';
  return '6wk_gym';
}

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const webhookSecret = process.env.EXLY_WEBHOOK_SECRET;
  if (webhookSecret) {
    const sig = req.headers['x-exly-signature'] || req.headers['x-webhook-signature'] || '';
    const payload = JSON.stringify(req.body);
    const expected = crypto.createHmac('sha256', webhookSecret).update(payload).digest('hex');
    if (sig && sig !== expected) {
      return res.status(401).json({ error: 'invalid signature' });
    }
  }

  try {
    const payload = req.body || {};
    const event = payload.event || payload.type || 'purchase';

    if (event === 'payment_failed' || event === 'failure') {
      const phone = cleanPhone(payload.phone || payload.customer_phone || '');
      await escalatePaymentFailure(
        payload.customer_name || payload.name || 'Unknown',
        phone,
        payload.product_name || 'Unknown'
      );
      return res.status(200).json({ action: 'payment_failure_escalated' });
    }

    if (event !== 'purchase' && event !== 'success' && event !== 'payment_success') {
      return res.status(200).json({ action: 'ignored', event });
    }

    const phone = cleanPhone(
      payload.phone || payload.customer_phone || payload.mobile || ''
    );
    const name = payload.customer_name || payload.name || null;
    const email = payload.customer_email || payload.email || null;
    const amount = payload.amount || payload.paid_amount || 0;
    const checkoutId = payload.checkout_id || payload.order_id || payload.transaction_id || null;
    const productName = payload.product_name || payload.item_name || '';

    if (!phone) return res.status(400).json({ error: 'phone required' });

    const db = getSupabase();
    const program = mapExlyProduct(productName);
    const weeks = programDurationWeeks(program);
    const now = new Date();
    const endsAt = new Date(now.getTime() + weeks * 7 * 24 * 60 * 60 * 1000);

    let leadId = null;
    const { data: lead } = await db
      .from('leads')
      .select('id')
      .eq('phone', phone)
      .single();

    if (lead) {
      leadId = lead.id;
      await db.from('leads')
        .update({ status: 'converted' })
        .eq('id', lead.id);
    } else {
      const { data: newLead } = await db.from('leads').insert({
        phone,
        name,
        source: 'exly',
        status: 'converted',
        market: detectMarket(phone)
      }).select().single();
      leadId = newLead.id;
    }

    const { data: existingClient } = await db
      .from('clients')
      .select('id')
      .eq('phone', phone)
      .eq('program', program)
      .eq('status', 'active')
      .single();

    if (existingClient) {
      return res.status(200).json({
        action: 'already_active',
        client_id: existingClient.id
      });
    }

    const folderPath = `clients/${leadId}`;

    const { data: client } = await db.from('clients').insert({
      lead_id: leadId,
      phone,
      name,
      email,
      program,
      program_started_at: now.toISOString(),
      program_ends_at: endsAt.toISOString(),
      paid_amount: parseInt(amount),
      checkout_id: checkoutId,
      folder_url: folderPath,
      status: 'active'
    }).select().single();

    const market = detectMarket(phone);
    const hinglish = isHinglish(market);

    if (hinglish) {
      await sendTemplate(phone, `onboard_${program}`, [
        name || 'there',
        programLabel(program)
      ], name);
    } else {
      await sendTemplate(phone, `onboard_${program}_en`, [
        name || 'there',
        programLabel(program)
      ], name);
    }

    const siteBase = process.env.SITE_URL || 'https://www.fitnessbymaddy.com';
    const intakeUrl = `${siteBase}/intake?lead=${leadId}`;
    await sendText(phone,
      hinglish
        ? `Welcome aboard! Apna intake form yahan fill karo: ${intakeUrl}`
        : `Welcome aboard! Please fill your intake form here: ${intakeUrl}`
    );

    if (program === '12wk') {
      const generateUrl = process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}/api/generate-program`
        : `${siteBase}/api/generate-program`;

      fetch(generateUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.INTERNAL_API_KEY || ''}`
        },
        body: JSON.stringify({ client_id: client.id, week_no: 1 })
      }).catch(err => {
        console.error('[Exly] Failed to trigger Week 1 program gen:', err.message);
      });
    }

    return res.status(200).json({
      ok: true,
      action: 'converted',
      client_id: client.id,
      program
    });
  } catch (err) {
    console.error('[Exly Webhook] Error:', err.message);
    return res.status(500).json({ error: 'internal' });
  }
};
