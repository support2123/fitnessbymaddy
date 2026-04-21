const { getSupabase } = require('./_lib/supabase');
const { sendTemplate, sendTextMessage } = require('./_lib/whatsapp');
const { sendEmail } = require('./_lib/resend');
const {
  PROGRAM_NAMES, programDurationWeeks, detectMarket, isHinglish,
  errorResponse, jsonResponse
} = require('./_lib/utils');
const crypto = require('crypto');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return errorResponse(res, 'POST only', 405);

  const db = getSupabase();

  try {
    const secret = process.env.EXLY_WEBHOOK_SECRET;
    if (secret) {
      const sig = req.headers['x-exly-signature'] || req.headers['x-webhook-signature'];
      if (sig) {
        const expected = crypto.createHmac('sha256', secret)
          .update(JSON.stringify(req.body)).digest('hex');
        if (sig !== expected) return errorResponse(res, 'Invalid signature', 401);
      }
    }

    const {
      customer_phone, customer_name, customer_email,
      product_name, amount, checkout_id, order_id
    } = req.body;

    const phone = normalizePhone(customer_phone);
    if (!phone) return errorResponse(res, 'Missing customer phone');

    const program = mapProductToProgram(product_name);

    const { data: lead } = await db
      .from('leads').select('*').eq('phone', phone).single();

    if (lead) {
      await db.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    const durationWeeks = programDurationWeeks(program);
    const endsAt = new Date();
    endsAt.setDate(endsAt.getDate() + durationWeeks * 7);

    const { data: client, error } = await db.from('clients').insert({
      lead_id: lead?.id || null,
      phone,
      name: customer_name,
      email: customer_email,
      program,
      program_started_at: new Date().toISOString(),
      program_ends_at: endsAt.toISOString(),
      paid_amount: amount,
      checkout_id: checkout_id || order_id,
      folder_url: null,
      status: 'active'
    }).select().single();

    if (error) throw error;

    const folderPath = `clients/${client.id}`;
    await db.storage.from('programs').upload(`${folderPath}/.keep`, new Uint8Array(0), {
      contentType: 'text/plain', upsert: true
    });
    await db.from('clients').update({ folder_url: folderPath }).eq('id', client.id);

    const market = detectMarket(phone);
    const programLabel = PROGRAM_NAMES[program] || program;

    if (isHinglish(market)) {
      await sendTextMessage(phone,
        `🎉 Welcome to the team, ${customer_name || 'champ'}!\n\n` +
        `*${programLabel}* — tumhara program active ho gaya hai.\n\n` +
        `📋 Day 7 pe tumhara pehla check-in form aayega. Tab tak apna intake form zaroor bhar dena:\n` +
        `➡️ https://fitnessbymaddy.com/intake?lead=${lead?.id || client.id}\n\n` +
        `Let's go! 💪`
      );
    } else {
      await sendTextMessage(phone,
        `🎉 Welcome aboard, ${customer_name || 'champ'}!\n\n` +
        `*${programLabel}* is now active.\n\n` +
        `📋 Your first check-in form arrives on Day 7. In the meantime, fill out your intake form:\n` +
        `➡️ https://fitnessbymaddy.com/intake?lead=${lead?.id || client.id}\n\n` +
        `Let's crush it! 💪`
      );
    }

    if (customer_email) {
      await sendEmail({
        to: customer_email,
        subject: `Welcome to ${programLabel} — Fitness by Maddy`,
        html: `
          <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:40px 20px">
            <h1 style="color:#2C2C2C;font-size:24px">Welcome, ${customer_name || 'there'}!</h1>
            <p style="color:#6B6B6B;line-height:1.7">Your <strong>${programLabel}</strong> program is now active.</p>
            <p style="color:#6B6B6B;line-height:1.7">Here's what happens next:</p>
            <ul style="color:#6B6B6B;line-height:2">
              <li>Fill out your <a href="https://fitnessbymaddy.com/intake?lead=${lead?.id || client.id}" style="color:#B8965A">intake form</a></li>
              <li>Your first check-in form arrives on Day 7 via WhatsApp</li>
              <li>Weekly programs are delivered every Sunday</li>
            </ul>
            <p style="color:#6B6B6B;line-height:1.7">Questions? Reply to this email or message us on WhatsApp.</p>
            <p style="color:#B8965A;font-weight:600;margin-top:32px">— Team Fitness by Maddy</p>
          </div>`
      });
    }

    if (program === '12wk') {
      try {
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'https://fitnessbymaddy.com';
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id, week_no: 1 })
        });
      } catch (e) {
        console.error('Auto-generate week 1 failed:', e.message);
      }
    }

    return jsonResponse(res, { success: true, client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return errorResponse(res, 'Internal error', 500);
  }
};

function normalizePhone(phone) {
  if (!phone) return null;
  let cleaned = phone.replace(/[^0-9+]/g, '');
  if (!cleaned.startsWith('+')) cleaned = '+' + cleaned;
  return cleaned;
}

function mapProductToProgram(productName) {
  if (!productName) return '6wk_gym';
  const lower = productName.toLowerCase();
  if (lower.includes('12') || lower.includes('custom') || lower.includes('flagship')) return '12wk';
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40') || lower.includes('strong')) return '40plus';
  if (lower.includes('home')) return '6wk_home';
  if (lower.includes('zoom') && lower.includes('trial')) return 'zoom_trial';
  if (lower.includes('zoom')) return 'zoom_pack';
  return '6wk_gym';
}
