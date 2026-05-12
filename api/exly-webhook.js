const crypto = require('crypto');
const { getSupabase } = require('../lib/supabase');
const { sendTemplate, notifyMaddy } = require('../lib/whatsapp');
const { maskPhone } = require('../lib/market');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const secret = process.env.EXLY_WEBHOOK_SECRET;
    if (secret) {
      const sig = req.headers['x-exly-signature'] || req.headers['x-webhook-signature'];
      if (sig) {
        const expected = crypto.createHmac('sha256', secret).update(JSON.stringify(req.body)).digest('hex');
        if (sig !== expected) {
          return res.status(401).json({ error: 'Invalid signature' });
        }
      }
    }

    const {
      checkout_id, phone, email, name,
      product_name, amount, status
    } = req.body;

    if (status !== 'completed' && status !== 'success' && status !== 'paid') {
      if (status === 'failed') {
        const db = getSupabase();
        const { data: existingClient } = await db
          .from('clients')
          .select('*')
          .eq('phone', phone)
          .eq('status', 'active')
          .single();

        if (existingClient) {
          await notifyMaddy(
            `Payment FAILED for active client ${maskPhone(phone)}`,
            `Name: ${name}\nAmount: ${amount}\nCheckout: ${checkout_id}`
          );
        }
      }
      return res.status(200).json({ action: 'ignored', status });
    }

    const db = getSupabase();
    const program = detectProgram(product_name, amount);

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .maybeSingle();

    const leadId = lead?.id || null;

    if (leadId) {
      await db.from('leads')
        .update({ status: 'converted', last_msg_at: new Date().toISOString() })
        .eq('id', leadId);
    }

    const programDays = program.startsWith('12wk') ? 84 :
                        program.startsWith('6wk') ? 42 : 30;
    const endsAt = new Date(Date.now() + programDays * 86400000).toISOString();

    const { data: client } = await db.from('clients').insert({
      lead_id: leadId,
      phone,
      name: name || lead?.name || null,
      email,
      program,
      program_started_at: new Date().toISOString(),
      program_ends_at: endsAt,
      paid_amount: parseFloat(amount) || 0,
      checkout_id,
      status: 'active'
    }).select().single();

    const folderPath = `clients/${client.id}`;
    await db.storage.from('client-files').upload(
      `${folderPath}/.keep`,
      new Uint8Array(0),
      { contentType: 'text/plain', upsert: true }
    );

    await db.from('clients').update({ folder_url: folderPath }).eq('id', client.id);

    const templateName = `onboard_${program.replace(/[^a-z0-9_]/g, '')}`;
    await sendTemplate(phone, templateName, [name || 'there'], true);

    if (program === '12wk') {
      try {
        const origin = `https://${req.headers.host}`;
        await fetch(`${origin}/api/generate-program`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.INTERNAL_API_KEY}`
          },
          body: JSON.stringify({ client_id: client.id, week_no: 1 })
        });
      } catch (genErr) {
        console.error('Week-1 program generation failed:', genErr.message);
      }
    }

    return res.status(200).json({ ok: true, client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Conversion failed' });
  }
};

function detectProgram(productName, amount) {
  const lower = (productName || '').toLowerCase();
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40+') || lower.includes('40 plus')) return '40plus';
  if (lower.includes('12') || lower.includes('custom') || lower.includes('flagship')) return '12wk';
  if (lower.includes('zoom') || lower.includes('trial')) return 'zoom_trial';
  if (lower.includes('home')) return '6wk_home';

  const amt = parseFloat(amount) || 0;
  if (amt >= 150) return '12wk';
  if (amt >= 80) return '6wk_gym';
  if (amt >= 40) return 'pcos';
  if (amt >= 20) return 'zoom_trial';
  return '6wk_gym';
}
