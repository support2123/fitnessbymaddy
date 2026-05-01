const { notifyMaddy } = require('./whatsapp');
const { maskPhone } = require('./phone');

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'pain',
  'dizziness', 'dizzy', 'eating disorder', 'anorexia', 'bulimia',
  'not eating', 'starving', 'faint', 'hospital'
];

function needsEscalation(messageBody) {
  if (!messageBody) return false;
  const lower = messageBody.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

async function escalate(phone, reason, context) {
  const masked = maskPhone(phone);
  console.log(`ESCALATION [${reason}]: ${masked}`);
  await notifyMaddy(reason, `Lead ${masked}: ${context.slice(0, 100)}`);
}

async function checkMissedCheckins(db) {
  const { data: clients } = await db
    .from('clients')
    .select('id, phone, name')
    .eq('status', 'active');

  if (!clients) return;

  for (const client of clients) {
    const { data: checkins } = await db
      .from('checkins')
      .select('week_no')
      .eq('client_id', client.id)
      .order('week_no', { ascending: false })
      .limit(2);

    if (!checkins || checkins.length === 0) continue;

    const { data: latestProgram } = await db
      .from('programs')
      .select('week_no')
      .eq('client_id', client.id)
      .order('week_no', { ascending: false })
      .limit(1);

    if (!latestProgram || latestProgram.length === 0) continue;

    const currentWeek = latestProgram[0].week_no;
    const submittedWeeks = checkins.map(c => c.week_no);

    const missed = [];
    for (let w = currentWeek; w > Math.max(0, currentWeek - 2); w--) {
      if (!submittedWeeks.includes(w)) missed.push(w);
    }

    if (missed.length >= 2) {
      await escalate(
        client.phone,
        '2 consecutive missed check-ins',
        `${client.name} missed weeks ${missed.join(', ')}`
      );
    }
  }
}

module.exports = { needsEscalation, escalate, checkMissedCheckins };
