const { getSupabase } = require('./lib/supabase');
const { sendTemplate } = require('./lib/whatsapp');
const { notifyMaddy } = require('./lib/whatsapp');
const crypto = require('crypto');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const db = getSupabase();

  try {
    const secret = process.env.EXLY_WEBHOOK_SECRET;
    if (secret) {
      const sig = req.headers['x-exly-signature'] || req.headers['x-webhook-signature'] || '';
      const expected = crypto.createHmac('sha256', secret)
        .update(JSON.stringify(req.body))
        .digest('hex');
      if (sig && sig !== expected) {
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    const {
      phone, email, name, amount, checkout_id,
      product_name, product_id, status
    } = req.body;

    if (status && status !== 'paid' && status !== 'completed') {
      if (status === 'failed') {
        const { data: lead } = await db.from('leads')
          .select('phone').eq('phone', phone).single();
        if (lead) {
          await notifyMaddy('Payment failure', `Phone: ${phone}, Amount: ${amount}`);
        }
      }
      return res.status(200).json({ action: 'ignored', status });
    }

    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    const program = mapProgram(product_name || product_id || '');
    const programStart = new Date();
    const programEnd = new Date();
    const weeks = program === '12wk' ? 12 : 6;
    programEnd.setDate(programEnd.getDate() + weeks * 7);

    const { data: client, error } = await db.from('clients').insert({
      lead_id: lead?.id || null,
      phone,
      name: name || lead?.name || '',
      email: email || '',
      program,
      program_started_at: programStart.toISOString(),
      program_ends_at: programEnd.toISOString(),
      paid_amount: amount ? parseFloat(amount) : 0,
      checkout_id: checkout_id || null,
      status: 'active'
    }).select().single();

    if (error) {
      console.error('Client insert error:', error.message);
      return res.status(500).json({ error: 'Failed to create client' });
    }

    if (lead) {
      await db.from('leads')
        .update({ status: 'converted' })
        .eq('id', lead.id);
    }

    const folderPath = `clients/${client.id}`;
    await db.storage.from('programs').upload(
      `${folderPath}/.keep`,
      new Blob([''], { type: 'text/plain' })
    );
    await db.from('clients')
      .update({ folder_url: folderPath })
      .eq('id', client.id);

    await sendTemplate(phone, `onboard_${program}`, [
      name || 'there',
      String(weeks)
    ]);

    if (program === '12wk') {
      try {
        const origin = `https://${req.headers.host}`;
        await fetch(`${origin}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            client_id: client.id,
            week_no: 1,
            trigger: 'onboarding'
          })
        });
      } catch (genErr) {
        console.error('Week-1 program generation trigger failed:', genErr.message);
      }
    }

    return res.status(200).json({ success: true, client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function mapProgram(productStr) {
  const lower = (productStr || '').toLowerCase();
  if (lower.includes('12') || lower.includes('custom') || lower.includes('flagship')) return '12wk';
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40')) return '40plus';
  if (lower.includes('home')) return '6wk_home';
  if (lower.includes('trial') || lower.includes('zoom')) return 'zoom_trial';
  if (lower.includes('pack')) return 'zoom_pack';
  return '6wk_gym';
}
