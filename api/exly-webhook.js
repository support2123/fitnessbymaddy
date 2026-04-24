const { getSupabase } = require('../lib/supabase');
const { sendTemplate, maskPhone } = require('../lib/whatsapp');
const { detectMarket, isHinglish } = require('../lib/market');
const crypto = require('crypto');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const supabase = getSupabase();

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
      checkout_id, phone, email, name,
      product_name, amount, currency, status,
    } = req.body;

    if (status !== 'paid' && status !== 'completed' && status !== 'success') {
      if (status === 'failed') {
        const { data: lead } = await supabase
          .from('leads')
          .select('*')
          .eq('phone', phone)
          .order('created_at', { ascending: false })
          .limit(1)
          .single();

        if (lead) {
          const { escalateToMaddy } = require('../lib/escalation');
          await escalateToMaddy(
            'Payment failed for lead',
            `Name: ${name}\nPhone: ${maskPhone(phone)}\nAmount: ${amount} ${currency}`,
            { supabase }
          );
        }
      }
      return res.status(200).json({ action: 'ignored', status });
    }

    const program = mapProductToProgram(product_name, amount);

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    const leadId = lead ? lead.id : null;

    if (lead) {
      await supabase
        .from('leads')
        .update({ status: 'converted' })
        .eq('id', lead.id);
    }

    const programStart = new Date();
    const weeksDuration = program.startsWith('12wk') ? 12 : 6;
    const programEnd = new Date(programStart);
    programEnd.setDate(programEnd.getDate() + weeksDuration * 7);

    const { data: client, error } = await supabase
      .from('clients')
      .insert({
        lead_id: leadId,
        phone,
        name: name || (lead ? lead.name : 'Unknown'),
        email,
        program,
        program_started_at: programStart.toISOString(),
        program_ends_at: programEnd.toISOString(),
        paid_amount: amount,
        checkout_id: checkout_id || null,
        status: 'active',
      })
      .select()
      .single();

    if (error) {
      console.error('Client insert error:', error.message);
      return res.status(500).json({ error: 'Failed to create client' });
    }

    const folderPath = `clients/${client.id}`;
    await supabase.storage
      .from('programs')
      .upload(`${folderPath}/.keep`, new Uint8Array(0), {
        contentType: 'text/plain',
        upsert: true,
      });

    await supabase
      .from('clients')
      .update({ folder_url: folderPath })
      .eq('id', client.id);

    const market = detectMarket(phone);
    const templateName = isHinglish(market)
      ? `onboard_${program}`
      : `onboard_${program}_en`;

    await sendTemplate(phone, templateName, [client.name], { supabase });

    if (program === '12wk') {
      try {
        const origin = `${req.headers['x-forwarded-proto'] || 'https'}://${req.headers.host}`;
        await fetch(`${origin}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id, week_no: 1 }),
        });
      } catch (genErr) {
        console.error('Week 1 program generation failed:', genErr.message);
      }
    }

    return res.status(200).json({
      ok: true,
      client_id: client.id,
      program,
    });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function mapProductToProgram(productName, amount) {
  if (!productName) {
    if (amount <= 25) return 'zoom_trial';
    if (amount <= 50) return 'pcos';
    if (amount <= 100) return '6wk_gym';
    return '12wk';
  }

  const lower = productName.toLowerCase();
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40+') || lower.includes('40 plus')) return '40plus';
  if (lower.includes('12') || lower.includes('flagship') || lower.includes('custom')) return '12wk';
  if (lower.includes('home')) return '6wk_home';
  if (lower.includes('trial') || lower.includes('zoom')) return 'zoom_trial';
  if (lower.includes('pack')) return 'zoom_pack';
  return '6wk_gym';
}
