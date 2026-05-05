const {
  supabaseFetch,
  getLead,
  maskPhone,
  corsHeaders,
  handleCors,
} = require('./_lib/supabase');

/**
 * POST /api/exly-webhook
 * Handles Exly purchase confirmation webhooks
 */
export default async function handler(req, res) {
  if (handleCors(req, res)) return;

  Object.entries(corsHeaders()).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Validate webhook signature
    const signature = req.headers['x-exly-signature'];
    if (!signature) {
      return res.status(401).json({ error: 'Missing webhook signature' });
    }

    // Compute HMAC-SHA256 of the request body
    const crypto = require('crypto');
    const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    const expectedSignature = crypto
      .createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
      .update(rawBody)
      .digest('hex');

    if (signature !== expectedSignature) {
      console.error('Invalid Exly webhook signature');
      return res.status(401).json({ error: 'Invalid webhook signature' });
    }

    const {
      phone,
      name,
      email,
      amount,
      checkout_id,
      program_type,
      program,
    } = req.body;

    if (!phone || !checkout_id) {
      return res.status(400).json({ error: 'phone and checkout_id are required' });
    }

    const programName = program_type || program || 'general';
    console.log(`Exly purchase: ${maskPhone(phone)}, program=${programName}, amount=${amount}`);

    // Find lead by phone and update status
    const lead = await getLead(phone);
    if (lead) {
      await supabaseFetch(`/leads?phone=eq.${encodeURIComponent(phone)}`, {
        method: 'PATCH',
        body: {
          status: 'converted',
          converted_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      });
    }

    // Calculate program dates
    const startDate = new Date();
    let endDate = new Date();
    let totalWeeks = 6;

    if (programName.includes('12') || programName === '12wk_flagship') {
      totalWeeks = 12;
    } else if (programName === 'trial') {
      totalWeeks = 1;
    }
    endDate.setDate(endDate.getDate() + totalWeeks * 7);

    // Insert into clients table
    const clientData = {
      phone,
      name: name || (lead ? lead.name : null),
      email: email || (lead ? lead.email : null),
      lead_id: lead ? lead.id : null,
      program: programName,
      amount: amount ? Number(amount) : null,
      checkout_id,
      status: 'active',
      start_date: startDate.toISOString().split('T')[0],
      end_date: endDate.toISOString().split('T')[0],
      total_weeks: totalWeeks,
      current_week: 1,
      created_at: new Date().toISOString(),
    };

    const clientResult = await supabaseFetch('/clients', {
      method: 'POST',
      body: clientData,
    });

    const clientId = clientResult && clientResult.length > 0 ? clientResult[0].id : null;

    // Create storage folder by uploading a placeholder
    if (clientId) {
      try {
        const placeholderPath = `clients/${clientId}/.keep`;
        const placeholderContent = Buffer.from('');
        const storageUrl = `${process.env.SUPABASE_URL}/storage/v1/object/programs/${placeholderPath}`;
        await fetch(storageUrl, {
          method: 'POST',
          headers: {
            'apikey': process.env.SUPABASE_SERVICE_KEY,
            'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
            'Content-Type': 'text/plain',
            'x-upsert': 'true',
          },
          body: placeholderContent,
        });
      } catch (storageErr) {
        console.error('Storage folder creation failed:', storageErr.message);
      }
    }

    // Send welcome WhatsApp template
    const baseUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : 'http://localhost:3000';

    await fetch(`${baseUrl}/api/send-whatsapp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phone,
        template_name: 'welcome_onboarding',
        template_params: [name || 'there', programName, startDate.toLocaleDateString('en-IN')],
      }),
    });

    // If 12-week program, generate week 1 program
    if (totalWeeks === 12 && clientId) {
      try {
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            client_id: clientId,
            week_no: 1,
          }),
        });
        console.log(`Week 1 program generation triggered for client=${clientId}`);
      } catch (genErr) {
        console.error('Program generation trigger failed:', genErr.message);
      }
    }

    return res.status(200).json({
      success: true,
      client_id: clientId,
      program: programName,
    });
  } catch (error) {
    console.error('exly-webhook error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
