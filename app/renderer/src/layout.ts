/** Where a day's timed events go in the week grid (F2a). Pure, so it can be unit-tested. */

export interface Placed<T> {
  item: T;
  /** Minutes from midnight. */
  from: number;
  to: number;
  /** Column within the day, and how many columns the day needs. */
  lane: number;
  lanes: number;
}

const minutes = (at: string) => Number(at.slice(11, 13)) * 60 + Number(at.slice(14, 16));

/**
 * Events side by side when they overlap: each takes the first lane free at its start. One that
 * runs past midnight stops at the end of the day; a very short one still gets 15 minutes of room.
 */
export function layoutDay<T extends { startAt: string; endAt: string }>(day: string, events: T[]): Placed<T>[] {
  const lanes: number[] = [];
  const placed = [...events]
    .sort((a, b) => a.startAt.localeCompare(b.startAt))
    .map((item) => {
      const from = item.startAt.slice(0, 10) < day ? 0 : minutes(item.startAt);
      const to = item.endAt.slice(0, 10) > day ? 24 * 60 : Math.max(minutes(item.endAt), from + 15);
      let lane = lanes.findIndex((end) => end <= from);
      if (lane < 0) lane = lanes.push(to) - 1;
      else lanes[lane] = to;
      return { item, from, to, lane, lanes: 0 };
    });
  return placed.map((p) => ({ ...p, lanes: Math.max(1, lanes.length) }));
}
