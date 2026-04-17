const { notifyMaddy, maskPhone } = require("./whatsapp");

const ESCALATION_KEYWORDS = [
  "refund",
  "lawyer",
  "complaint",
  "didn't work",
  "side effect",
  "injury",
  "pregnant",
  "pregnancy",
  "medication",
  "pain",
  "dizziness",
  "dizzy",
  "eating disorder",
  "anorexia",
  "bulimia",
  "purging",
  "not eating",
];

function needsEscalation(text) {
  const lower = text.toLowerCase();
  return ESCALATION_KEYWORDS.some((kw) => lower.includes(kw));
}

async function escalate(phone, reason, messageBody) {
  const masked = maskPhone(phone);
  await notifyMaddy(
    reason,
    `From: ${masked}\nMessage: ${messageBody.slice(0, 200)}`
  );
}

async function checkMissedCheckins(db) {
  const { data: clients } = await db
    .from("clients")
    .select("id, phone, name")
    .eq("status", "active");

  if (!clients) return;

  for (const client of clients) {
    const { data: checkins } = await db
      .from("checkins")
      .select("week_no")
      .eq("client_id", client.id)
      .order("week_no", { ascending: false })
      .limit(2);

    if (!checkins || checkins.length === 0) continue;

    const latestWeek = checkins[0].week_no;
    const expectedWeek = getExpectedWeek(client);

    if (expectedWeek - latestWeek >= 2) {
      await notifyMaddy(
        "2 Consecutive Missed Check-ins",
        `Client: ${client.name} (${maskPhone(client.phone)})\nLast check-in: Week ${latestWeek}, Expected: Week ${expectedWeek}`
      );
    }
  }
}

function getExpectedWeek(client) {
  if (!client.program_started_at) return 1;
  const start = new Date(client.program_started_at);
  const now = new Date();
  const diffMs = now - start;
  return Math.floor(diffMs / (7 * 24 * 60 * 60 * 1000)) + 1;
}

module.exports = { needsEscalation, escalate, checkMissedCheckins };
