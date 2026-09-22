const partsFormatter = new Map();

function formatter(timeZone) {
  if (!partsFormatter.has(timeZone)) {
    partsFormatter.set(
      timeZone,
      new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
      }),
    );
  }
  return partsFormatter.get(timeZone);
}

function localParts(instant, timeZone) {
  return Object.fromEntries(
    formatter(timeZone)
      .formatToParts(instant)
      .filter(({ type }) => type !== "literal")
      .map(({ type, value }) => [type, value]),
  );
}

function localText(instant, timeZone) {
  const parts = localParts(instant, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
}

export function localTimeToInstant(localTime, timeZone) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(localTime)) {
    throw new Error(
      "localTime must use YYYY-MM-DDTHH:mm or YYYY-MM-DDTHH:mm:ss",
    );
  }
  const normalized = localTime.length === 16 ? `${localTime}:00` : localTime;
  const [date, clock] = normalized.split("T");
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute, second] = clock.split(":").map(Number);
  const naive = Date.UTC(year, month - 1, day, hour, minute, second);
  const candidates = [];

  for (let offset = -14 * 60; offset <= 14 * 60; offset += 15) {
    const instant = new Date(naive - offset * 60 * 1000);
    if (localText(instant, timeZone) === normalized) candidates.push(instant);
  }

  if (candidates.length === 0) {
    throw new Error("localTime does not exist in the supplied time zone");
  }
  return new Date(
    Math.min(...candidates.map((candidate) => candidate.getTime())),
  );
}
