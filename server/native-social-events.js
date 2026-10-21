// Event cursors advance over hidden records. Each scan is bounded and applies
// current title eligibility before the public page limit, with no provider
// detail calls per event. An incomplete scan returns its last examined cursor.
export async function readSocialEvents({
  policy,
  db,
  cursor,
  where = '1',
  values = [],
  limit = 100,
  now = Date.now,
  deadlineAt = policy.deadlineAt,
}) {
  const deadline = Math.min(now() + 12000, deadlineAt ?? Infinity),
    events = [];
  let complete = false;
  for (let batch = 0; batch < 20 && now() < deadline && events.length < limit; batch++) {
    await policy.current();
    const rows = await db.all(
      `SELECT sequence,event,payload FROM event_log WHERE sequence>? AND (${where}) ORDER BY sequence LIMIT 5000`,
      cursor,
      ...values,
    );
    if (!rows.length) {
      complete = true;
      break;
    }
    const mediaId =
      "COALESCE(json_extract(payload,'$.mediaId'),json_extract(payload,'$.room.mediaId'))";
    const parsed = rows.map((row) => ({ ...row, data: JSON.parse(row.payload) }));
    const ids = parsed.map((row) => row.data.mediaId || row.data.room?.mediaId).filter(Boolean);
    const accepted = await policy.mediaBatch(ids);
    const allowed = await db.all(
      `SELECT sequence,event,payload FROM event_log WHERE sequence>? AND sequence<=? AND (${where}) AND (${mediaId} IS NULL OR ${mediaId} IN (SELECT value FROM json_each(?))) ORDER BY sequence LIMIT ?`,
      cursor,
      rows.at(-1).sequence,
      ...values,
      JSON.stringify([...accepted.keys()]),
      limit - events.length,
    );
    for (const row of allowed) {
      const data = JSON.parse(row.payload),
        id = data.mediaId || data.room?.mediaId;
      if (id) await policy.media(id, { direct: false });
      events.push({ id: row.sequence, event: row.event, data });
    }
    cursor = events.length === limit ? allowed.at(-1).sequence : rows.at(-1).sequence;
    if (rows.length < 5000 && events.length < limit) {
      complete = true;
      break;
    }
  }
  await policy.atomic([]);
  return { events, cursor, complete };
}
