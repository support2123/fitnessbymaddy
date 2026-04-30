const crypto = require('crypto');
const { getSupabase } = require('../lib/supabase');
const { sendTemplate, sendText, notifyMaddy } = require('../lib/whatsapp');
const { maskPhone, calculateProgramEndDate, jsonResponse, errorResponse } = require('../lib/helpers');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return errorResponse(res, 'Method not allowed', 405);

  try {
    const signature = req.headers['x-exly-signature'] || req.headers['x-webhook-signature'];
    if (process.env.EXLY_WEBHOOK_SECRET && signature) {
      const expected = crypto
        .createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
        .update(JSON.stringify(req.body))
        .digest('hex');
      if (signature !== expected) {
        return errorResponse(res, 'Invalid signature', 401);
      }
    }

    const {
      customer_name, customer_phone, customer_email,
      product_name, amount, checkout_id, status
    } = req.body;

    if (status && status !== 'completed' && status !== 'success') {
      if (status === 'failed') {
        const { data: lead } = await getSupabase()
          .from('leads')
          .select('*')
          .eq('phone', customer_phone)
          .single();

        if (lead && lead.status === 'qualified') {
          await notifyMaddy(
            'Payment failed for active lead',
            `Name: ${customer_name}\nPhone: ${maskPhone(customer_phone)}\nProduct: ${product_name}`
          );
        }
      }
      return jsonResponse(res, { status: 'ignored', reason: 'non-success status' });
    }

    const db = getSupabase();

    const program = mapProductToProgram(product_name);

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('phone', customer_phone)
      .single();

    if (lead) {
      await db.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    const startDate = new Date().toISOString();
    const endDate = calculateProgramEndDate(program, startDate);

    const { data: client, error } = await db.from('clients').insert({
      lead_id: lead?.id || null,
      phone: customer_phone,
      name: customer_name,
      email: customer_email,
      program,
      program_started_at: startDate,
      program_ends_at: endDate,
      paid_amount: Math.round(parseFloat(amount) * 100),
      checkout_id: checkout_id || null,
      folder_url: null,
      status: 'active'
    }).select().single();

    if (error) {
      console.error('Client insert error:', error.message);
      return errorResponse(res, 'Failed to create client', 500);
    }

    const folderPath = `clients/${client.id}/`;
    await db.storage.from('client-files').upload(
      `${folderPath}.keep`,
      Buffer.from(''),
      { contentType: 'text/plain', upsert: true }
    );

    await db.from('clients').update({
      folder_url: folderPath
    }).eq('id', client.id);

    await sendTemplate(customer_phone, `onboard_${program}`, [
      customer_name || 'there',
      program.replace(/_/g, ' ')
    ]);

    if (program === '12wk') {
      try {
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'https://www.fitnessbymaddy.com';

        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id, week_no: 1 })
        });
      } catch (e) {
        console.error('Week-1 program generation failed:', e.message);
      }
    }

    return jsonResponse(res, { status: 'ok', client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return errorResponse(res, 'Internal error', 500);
  }
};

function mapProductToProgram(productName) {
  if (!productName) return '6wk_gym';
  const lower = productName.toLowerCase();
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40+') || lower.includes('40 plus') || lower.includes('forty')) return '40plus';
  if (lower.includes('12') || lower.includes('twelve') || lower.includes('custom') || lower.includes('flagship')) return '12wk';
  if (lower.includes('trial') || lower.includes('zoom trial')) return 'zoom_trial';
  if (lower.includes('zoom pack')) return 'zoom_pack';
  if (lower.includes('home')) return '6wk_home';
  return '6wk_gym';
}
