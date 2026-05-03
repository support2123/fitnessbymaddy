import supabase from './_lib/supabase.js';
import { sendTemplate } from './_lib/whatsapp.js';
import {
  maskPhone, programLabel, programPrice,
  jsonResponse, parseBody,
} from './_lib/helpers.js';

function programWeeks(program) {
  const weeks = {
    '6wk_gym': 6, '6wk_home': 6, '12wk': 12,
    'pcos': 8, '40plus': 8, 'zoom_trial': 1, 'zoom_pack': 8,
  };
  return weeks[program] || 6;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return jsonResponse(res, 405, { error: 'Method not allowed' });

  try {
    const body = await parseBody(req);

    const webhookSecret = req.headers['x-webhook-secret'] || body.webhook_secret;
    if (process.env.EXLY_WEBHOOK_SECRET && webhookSecret !== process.env.EXLY_WEBHOOK_SECRET) {
      return jsonResponse(res, 401, { error: 'Invalid webhook secret' });
    }

    const phone = body.phone || body.mobile || body.customer_phone;
    const email = body.email || body.customer_email;
    const name = body.name || body.customer_name;
    const checkoutId = body.checkout_id || body.order_id || body.transaction_id;
    const paidAmount = body.amount || body.paid_amount || 0;

    if (!phone) return jsonResponse(res, 400, { error: 'No phone number in purchase data' });

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!lead) {
      console.log(`Purchase from unknown lead: ${maskPhone(phone)}`);
      return jsonResponse(res, 404, { error: 'Lead not found for this phone' });
    }

    const program = lead.program_interest || '6wk_gym';
    const weeks = programWeeks(program);
    const now = new Date();
    const endsAt = new Date(now.getTime() + weeks * 7 * 24 * 60 * 60 * 1000);

    await supabase
      .from('leads')
      .update({ status: 'converted' })
      .eq('id', lead.id);

    const { data: client, error } = await supabase
      .from('clients')
      .insert({
        lead_id: lead.id,
        phone,
        name: name || lead.name,
        email,
        program,
        program_started_at: now.toISOString(),
        program_ends_at: endsAt.toISOString(),
        paid_amount: paidAmount,
        checkout_id: checkoutId,
        folder_url: null,
        status: 'active',
      })
      .select()
      .single();

    if (error) {
      console.error('Client insert error:', error.message);
      return jsonResponse(res, 500, { error: 'Failed to create client' });
    }

    const folderPath = `clients/${client.id}`;
    await supabase.storage
      .from('clients')
      .upload(`${folderPath}/.keep`, new Uint8Array(0), {
        contentType: 'text/plain',
        upsert: true,
      });

    await supabase
      .from('clients')
      .update({ folder_url: folderPath })
      .eq('id', client.id);

    await sendTemplate(phone, `onboard_${program}`, [
      name || lead.name || 'there',
      programLabel(program),
    ]);

    console.log(`Converted: ${maskPhone(phone)} → ${program} ($${paidAmount})`);

    return jsonResponse(res, 200, {
      success: true,
      client_id: client.id,
      program,
    });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return jsonResponse(res, 500, { error: 'Internal server error' });
  }
}
