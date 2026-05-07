const { supabase } = require('../_lib/supabase');
const { sendTemplate, maskPhone } = require('../_lib/whatsapp');

const MAX_NUDGE_COUNT = 2;
const DROPPED_WINDOW_DAYS = 7;
const COOLDOWN_HOURS = 24;
const NUDGE_1_HOURS = 24;
const NUDGE_2_HOURS = 48;

module.exports = async function handler(req, res) {
  // --- Cron auth ---
  const authHeader = req.headers.authorization || '';
  if (authHeader !== 'Bearer ' + process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const summary = {
    dropped_leads: { sent: 0, skipped: 0 },
    checkin_nudges: { nudge_1_sent: 0, nudge_2_sent: 0, skipped: 0 },
    errors: [],
  };

  try {
    const now = new Date();

    // =============================================
    // PART 1: Re-engage dropped leads (7-day rule)
    // =============================================
    const droppedCutoff = new Date(now.getTime() - DROPPED_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const cooldownCutoff = new Date(now.getTime() - COOLDOWN_HOURS * 60 * 60 * 1000).toISOString();

    const { data: droppedLeads, error: droppedErr } = await supabase
      .from('clients')
      .select('id, name, phone, dropped_at, last_msg_at, nudge_count')
      .eq('status', 'dropped')
      .gte('dropped_at', droppedCutoff)
      .lt('nudge_count', MAX_NUDGE_COUNT);

    if (droppedErr) {
      console.error('Failed to fetch dropped leads:', droppedErr.message);
      summary.errors.push('dropped_leads_query_failed');
    }

    if (droppedLeads && droppedLeads.length > 0) {
      for (const lead of droppedLeads) {
        try {
          // Check cooldown: last_msg_at must be > 24hrs ago
          if (lead.last_msg_at && lead.last_msg_at > cooldownCutoff) {
            summary.dropped_leads.skipped++;
            continue;
          }

          const result = await sendTemplate(lead.phone, 'win_back_v1', {
            userName: lead.name || lead.phone,
            templateParams: [
              lead.name || 'there',
              `${process.env.SITE_URL || 'https://fitnessbymaddy.com'}/trial`,
            ],
          });

          if (result.success) {
            // Update last_msg_at and increment nudge_count
            const { error: updateErr } = await supabase
              .from('clients')
              .update({
                last_msg_at: now.toISOString(),
                nudge_count: (lead.nudge_count || 0) + 1,
              })
              .eq('id', lead.id);

            if (updateErr) {
              console.error(
                `Failed to update lead ${maskPhone(lead.phone)}:`,
                updateErr.message
              );
            }

            summary.dropped_leads.sent++;
          } else {
            summary.dropped_leads.skipped++;
          }
        } catch (leadErr) {
          summary.errors.push(maskPhone(lead.phone || 'unknown'));
          console.error(
            `Error nudging dropped lead ${maskPhone(lead.phone || '')}:`,
            leadErr.message
          );
        }
      }
    }

    // =============================================
    // PART 2: Check-in nudge reminders
    // =============================================
    const { data: pendingReminders, error: remindersErr } = await supabase
      .from('checkin_reminders')
      .select('id, client_id, week_no, form_sent_at, nudge_count')
      .lt('nudge_count', 2);

    if (remindersErr) {
      console.error('Failed to fetch pending reminders:', remindersErr.message);
      summary.errors.push('reminders_query_failed');
    }

    if (pendingReminders && pendingReminders.length > 0) {
      for (const reminder of pendingReminders) {
        try {
          // Check if check-in has been submitted
          const { data: checkin } = await supabase
            .from('checkins')
            .select('id')
            .eq('client_id', reminder.client_id)
            .eq('week_no', reminder.week_no)
            .maybeSingle();

          if (checkin) {
            // Already submitted -- clean up the reminder
            await supabase
              .from('checkin_reminders')
              .delete()
              .eq('id', reminder.id);
            summary.checkin_nudges.skipped++;
            continue;
          }

          // Calculate hours since form was sent
          const formSentAt = new Date(reminder.form_sent_at);
          const hoursSinceSent = (now.getTime() - formSentAt.getTime()) / (60 * 60 * 1000);

          // Fetch client phone
          const { data: client } = await supabase
            .from('clients')
            .select('name, phone')
            .eq('id', reminder.client_id)
            .maybeSingle();

          if (!client || !client.phone) {
            summary.checkin_nudges.skipped++;
            continue;
          }

          let templateName = null;
          let nudgeLevel = null;

          if (reminder.nudge_count === 0 && hoursSinceSent >= NUDGE_1_HOURS) {
            templateName = 'checkin_reminder_1';
            nudgeLevel = 1;
          } else if (reminder.nudge_count === 1 && hoursSinceSent >= NUDGE_2_HOURS) {
            templateName = 'checkin_reminder_2';
            nudgeLevel = 2;
          }

          if (!templateName) {
            summary.checkin_nudges.skipped++;
            continue;
          }

          const checkinUrl = `${process.env.SITE_URL || 'https://fitnessbymaddy.com'}/checkin?c=${reminder.client_id}&w=${reminder.week_no}`;

          const result = await sendTemplate(client.phone, templateName, {
            userName: client.name || client.phone,
            templateParams: [
              client.name || 'there',
              String(reminder.week_no),
              checkinUrl,
            ],
          });

          if (result.success) {
            await supabase
              .from('checkin_reminders')
              .update({ nudge_count: (reminder.nudge_count || 0) + 1 })
              .eq('id', reminder.id);

            if (nudgeLevel === 1) {
              summary.checkin_nudges.nudge_1_sent++;
            } else {
              summary.checkin_nudges.nudge_2_sent++;
            }
          } else {
            summary.checkin_nudges.skipped++;
          }
        } catch (reminderErr) {
          summary.errors.push(`reminder_${reminder.id}`);
          console.error(
            `Error processing checkin reminder ${reminder.id}:`,
            reminderErr.message
          );
        }
      }
    }

    return res.status(200).json(summary);
  } catch (err) {
    console.error('Nudge-dropped cron error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
