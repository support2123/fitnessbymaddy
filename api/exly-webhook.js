const supabase = require('./_lib/supabase');
const { sendTemplate } = require('./_lib/whatsapp');
const { escalateToMaddy } = require('./_lib/escalation');
const { handleCors, detectMarket, PROGRAM_DURATIONS_WEEKS } = require('./_lib/utils');
const crypto = require('crypto');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    if (process.env.EXLY_WEBHOOK_SECRET) {
      const sig = req.headers['x-exly-signature'] || req.headers['x-webhook-signature'];
      if (sig) {
        const expected = crypto
          .createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
          .update(JSON.stringify(req.body))
          .digest('hex');
        if (sig !== expected) {
          return res.status(401).json({ error: 'Invalid signature' });
        }
      }
    }

    const {
      phone, email, name, amount, checkout_id,
      product_name, status: paymentStatus
    } = req.body;

    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    if (paymentStatus === 'failed') {
      const { data: activeClient } = await supabase
        .from('clients')
        .select('*')
        .eq('phone', phone)
        .eq('status', 'active')
        .limit(1);

      if (activeClient && activeClient.length > 0) {
        await escalateToMaddy('Payment failure for active client', {
          phone, name, details: `Checkout: ${checkout_id}, Amount: ${amount}`
        });
      }
      return res.status(200).json({ action: 'payment_failed_logged' });
    }

    const program = mapProductToProgram(product_name);
    const durationWeeks = PROGRAM_DURATIONS_WEEKS[program] || 6;
    const programEnds = new Date();
    programEnds.setDate(programEnds.getDate() + durationWeeks * 7);

    const { data: lead } = await supabase
      .from('leads')
      .select('id')
      .eq('phone', phone)
      .order('created_at', { ascending: false })
      .limit(1);

    const leadId = lead && lead[0] ? lead[0].id : null;

    if (leadId) {
      await supabase.from('leads')
        .update({ status: 'converted' })
        .eq('id', leadId);
    }

    const { data: newClient, error: clientErr } = await supabase
      .from('clients')
      .insert({
        lead_id: leadId,
        phone,
        name: name || null,
        email: email || null,
        program,
        program_started_at: new Date().toISOString(),
        program_ends_at: programEnds.toISOString(),
        paid_amount: amount ? Math.round(parseFloat(amount) * 100) : null,
        checkout_id: checkout_id || null,
        status: 'active'
      })
      .select()
      .single();

    if (clientErr) {
      console.error('Client creation error:', clientErr.message);
      return res.status(500).json({ error: 'Failed to create client' });
    }

    const folderPath = `clients/${newClient.id}/`;
    await supabase.storage
      .from('clients')
      .upload(`${folderPath}.keep`, new Uint8Array(0), { upsert: true });

    await supabase.from('clients')
      .update({ folder_url: folderPath })
      .eq('id', newClient.id);

    const market = detectMarket(phone);
    const templateName = market === 'IN'
      ? `onboard_${program}_hindi`
      : `onboard_${program}`;

    await sendTemplate(phone, templateName, [name || 'Champion'], true);

    if (program === '12wk') {
      try {
        const origin = `https://${req.headers.host}`;
        await fetch(`${origin}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: newClient.id, week_no: 1 })
        });
      } catch (e) {
        console.error('Week-1 program generation failed:', e.message);
      }
    }

    return res.status(200).json({ success: true, client_id: newClient.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function mapProductToProgram(productName) {
  if (!productName) return '6wk_gym';
  const lower = productName.toLowerCase();
  if (lower.includes('12') || lower.includes('custom') || lower.includes('flagship')) return '12wk';
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40') || lower.includes('strong')) return '40plus';
  if (lower.includes('home')) return '6wk_home';
  if (lower.includes('trial')) return 'zoom_trial';
  if (lower.includes('zoom') || lower.includes('pack')) return 'zoom_pack';
  return '6wk_gym';
}
