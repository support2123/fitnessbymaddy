const crypto = require('crypto');
const { getClient } = require('../lib/supabase');
const { sendTemplate, maskPhone } = require('../lib/whatsapp');
const { logMessage } = require('../lib/messages');
const { escalateToMaddy } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    if (process.env.EXLY_WEBHOOK_SECRET) {
      const sig = req.headers['x-exly-signature'] || '';
      const expected = crypto
        .createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
        .update(JSON.stringify(req.body))
        .digest('hex');
      if (sig !== expected) {
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    const payload = req.body;
    const phone = (payload.phone || payload.mobile || '').replace(/[^0-9]/g, '');
    const email = payload.email || '';
    const name = payload.name || payload.customer_name || '';
    const amount = parseFloat(payload.amount || payload.paid_amount || 0);
    const checkoutId = payload.checkout_id || payload.order_id || '';
    const programSlug = payload.product_name || payload.program || '';

    if (!phone) return res.status(400).json({ error: 'No phone' });

    const sb = getClient();

    const { data: lead } = await sb
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .limit(1)
      .single();

    if (lead) {
      await sb.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    const program = detectProgram(programSlug, amount);
    const programWeeks = program === '12wk' ? 12 : 6;
    const now = new Date();
    const endsAt = new Date(now.getTime() + programWeeks * 7 * 24 * 60 * 60 * 1000);

    const { data: client, error } = await sb
      .from('clients')
      .insert({
        lead_id: lead?.id || null,
        phone,
        name: name || lead?.name || null,
        email,
        program,
        program_started_at: now.toISOString(),
        program_ends_at: endsAt.toISOString(),
        paid_amount: amount,
        checkout_id: checkoutId,
        status: 'active',
      })
      .select()
      .single();

    if (error) {
      console.error('[EXLY]', error.message);
      await escalateToMaddy('Payment received but client creation failed', {
        phone, name, message: `Amount: $${amount}, Error: ${error.message}`,
      });
      return res.status(500).json({ error: 'Client creation failed' });
    }

    const folderPath = `clients/${client.id}`;
    await sb.storage.from('client-files').upload(`${folderPath}/.keep`, new Uint8Array(0), {
      contentType: 'application/octet-stream',
      upsert: true,
    });

    await sb.from('clients').update({ folder_url: folderPath }).eq('id', client.id);

    const templateName = `onboard_${program}`;
    await sendTemplate(phone, templateName, [name || 'there']);
    await logMessage(phone, 'out', `Onboarding for ${program}`, templateName);

    if (program === '12wk') {
      try {
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'https://www.fitnessbymaddy.com';
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-internal-key': process.env.INTERNAL_API_KEY,
          },
          body: JSON.stringify({ client_id: client.id, week_no: 1 }),
        });
      } catch (genErr) {
        console.error('[EXLY_GEN]', genErr.message);
      }
    }

    console.log(`[EXLY] Converted ${maskPhone(phone)} → ${program} ($${amount})`);
    return res.status(200).json({ status: 'converted', client_id: client.id });
  } catch (err) {
    console.error('[EXLY]', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function detectProgram(slug, amount) {
  const lower = (slug || '').toLowerCase();
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40') || lower.includes('plus')) return '40plus';
  if (lower.includes('12') || lower.includes('custom') || lower.includes('flagship')) return '12wk';
  if (lower.includes('zoom') || lower.includes('trial')) return 'zoom_trial';
  if (lower.includes('home')) return '6wk_home';
  if (amount >= 150) return '12wk';
  if (amount >= 40 && amount <= 55) return 'pcos';
  return '6wk_gym';
}
