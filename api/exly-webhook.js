const crypto = require('crypto');
const { getSupabase } = require('./lib/supabase');
const { sendWhatsApp, detectMarket } = require('./lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = req.body || {};
    const {
      phone, email, name, amount, checkout_id,
      product_name, status: paymentStatus
    } = body;

    if (!phone) {
      return res.status(400).json({ error: 'No phone number' });
    }

    if (paymentStatus && paymentStatus !== 'completed' && paymentStatus !== 'success') {
      const db = getSupabase();
      const { data: activeClient } = await db
        .from('clients')
        .select('id')
        .eq('phone', phone)
        .eq('status', 'active')
        .limit(1)
        .single();

      if (activeClient) {
        const { notifyMaddy } = require('./lib/whatsapp');
        await notifyMaddy('Payment Failed', `Client phone: ${phone.slice(0, 3)}XXX...${phone.slice(-3)}, Amount: ${amount}`);
      }
      return res.status(200).json({ action: 'payment_failed_noted' });
    }

    const db = getSupabase();

    const program = detectProgram(product_name, amount);

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    const leadId = lead?.id || null;

    if (leadId) {
      await db.from('leads').update({ status: 'converted' }).eq('id', leadId);
    }

    const programStart = new Date();
    const programWeeks = program.startsWith('12wk') ? 12 : 6;
    const programEnd = new Date(programStart.getTime() + programWeeks * 7 * 24 * 60 * 60 * 1000);

    const { data: client, error } = await db
      .from('clients')
      .insert({
        lead_id: leadId,
        phone,
        name: name || lead?.name || '',
        email: email || '',
        program,
        program_started_at: programStart.toISOString(),
        program_ends_at: programEnd.toISOString(),
        paid_amount: amount ? parseFloat(amount) : 0,
        checkout_id: checkout_id || '',
        status: 'active'
      })
      .select()
      .single();

    if (error) {
      console.error('Client creation error:', error.message);
      return res.status(500).json({ error: 'Failed to create client' });
    }

    const folderPath = `clients/${client.id}/`;
    await db.storage
      .from('client-files')
      .upload(`${folderPath}.keep`, new Uint8Array(0), { upsert: true });

    await db.from('clients').update({ folder_url: folderPath }).eq('id', client.id);

    const market = detectMarket(phone);
    const templateName = `onboard_${program}`;

    await sendWhatsApp(phone, templateName, {
      name: client.name || 'there',
      templateParams: [client.name || 'there', programWeeks.toString()]
    }, true);

    if (program === '12wk') {
      try {
        const baseUrl = `https://${req.headers.host}`;
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-internal-key': process.env.EXLY_WEBHOOK_SECRET
          },
          body: JSON.stringify({ client_id: client.id, week_no: 1 })
        });
      } catch (e) {
        console.error('Week 1 program generation failed:', e.message);
      }
    }

    return res.status(200).json({ ok: true, clientId: client.id, program });

  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

function detectProgram(productName, amount) {
  const name = (productName || '').toLowerCase();
  const price = parseFloat(amount) || 0;

  if (name.includes('pcos') || name.includes('warrior')) return 'pcos';
  if (name.includes('40+') || name.includes('40 plus') || name.includes('strong')) return '40plus';
  if (name.includes('12') || name.includes('flagship') || name.includes('custom') || price >= 150) return '12wk';
  if (name.includes('zoom') || name.includes('trial') || price <= 25) return 'zoom_trial';
  if (name.includes('home') || name.includes('bodyweight')) return '6wk_home';
  if (name.includes('shred') || name.includes('burn') || name.includes('6 week')) return '6wk_gym';

  if (price >= 150) return '12wk';
  if (price >= 70) return '6wk_gym';
  if (price >= 40) return 'pcos';
  return 'zoom_trial';
}
