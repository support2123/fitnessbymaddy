const { getSupabase } = require('./_lib/supabase');
const { sendTemplate } = require('./_lib/whatsapp');
const { detectMarket } = require('./_lib/market');

function maskPhone(phone) {
  if (!phone || phone.length < 4) return '***';
  return '***' + phone.slice(-3);
}

// Map Exly product_name to internal program codes
function mapProductToProgram(productName) {
  if (!productName) return null;
  const lower = productName.toLowerCase();

  if (lower.includes('6 week') || lower.includes('6-week') || lower.includes('6wk')) {
    return '6wk_gym';
  }
  if (lower.includes('12 week') || lower.includes('12-week') || lower.includes('12wk')) {
    return '12wk';
  }
  if (lower.includes('pcos')) {
    return 'pcos';
  }
  if (lower.includes('40+') || lower.includes('40 plus') || lower.includes('forty')) {
    return '40plus';
  }
  if (lower.includes('trial')) {
    return 'zoom_trial';
  }
  if (lower.includes('zoom pack') || lower.includes('zoom-pack')) {
    return 'zoom_pack';
  }
  return null;
}

// Program durations in weeks
const PROGRAM_DURATIONS = {
  '6wk_gym': 6,
  'pcos': 8,
  '40plus': 8,
  '12wk': 12,
  'zoom_trial': 1,
  'zoom_pack': 4,
};

function verifyWebhook(req) {
  const secret = process.env.EXLY_WEBHOOK_SECRET;
  if (!secret) return true; // No secret configured, skip verification

  // Check signature header
  const signature = req.headers['x-exly-signature'] || req.headers['x-webhook-signature'];
  if (signature) {
    return signature === secret;
  }

  // Check if secret is included as a field in the body
  if (req.body && req.body.webhook_secret) {
    return req.body.webhook_secret === secret;
  }

  // No signature or field found — reject if secret is configured
  return false;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Verify webhook authenticity
  if (!verifyWebhook(req)) {
    return res.status(401).json({ error: 'Invalid webhook signature' });
  }

  const supabase = getSupabase();

  try {
    const {
      customer_phone,
      customer_name,
      customer_email,
      product_name,
      amount,
      checkout_id,
    } = req.body || {};

    if (!customer_phone) {
      return res.status(400).json({ error: 'Missing customer_phone' });
    }

    // Normalize phone
    let phone = customer_phone.replace(/\s+/g, '');
    if (!phone.startsWith('+')) phone = '+' + phone;

    const program = mapProductToProgram(product_name);

    // Find or create lead
    let { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .maybeSingle();

    if (!lead) {
      const market = detectMarket(phone);
      const { data: newLead, error: leadErr } = await supabase
        .from('leads')
        .insert({
          phone,
          name: customer_name || null,
          source: 'exly',
          status: 'converted',
          first_msg: `Purchased: ${product_name}`,
          last_msg_at: new Date().toISOString(),
          program_interest: program,
          market,
        })
        .select('*')
        .single();

      if (leadErr) {
        console.error(`Lead create error for ${maskPhone(phone)}:`, leadErr.message);
        return res.status(500).json({ error: 'Failed to create lead' });
      }
      lead = newLead;
    } else {
      // Update existing lead
      await supabase
        .from('leads')
        .update({
          status: 'converted',
          program_interest: program || lead.program_interest,
          last_msg_at: new Date().toISOString(),
          name: customer_name || lead.name,
        })
        .eq('id', lead.id);
    }

    // Calculate program dates
    const programStartedAt = new Date().toISOString();
    let programEndsAt = null;

    if (program && PROGRAM_DURATIONS[program]) {
      const endDate = new Date();
      endDate.setDate(endDate.getDate() + PROGRAM_DURATIONS[program] * 7);
      programEndsAt = endDate.toISOString();
    }

    // Create client record
    const { data: client, error: clientErr } = await supabase
      .from('clients')
      .insert({
        lead_id: lead.id,
        phone,
        name: customer_name || lead.name || null,
        email: customer_email || null,
        program,
        program_started_at: programStartedAt,
        program_ends_at: programEndsAt,
        paid_amount: amount || null,
        checkout_id: checkout_id || null,
        status: 'active',
      })
      .select('id')
      .single();

    if (clientErr) {
      console.error(`Client create error for ${maskPhone(phone)}:`, clientErr.message);
      return res.status(500).json({ error: 'Failed to create client' });
    }

    // Create Supabase storage folder path
    // Upload a placeholder to create the folder structure
    const folderPath = `clients/${client.id}/.keep`;
    await supabase.storage
      .from('client-files')
      .upload(folderPath, Buffer.from(''), {
        contentType: 'text/plain',
        upsert: true,
      });

    // Update client with folder_url
    const folderUrl = `clients/${client.id}/`;
    await supabase
      .from('clients')
      .update({ folder_url: folderUrl })
      .eq('id', client.id);

    // Send onboarding WhatsApp template
    const templateName = program ? `onboard_${program}` : 'onboard_general';
    await sendTemplate(phone, templateName, [
      customer_name || lead.name || 'there',
    ]);

    // For 12-week program, trigger first program generation
    if (program === '12wk') {
      try {
        const baseUrl =
          process.env.VERCEL_URL
            ? `https://${process.env.VERCEL_URL}`
            : 'http://localhost:3000';

        fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            client_id: client.id,
            week_no: 1,
          }),
        }).catch((fetchErr) => {
          console.error(
            `Program generation trigger failed for client ${client.id}:`,
            fetchErr.message
          );
        });
      } catch (triggerErr) {
        console.error(
          `Program generation trigger error for client ${client.id}:`,
          triggerErr.message
        );
      }
    }

    return res.status(200).json({
      ok: true,
      client_id: client.id,
      program,
    });
  } catch (err) {
    const phone = req.body?.customer_phone;
    console.error(`Exly webhook error for ${maskPhone(phone)}:`, err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
