import { createClient } from '../lib/supabase.js';
import {
  detectMarket,
  maskPhone,
  isEscalation,
  classifyLead,
  programCheckoutUrl,
  parseBody,
  cors,
} from '../lib/helpers.js';
import { sendTemplate, sendText } from '../lib/whatsapp.js';

// ── Constants ────────────────────────────────────────────────────
const OPT_OUT_RE = /\b(stop|unsubscribe)\b/i;
const INTAKE_FORM_URL = 'https://fitnessbymaddy.com/intake';

// ── Handler ──────────────────────────────────────────────────────
export default async function handler(req, res) {
  // CORS preflight
  if (cors(res)) return;

  const db = createClient();
  let phone = 'unknown';

  try {
    const body = await parseBody(req);
    phone = body.phone;
    const message = body.message || '';
    const name = body.name || null;
    const masked = maskPhone(phone);

    if (!phone) {
      console.warn('[webhook] Missing phone in payload');
      return res.status(200).json({ success: true });
    }

    console.log(`[webhook] Inbound from ${masked}: ${message.slice(0, 80)}`);

    // ── 1. Log inbound message ───────────────────────────────────
    await db.from('messages').insert({
      phone,
      direction: 'in',
      body: message,
    });

    // ── 2. Opt-out check ─────────────────────────────────────────
    if (OPT_OUT_RE.test(message)) {
      console.log(`[webhook] Opt-out from ${masked}`);
      await db
        .from('leads')
        .update({ status: 'dropped' })
        .eq('phone', phone);
      return res.status(200).json({ success: true });
    }

    // ── 3. Escalation check ──────────────────────────────────────
    if (isEscalation(message)) {
      const maddyPhone = process.env.MADDY_PHONE;
      if (maddyPhone) {
        await sendText(
          maddyPhone,
          `🚨 Escalation from ${masked}:\n"${message.slice(0, 500)}"`
        );
      }
      console.log(`[webhook] Escalation forwarded for ${masked}`);
      // Continue normal flow — do not return
    }

    // ── 4. Active client? → support message ──────────────────────
    const { data: client } = await db
      .from('clients')
      .select('id, status')
      .eq('phone', phone)
      .eq('status', 'active')
      .maybeSingle();

    if (client) {
      console.log(`[webhook] Active client message from ${masked}`);
      const maddyPhone = process.env.MADDY_PHONE;
      if (maddyPhone) {
        await sendText(
          maddyPhone,
          `💬 Client msg from ${masked}:\n"${message.slice(0, 500)}"`
        );
      }
      return res.status(200).json({ success: true });
    }

    // ── 5. Existing lead? ────────────────────────────────────────
    const { data: existingLead } = await db
      .from('leads')
      .select('id, status, market')
      .eq('phone', phone)
      .maybeSingle();

    if (existingLead) {
      // Dropped → never message again
      if (existingLead.status === 'dropped') {
        console.log(`[webhook] Dropped lead ${masked} — ignoring`);
        return res.status(200).json({ success: true });
      }

      // FLOW B — lead replied to our outreach
      if (existingLead.status === 'new' || existingLead.status === 'qualified') {
        const program = classifyLead(message);
        const market = existingLead.market || detectMarket(phone);

        if (program) {
          // Update lead to qualified with program interest
          await db
            .from('leads')
            .update({
              status: 'qualified',
              program_interest: program,
              last_msg_at: new Date().toISOString(),
            })
            .eq('id', existingLead.id);

          const checkoutUrl = programCheckoutUrl(program);

          if (market === 'IN') {
            await sendTemplate(phone, 'qualified_in_v1', [
              checkoutUrl,
              INTAKE_FORM_URL,
            ]);
          } else {
            await sendTemplate(phone, 'qualified_en_v1', [
              checkoutUrl,
              INTAKE_FORM_URL,
            ]);
          }

          console.log(`[webhook] Lead ${masked} qualified → ${program}`);
        } else {
          // Could not classify — update last_msg_at so we know they replied
          await db
            .from('leads')
            .update({ last_msg_at: new Date().toISOString() })
            .eq('id', existingLead.id);

          console.log(`[webhook] Lead ${masked} replied but no program match`);
        }

        return res.status(200).json({ success: true });
      }
    }

    // ── 6. Brand-new lead — FLOW A ───────────────────────────────
    const market = detectMarket(phone);

    const { error: insertErr } = await db.from('leads').insert({
      phone,
      name,
      source: 'whatsapp',
      status: 'new',
      first_msg: message,
      last_msg_at: new Date().toISOString(),
      market,
    });

    if (insertErr) {
      // Unique constraint — lead was created between our read and insert (race)
      console.warn(`[webhook] Lead insert conflict for ${masked}:`, insertErr.message);
      return res.status(200).json({ success: true });
    }

    // Send welcome template
    if (market === 'IN') {
      await sendTemplate(phone, 'welcome_v1', [
        "Hi! Maddy's team here 👋 Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?",
      ]);
    } else {
      await sendTemplate(phone, 'welcome_v1', [
        "Hi! Maddy's team here 👋 What's your fitness goal — fat loss, PCOS management, strength, or 40+ fitness? Want to try a trial session first?",
      ]);
    }

    console.log(`[webhook] New lead created for ${masked} (${market})`);
    return res.status(200).json({ success: true });
  } catch (err) {
    console.error(`[webhook] Error processing ${maskPhone(phone)}:`, err);
    // Always return 200 to acknowledge webhook delivery
    return res.status(200).json({ success: true });
  }
}
