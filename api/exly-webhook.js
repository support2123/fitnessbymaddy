const crypto = require('crypto');
const { supabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { escalateToMaddy } = require('../lib/escalation');
const {
  maskPhone, jsonResponse, handleCors,
  PROGRAM_NAMES, PROGRAM_DURATIONS_WEEKS
} = require('../lib/utils');

function verifySignature(body, signature) {
  const secret = process.env.EXLY_WEBHOOK_SECRET;
  if (!secret) return true;
  const expected = crypto.createHmac('sha256', secret).update(JSON.stringify(body)).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature || ''), Buffer.from(expected));
}

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return jsonResponse(res, { error: 'Method not allowed' }, 405);

  try {
    const signature = req.headers['x-exly-signature'];
    if (process.env.EXLY_WEBHOOK_SECRET && !verifySignature(req.body, signature)) {
      return jsonResponse(res, { error: 'Invalid signature' }, 401);
    }

    const {
      checkout_id, phone, name, email,
      amount, product_name, status
    } = req.body;

    if (status !== 'completed' && status !== 'success') {
      if (status === 'failed') {
        await escalateToMaddy('Payment failed for lead', {
          leadPhone: phone,
          name: name || 'Unknown',
          details: `Checkout: ${checkout_id}, Amount: $${amount}`
        });
      }
      return jsonResponse(res, { action: 'ignored', status });
    }

    if (!phone) return jsonResponse(res, { error: 'No phone' }, 400);

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    const program = lead?.program_interest || inferProgram(product_name, amount);

    const durationWeeks = PROGRAM_DURATIONS_WEEKS[program] || 6;
    const programEnds = new Date();
    programEnds.setDate(programEnds.getDate() + durationWeeks * 7);

    const clientData = {
      phone,
      name: name || lead?.name,
      email,
      program,
      paid_amount: amount ? parseInt(amount) : null,
      checkout_id,
      status: 'active',
      program_started_at: new Date().toISOString(),
      program_ends_at: programEnds.toISOString(),
      folder_url: null,
    };

    if (lead) {
      clientData.lead_id = lead.id;
      await supabase.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    const { data: existingClient } = await supabase
      .from('clients')
      .select('id')
      .eq('phone', phone)
      .eq('status', 'active')
      .limit(1)
      .single();

    let clientId;
    if (existingClient) {
      await supabase.from('clients').update(clientData).eq('id', existingClient.id);
      clientId = existingClient.id;
    } else {
      const { data: client } = await supabase.from('clients').insert(clientData).select().single();
      clientId = client.id;
    }

    const folderPath = `clients/${clientId}`;
    await supabase.storage.from('clients').upload(`${folderPath}/.keep`, new Uint8Array(0), {
      upsert: true,
    });
    await supabase.from('clients').update({ folder_url: folderPath }).eq('id', clientId);

    const programName = PROGRAM_NAMES[program] || program;
    await sendWhatsApp(phone, `onboard_${program}`, [
      name || 'there',
      programName,
    ]);

    if (program === '12wk') {
      try {
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'https://fitnessbymaddy.com';
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: clientId, week_no: 1 }),
        });
      } catch (err) {
        console.error('Week-1 program generation failed:', err.message);
      }
    }

    console.log(`Conversion: ${maskPhone(phone)} program=${program} amount=${amount}`);
    return jsonResponse(res, { action: 'converted', client_id: clientId });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return jsonResponse(res, { error: 'Internal error' }, 500);
  }
};

function inferProgram(productName, amount) {
  if (!productName) return '6wk_gym';
  const lower = (productName || '').toLowerCase();
  if (lower.includes('12') || lower.includes('flagship')) return '12wk';
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40')) return '40plus';
  if (lower.includes('trial') || lower.includes('zoom')) return 'zoom_trial';
  if (lower.includes('home')) return '6wk_home';
  return '6wk_gym';
}
