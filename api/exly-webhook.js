const { getSupabase } = require('../lib/supabase');
const { sendTemplate, detectMarket, isHinglish } = require('../lib/whatsapp');
const { jsonResponse, errorResponse } = require('../lib/utils');
const crypto = require('crypto');

const PROGRAM_DURATION = {
  '6wk_gym': 42,
  '6wk_home': 42,
  '12wk': 84,
  'pcos': 42,
  '40plus': 42,
  'zoom_trial': 7,
  'zoom_pack': 30
};

module.exports = async function handler(req) {
  if (req.method !== 'POST') return errorResponse('Method not allowed', 405);

  // Verify webhook signature
  const signature = req.headers.get('x-exly-signature');
  const rawBody = await req.text();
  if (process.env.EXLY_WEBHOOK_SECRET && signature) {
    const expected = crypto
      .createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
      .update(rawBody)
      .digest('hex');
    if (signature !== expected) {
      return errorResponse('Invalid signature', 401);
    }
  }

  const body = JSON.parse(rawBody);
  const { phone, email, name, amount, checkout_id, product_name } = body;

  if (!phone) return errorResponse('Missing phone');

  const db = getSupabase();

  // Find matching lead
  const normalizedPhone = phone.replace(/\D/g, '');
  const { data: lead } = await db
    .from('leads')
    .select('*')
    .or(`phone.eq.${normalizedPhone},phone.eq.+${normalizedPhone}`)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  const program = lead?.program_interest || 'zoom_trial';
  const durationDays = PROGRAM_DURATION[program] || 42;
  const programEnds = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000);

  // Update lead status
  if (lead) {
    await db.from('leads').update({ status: 'converted' }).eq('id', lead.id);
  }

  // Create or update client
  const clientData = {
    lead_id: lead?.id || null,
    phone: normalizedPhone,
    name: name || lead?.name || null,
    email: email || null,
    program,
    program_started_at: new Date().toISOString(),
    program_ends_at: programEnds.toISOString(),
    paid_amount: amount || 0,
    checkout_id: checkout_id || null,
    status: 'active'
  };

  let clientId;
  if (lead) {
    const { data: existingClient } = await db
      .from('clients')
      .select('id')
      .eq('lead_id', lead.id)
      .single();

    if (existingClient) {
      await db.from('clients').update(clientData).eq('id', existingClient.id);
      clientId = existingClient.id;
    } else {
      const { data: newClient } = await db.from('clients').insert(clientData).select('id').single();
      clientId = newClient.id;
    }
  } else {
    const { data: newClient } = await db.from('clients').insert(clientData).select('id').single();
    clientId = newClient.id;
  }

  // Create storage folder
  const folderPath = `clients/${clientId}/.keep`;
  await db.storage.from('client-files').upload(folderPath, Buffer.from(''), { upsert: true });
  await db.from('clients').update({ folder_url: `clients/${clientId}/` }).eq('id', clientId);

  // Send onboarding WhatsApp
  const market = detectMarket(normalizedPhone);
  const templateName = isHinglish(market) ? `onboard_${program}_hi` : `onboard_${program}`;
  await sendTemplate(normalizedPhone, templateName, {
    isClient: true,
    name: name || 'there'
  });

  // If 12-week program, trigger immediate Week-1 generation
  if (program === '12wk') {
    try {
      const baseUrl = process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : 'https://fitnessbymaddy.com';
      await fetch(`${baseUrl}/api/generate-program`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.INTERNAL_API_SECRET}`
        },
        body: JSON.stringify({ client_id: clientId, week_no: 1 })
      });
    } catch (e) {
      console.error('Week-1 generation trigger failed:', e.message);
    }
  }

  return jsonResponse({ success: true, client_id: clientId, program });
};
