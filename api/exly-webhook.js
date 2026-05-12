const { getSupabase } = require('./lib/supabase');
const { sendTemplate } = require('./lib/whatsapp');
const { programDurationWeeks, cors } = require('./lib/helpers');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const secret = req.headers['x-webhook-secret'] || req.query.secret;
  if (secret !== process.env.EXLY_WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Invalid webhook secret' });
  }

  try {
    const {
      phone, name, email, program, amount,
      checkout_id, order_id,
    } = req.body;

    if (!phone || !program) {
      return res.status(400).json({ error: 'phone and program required' });
    }

    const db = getSupabase();

    await db.from('leads').upsert(
      {
        phone,
        name,
        status: 'converted',
        program_interest: program,
        last_msg_at: new Date().toISOString(),
      },
      { onConflict: 'phone' }
    );

    const { data: lead } = await db
      .from('leads')
      .select('id')
      .eq('phone', phone)
      .single();

    const durationWeeks = programDurationWeeks(program);
    const startsAt = new Date();
    const endsAt = new Date(startsAt.getTime() + durationWeeks * 7 * 24 * 60 * 60 * 1000);

    const { data: client, error } = await db.from('clients').upsert({
      lead_id: lead?.id || null,
      phone,
      name,
      email,
      program,
      program_started_at: startsAt.toISOString(),
      program_ends_at: endsAt.toISOString(),
      paid_amount: amount ? parseInt(amount) : null,
      checkout_id: checkout_id || order_id || null,
      folder_url: null,
      status: 'active',
    }, { onConflict: 'phone,program', ignoreDuplicates: false }).select().single();

    if (error) throw error;

    if (client) {
      const folderPath = `clients/${client.id}`;
      await db.storage.from('client-files').upload(
        `${folderPath}/.keep`,
        new Blob([''], { type: 'text/plain' }),
        { upsert: true }
      );

      await db.from('clients').update({
        folder_url: folderPath,
      }).eq('id', client.id);
    }

    await sendTemplate(phone, `onboard_${program}`, [
      name || 'there',
      `${durationWeeks} weeks`,
    ]);

    if (program === '12wk' && client) {
      try {
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'https://fitnessbymaddy.com';
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.INTERNAL_API_KEY}`,
          },
          body: JSON.stringify({ client_id: client.id, week_no: 1 }),
        });
      } catch (e) {
        console.error('Week-1 program generation failed:', e.message);
      }
    }

    return res.status(200).json({ ok: true, client_id: client?.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Failed to process purchase' });
  }
};
