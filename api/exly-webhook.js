const crypto = require('crypto');
const { supabase } = require('./_lib/supabase');
const { sendTemplate, notifyMaddy } = require('./_lib/whatsapp');
const { maskPhone } = require('./_lib/pii');

const PROGRAM_MAP = {
  '6wk_gym': { weeks: 6, name: '6-Week Burn & Build (Gym)' },
  '6wk_home': { weeks: 6, name: '6-Week Burn & Build (Home)' },
  '12wk': { weeks: 12, name: '12-Week Custom Training' },
  'pcos': { weeks: 8, name: 'PCOS Warrior' },
  '40plus': { weeks: 8, name: '40+ Strong' },
  'zoom_trial': { weeks: 1, name: 'Zoom Trial Session' },
  'zoom_pack': { weeks: 4, name: 'Zoom Session Pack' },
};

function verifyWebhookSignature(body, signature) {
  const secret = process.env.EXLY_WEBHOOK_SECRET;
  if (!secret) return true;
  const hash = crypto.createHmac('sha256', secret).update(JSON.stringify(body)).digest('hex');
  return hash === signature;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const signature = req.headers['x-exly-signature'] || '';
    if (!verifyWebhookSignature(req.body, signature)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const {
      customer_phone,
      customer_name,
      customer_email,
      product_id,
      checkout_id,
      amount,
      status,
    } = req.body;

    if (status !== 'completed' && status !== 'paid') {
      if (status === 'failed') {
        const { data: lead } = await supabase
          .from('leads')
          .select('*')
          .eq('phone', customer_phone)
          .limit(1);

        if (lead && lead.length > 0) {
          await notifyMaddy(
            'Payment failed for active lead',
            `Phone: ${maskPhone(customer_phone)}\nName: ${customer_name}\nAmount: ${amount}`
          );
        }
      }
      return res.status(200).json({ action: 'ignored', status });
    }

    const program = product_id || '6wk_gym';
    const programInfo = PROGRAM_MAP[program] || PROGRAM_MAP['6wk_gym'];
    const startDate = new Date();
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + programInfo.weeks * 7);

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', customer_phone)
      .order('created_at', { ascending: false })
      .limit(1);

    const leadId = lead?.[0]?.id || null;

    if (leadId) {
      await supabase.from('leads').update({ status: 'converted' }).eq('id', leadId);
    }

    const folderPath = `clients/${crypto.randomUUID()}`;

    const { data: client, error } = await supabase
      .from('clients')
      .insert({
        lead_id: leadId,
        phone: customer_phone,
        name: customer_name,
        email: customer_email,
        program,
        program_started_at: startDate.toISOString(),
        program_ends_at: endDate.toISOString(),
        paid_amount: amount,
        checkout_id,
        folder_url: folderPath,
        status: 'active',
      })
      .select()
      .single();

    if (error) throw error;

    const templateName = `onboard_${program}`;
    await sendTemplate(customer_phone, templateName, [
      customer_name || 'there',
      programInfo.name,
      programInfo.weeks.toString(),
    ]);

    if (program === '12wk') {
      try {
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'https://fitnessbymaddy.com';
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id, week_no: 1 }),
        });
      } catch (e) {
        console.error('[Exly] Failed to trigger Week 1 program:', e.message);
      }
    }

    console.log(`[Exly] Conversion: ${maskPhone(customer_phone)} → ${program}`);

    return res.status(200).json({
      success: true,
      client_id: client.id,
      program: programInfo.name,
    });
  } catch (error) {
    console.error('[Exly Error]', error.message);
    return res.status(500).json({ error: 'Failed to process purchase' });
  }
};
