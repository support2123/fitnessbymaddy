const TRIGGERS = [
  "injury",
  "medical",
  "pregnant",
  "pregnancy",
  "medication",
  "medicine",
  "pain",
  "dizziness",
  "dizzy",
  "eating disorder",
  "anorexia",
  "bulimia",
  "refund",
  "lawyer",
  "complaint",
  "didn't work",
  "side effect",
  "didn't help",
];

function checkEscalation(messageText) {
  const lower = (messageText || "").toLowerCase();

  for (const trigger of TRIGGERS) {
    if (lower.includes(trigger)) {
      return { shouldEscalate: true, reason: trigger };
    }
  }

  return { shouldEscalate: false, reason: "" };
}

module.exports = { checkEscalation };
