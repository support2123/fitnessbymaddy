const { supabase } = require('./_lib/supabase');
const { sendTemplate, maskPhone } = require('./_lib/whatsapp');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-webhook-secret',
};

// Map purchase amount to program details
const AMOUNT_TO_PROGRAM = {
  20: { program: 'zoom_trial', name: 'Zoom Trial', duration_weeks: 1 },
  45: { program: 'pcos', name: 'PCOS Warrior', duration_weeks: 8 },
  50: { program: '40plus', name: '40+ Strong', duration_weeks: 8 },
  97: { program: '6wk_gym', name: '6 Week Burn & Build', duration_weeks: 6 },
  200: { program: '12wk', name: '12 Week Flagship', duration_weeks: 12 },
  297: { program: '12wk', name: '12 Week Flagship', duration_weeks: 12 },
  597: { program: 'zoom_pack', name: 'Zoom Pack', duration_weeks: 12 },
};

function calculateEndDate(durationWeeks) {
  const now = new Date();
  now.setDate(now.getDate() + durationWeeks * 7);
  return now.toISOString();
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    Object.entries(CORS_HEADERS).forEach(([k, v]) => res.setHeader(k, v));
    return res.status(200).end();
  }

  Object.entries(CORS_HEADERS).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Verify webhook secret
    const webhookSecret = req.headers['x-webhook-secret'];
    if (!webhookSecret || webhookSecret !== process.env.EXLY_WEBHOOK_SECRET) {
      console.warn('Exly webhook: invalid or missing secret');
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { phone, name, email, amount, checkout_id } = req.body || {};

    if (!phone || !amount) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['phone', 'amount'],
      });
    }

    // Normalize phone
    let normalizedPhone = phone.replace(/\s+/g, '').replace(/[^\d+]/g, '');
    if (!normalizedPhone.startsWith('+')) {
      normalizedPhone =
        normalizedPhone.length === 10
          ? `+91${normalizedPhone}`
          : `+${normalizedPhone}`;
    }

    // Determine program from amount
    const numericAmount = Number(amount);
    const programInfo = AMOUNT_TO_PROGRAM[numericAmount];
    if (!programInfo) {
      console.warn(
        `Exly webhook: unknown amount ${numericAmount} for ${maskPhone(normalizedPhone)}`
      );
      return res.status(400).json({ error: 'Unknown program amount' });
    }

    // Find and update lead
    const { data: lead, error: leadError } = await supabase
      .from('leads')
      .select('id')
      .eq('phone', normalizedPhone)
      .single();

    if (lead) {
      await supabase
        .from('leads')
        .update({
          status: 'converted',
          name: name || undefined,
          program_interest: programInfo.program,
          last_msg_at: new Date().toISOString(),
        })
        .eq('id', lead.id);
    } else {
      // Lead not found - create one retroactively as converted
      if (leadError && leadError.code !== 'PGRST116') {
        console.error(
          `Lead lookup failed for ${maskPhone(normalizedPhone)}:`,
          leadError.message
        );
      }

      await supabase.from('leads').insert({
        phone: normalizedPhone,
        name: name || null,
        status: 'converted',
        program_interest: programInfo.program,
        source: 'exly_direct',
        last_msg_at: new Date().toISOString(),
      });
    }

    // Calculate program end date
    const programEndsAt = calculateEndDate(programInfo.duration_weeks);

    // Insert into clients table
    const leadId = lead ? lead.id : null;
    const { data: client, error: clientError } = await supabase
      .from('clients')
      .insert({
        lead_id: leadId,
        phone: normalizedPhone,
        name: name || null,
        email: email || null,
        program: programInfo.program,
        paid_amount: numericAmount,
        checkout_id: checkout_id || null,
        program_started_at: new Date().toISOString(),
        program_ends_at: programEndsAt,
        folder_url: null,
        status: 'active',
      })
      .select()
      .single();

    if (clientError) {
      console.error(
        `Failed to insert client for ${maskPhone(normalizedPhone)}:`,
        clientError.message
      );
      return res.status(500).json({ error: 'Failed to create client record' });
    }

    const folderUrl = `/clients/${client.id}/`;
    await supabase
      .from('clients')
      .update({ folder_url: folderUrl })
      .eq('id', client.id);

    // Send onboarding WhatsApp template
    await sendTemplate(normalizedPhone, 'onboarding_welcome', [
      name || 'there',
      programInfo.name,
    ]);

    // If 12wk program, flag for Week 1 program generation
    if (programInfo.program === '12wk') {
      console.log(
        `12wk program purchased: flagging Week 1 generation for client=${client.id}`
      );

      await supabase.from('program_generation_queue').insert({
        client_id: client.id,
        week_no: 1,
        status: 'pending',
        created_at: new Date().toISOString(),
      }).then(({ error }) => {
        if (error) {
          // Table may not exist yet; log but don't fail
          console.warn('program_generation_queue insert skipped:', error.message);
        }
      });
    }

    return res.status(200).json({ success: true, client_id: client.id });
  } catch (err) {
    console.error('exly-webhook error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
