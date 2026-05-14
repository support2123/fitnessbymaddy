import supabase from '../lib/supabase.js';
import { sendTemplate } from '../lib/whatsapp.js';
import { programWeeks, programLabel, jsonResponse, maskPhone } from '../lib/utils.js';
import crypto from 'crypto';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return jsonResponse(res, 405, { error: 'Method not allowed' });

  try {
    const signature = req.headers['x-exly-signature'];
    if (process.env.EXLY_WEBHOOK_SECRET && signature) {
      const expected = crypto
        .createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
        .update(JSON.stringify(req.body))
        .digest('hex');
      if (signature !== expected) {
        return jsonResponse(res, 401, { error: 'Invalid signature' });
      }
    }

    const {
      customer_phone, customer_name, customer_email,
      product_name, amount, checkout_id,
    } = req.body;

    if (!customer_phone) {
      return jsonResponse(res, 400, { error: 'Missing customer_phone' });
    }

    const phone = customer_phone.replace(/[^0-9]/g, '');
    const program = mapExlyProduct(product_name);
    const weeks = programWeeks(program);
    const now = new Date();
    const endsAt = new Date(now.getTime() + weeks * 7 * 24 * 60 * 60 * 1000);

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .maybeSingle();

    if (lead) {
      await supabase
        .from('leads')
        .update({ status: 'converted' })
        .eq('id', lead.id);
    }

    const { data: client } = await supabase
      .from('clients')
      .insert({
        lead_id: lead?.id || null,
        phone,
        name: customer_name || lead?.name,
        email: customer_email,
        program,
        program_started_at: now.toISOString(),
        program_ends_at: endsAt.toISOString(),
        paid_amount: amount,
        checkout_id,
        folder_url: `clients/${phone}`,
        status: 'active',
      })
      .select()
      .single();

    await sendTemplate(phone, `onboard_${program}`, [
      `Welcome to ${programLabel(program)}! 🎉\n\n` +
      `Your program starts NOW. You'll receive your first check-in form in 7 days.\n\n` +
      `Got questions? Just reply here!`,
    ]);

    if (program === '12wk') {
      const baseUrl = process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : 'https://www.fitnessbymaddy.com';

      try {
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id, week_no: 1 }),
        });
      } catch (e) {
        console.error('Week-1 program generation failed:', e.message);
      }
    }

    return jsonResponse(res, 200, { ok: true, client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return jsonResponse(res, 500, { error: 'Internal error' });
  }
}

function mapExlyProduct(productName) {
  if (!productName) return '6wk_gym';
  const lower = productName.toLowerCase();
  if (lower.includes('12') || lower.includes('flagship') || lower.includes('custom')) return '12wk';
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40')) return '40plus';
  if (lower.includes('home')) return '6wk_home';
  if (lower.includes('trial')) return 'zoom_trial';
  if (lower.includes('zoom') && lower.includes('pack')) return 'zoom_pack';
  return '6wk_gym';
}
