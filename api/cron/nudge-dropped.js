const { supabase } = require('../_lib/supabase');
const { sendText, maskPhone } = require('../_lib/whatsapp');
const { CHECKOUT_BASE_URL } = require('../_lib/constants');

const TRIAL_LINK = `${CHECKOUT_BASE_URL}zoom_trial`;

module.exports = async function handler(req, res) {
  // Verify cron auth
  if (req.headers.authorization !== 'Bearer ' + process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const now = new Date();
    const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();
    const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(now - 14 * 24 * 60 * 60 * 1000).toISOString();

    let nudgesSent = 0;
    let markedDropped = 0;
    let reEngaged = 0;

    // --- 1. New leads with no reply in 2-24 hours: send nudge ---
    const { data: staleNewLeads, error: staleError } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('last_msg_at', twoHoursAgo)
      .gte('last_msg_at', twentyFourHoursAgo);

    if (staleError) {
      console.error('Failed to fetch stale new leads:', staleError.message);
    }

    if (staleNewLeads && staleNewLeads.length > 0) {
      for (const lead of staleNewLeads) {
        try {
          // Check if we already sent a nudge to this lead
          const { count } = await supabase
            .from('messages')
            .select('*', { count: 'exact', head: true })
            .eq('phone', lead.phone)
            .eq('direction', 'outbound')
            .eq('type', 'nudge');

          if (count > 0) {
            continue; // Already nudged
          }

          const message = `Hey! Still thinking it over? Maddy is offering a $20 trial session - zero commitment, full experience. Book here: ${TRIAL_LINK}`;
          const result = await sendText(lead.phone, message);

          if (result.success) {
            // Log as nudge type so we can track it
            await supabase.from('messages').insert({
              phone: lead.phone,
              direction: 'outbound',
              type: 'nudge',
              payload: { message, context: 'new_lead_2hr_nudge' },
              created_at: new Date().toISOString(),
            });
            nudgesSent++;
            console.log(`Nudge sent to new lead ${maskPhone(lead.phone)}`);
          }
        } catch (leadErr) {
          console.error(
            `Error nudging lead ${maskPhone(lead.phone)}:`,
            leadErr.message
          );
        }
      }
    }

    // --- 2. New leads with no reply in 24+ hours: mark as dropped ---
    const { data: deadNewLeads, error: deadError } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('last_msg_at', twentyFourHoursAgo);

    if (deadError) {
      console.error('Failed to fetch dead new leads:', deadError.message);
    }

    if (deadNewLeads && deadNewLeads.length > 0) {
      for (const lead of deadNewLeads) {
        try {
          const { error: updateError } = await supabase
            .from('leads')
            .update({
              status: 'dropped',
              updated_at: new Date().toISOString(),
            })
            .eq('id', lead.id);

          if (updateError) {
            console.error(
              `Failed to mark lead ${maskPhone(lead.phone)} as dropped:`,
              updateError.message
            );
          } else {
            markedDropped++;
            console.log(`Marked lead ${maskPhone(lead.phone)} as dropped (24hr no reply)`);
          }
        } catch (leadErr) {
          console.error(
            `Error dropping lead ${maskPhone(lead.phone)}:`,
            leadErr.message
          );
        }
      }
    }

    // --- 3. Dropped leads (7-14 days old): re-engagement ---
    const { data: droppedLeads, error: droppedError } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gte('created_at', fourteenDaysAgo)
      .lte('created_at', sevenDaysAgo);

    if (droppedError) {
      console.error('Failed to fetch dropped leads:', droppedError.message);
    }

    if (droppedLeads && droppedLeads.length > 0) {
      for (const lead of droppedLeads) {
        try {
          // Check if we already sent a re-engagement message
          const { count } = await supabase
            .from('messages')
            .select('*', { count: 'exact', head: true })
            .eq('phone', lead.phone)
            .eq('direction', 'outbound')
            .eq('type', 'reengagement');

          if (count > 0) {
            continue; // Already re-engaged, don't double-send
          }

          const message = `Hey! Maddy has a special offer running — $20 trial session. Want to try? ${TRIAL_LINK}`;
          const result = await sendText(lead.phone, message);

          if (result.success) {
            // Log as reengagement type
            await supabase.from('messages').insert({
              phone: lead.phone,
              direction: 'outbound',
              type: 'reengagement',
              payload: { message, context: 'dropped_7d_reengagement' },
              created_at: new Date().toISOString(),
            });
            reEngaged++;
            console.log(`Re-engagement sent to ${maskPhone(lead.phone)}`);
          }
        } catch (leadErr) {
          console.error(
            `Error re-engaging lead ${maskPhone(lead.phone)}:`,
            leadErr.message
          );
        }
      }
    }

    return res.status(200).json({
      nudges_sent: nudgesSent,
      marked_dropped: markedDropped,
      re_engaged: reEngaged,
    });
  } catch (err) {
    console.error('nudge-dropped cron error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
