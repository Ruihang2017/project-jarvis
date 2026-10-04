// Several paged mail lists read as one, newest first (src/google/merged.ts, F1a).
const { MergedList } = await import("../src/google/merged.js");

const results: [string, boolean, string?][] = [];
const ok = (name: string, cond: boolean, info = "") => results.push([name, cond, info]);
const eq = (name: string, got: unknown, want: unknown) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

/** A source whose pages are given as lists of times (newest first within the source). */
const source = (key: string, pages: number[][], calls: string[] = []) => ({
  key,
  fetch: async (token?: string) => {
    const i = token ? Number(token) : 0;
    calls.push(`${key}${i}`);
    return { items: pages[i] ?? [], next: i + 1 < pages.length ? String(i + 1) : undefined };
  },
});
const take = async (list: InstanceType<typeof MergedList<number>>, n: number) => (await list.next(n)).map((x) => `${x.key}${x.item}`);

// a's second page holds 70, newer than b's 60: it must come out before 60.
const calls: string[] = [];
const list = new MergedList<number>([source("a", [[100, 80], [70, 10]], calls), source("b", [[90, 60, 50]], calls)], (t) => t);
eq("first page: newest across both", await take(list, 3), ["a100", "b90", "a80"]);
eq("a's next page is read before b's older mail is given out", await take(list, 2), ["a70", "b60"]);
eq("each page is fetched once", calls, ["a0", "b0", "a1"]);
eq("the rest", await take(list, 10), ["b50", "a10"]);
ok("nothing more", !list.more);
eq("asking again gives nothing", await take(list, 5), []);

// An empty page with more to follow is read past, not taken as the end.
const gappy = new MergedList<number>([source("a", [[], [40]]), source("b", [[30]])], (t) => t);
eq("empty page skipped", await take(gappy, 5), ["a40", "b30"]);

// One source failing doesn't stop the others; the failure is reported once.
const broken = { key: "x", fetch: async () => { throw new Error("expired"); } };
const partial = new MergedList<number>([broken, source("b", [[5, 3]])], (t) => t);
eq("other accounts still listed", await take(partial, 5), ["b5", "b3"]);
eq("failure reported", partial.problems.map((p) => [p.key, (p.error as Error).message]), [["x", "expired"]]);

// Items within a page arrive in any order: they are sorted.
const unsorted = new MergedList<number>([source("a", [[1, 9, 5]])], (t) => t);
eq("sorted within a page", await take(unsorted, 3), ["a9", "a5", "a1"]);

console.log(results.map(([n, pass, info]) => `${pass ? "PASS" : "FAIL"}  ${n}${pass ? "" : "  → " + info}`).join("\n"));
if (results.some(([, pass]) => !pass)) process.exitCode = 1;
