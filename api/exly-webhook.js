const crypto = require('crypto');
const { getSupabase, TABLES } = require('./_utils/supabase');
const { sendTemplate } = require('./_utils/whatsapp');
const { detectMarket, isHinglish } = require('./_utils/helpers');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = req.body || {};

    if (process.env.EXLY_WEBHOOK_SECRET) {
      const sig = req.headers['x-exly-signature'] || '';
      const expected = crypto
        .createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
        .update(JSON.stringify(body))
        .digest('hex');
      if (sig && sig !== expected) {
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    const {
      phone, name, email, checkout_id, amount, program,
      event_type,
    } = body;

    if (event_type === 'payment.failed') {
      const { notifyMaddy } = require('./_utils/escalation');
      await notifyMaddy('Payment failure', `Phone: ${phone}\nAmount: ${amount}\nCheckout: ${checkout_id}`);
      return res.status(200).json({ action: 'payment_failure_escalated' });
    }

    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    const db = getSupabase();
    const normalizedPhone = normalizePhone(phone);

    const { data: leads } = await db
      .from(TABLES.LEADS)
      .select('*')
      .eq('phone', normalizedPhone)
      .order('created_at', { ascending: false })
      .limit(1);

    const lead = leads && leads[0];
    const leadId = lead ? lead.id : null;
    const programCode = program || (lead && lead.program_interest) || '6wk_gym';
    const market = lead ? lead.market : detectMarket(normalizedPhone);

    if (lead) {
      await db.from(TABLES.LEADS).update({ status: 'converted' }).eq('id', lead.id);
    }

    const programDays = programCode.startsWith('12') ? 84 : 42;
    const startDate = new Date();
    const endDate = new Date(startDate.getTime() + programDays * 24 * 60 * 60 * 1000);

    const { data: client, error: clientErr } = await db.from(TABLES.CLIENTS).insert({
      lead_id: leadId,
      phone: normalizedPhone,
      name: name || (lead && lead.name) || null,
      email: email || null,
      program: programCode,
      program_started_at: startDate.toISOString(),
      program_ends_at: endDate.toISOString(),
      paid_amount: parseInt(amount) || 0,
      checkout_id: checkout_id || null,
      folder_url: null,
      status: 'active',
    }).select().single();

    if (clientErr) {
      console.error('Client insert error:', clientErr.message);
      return res.status(500).json({ error: 'Failed to create client' });
    }

    const folderPath = `clients/${client.id}`;
    await db.storage.from('client-files').upload(
      `${folderPath}/.keep`,
      new Uint8Array([0]),
      { contentType: 'application/octet-stream', upsert: true }
    );
    await db.from(TABLES.CLIENTS).update({ folder_url: folderPath }).eq('id', client.id);

    const templateName = isHinglish(market)
      ? `onboard_${programCode}_hi`
      : `onboard_${programCode}_en`;
    await sendTemplate(normalizedPhone, templateName, [client.name || 'Champion']);

    if (programCode === '12wk') {
      try {
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'https://www.fitnessbymaddy.com';
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id, week_no: 1 }),
        });
      } catch (e) {
        console.error('Week 1 generation trigger failed:', e.message);
      }
    }

    return res.status(200).json({ action: 'converted', clientId: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function normalizePhone(raw) {
  let cleaned = (raw || '').replace(/[^0-9+]/g, '');
  if (!cleaned.startsWith('+')) {
    if (cleaned.length === 10) cleaned = '+91' + cleaned;
    else cleaned = '+' + cleaned;
  }
  return cleaned;
}
