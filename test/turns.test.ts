// Taking turns: the automatic mail jobs run one at a time, with a gap (Gmail counts requests per minute).
const { Turns } = await import("../src/background/turns.js");

const results: [string, boolean, string?][] = [];
const ok = (name: string, cond: boolean, info = "") => results.push([name, cond, info]);
const eq = (name: string, got: unknown, want: unknown) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

let time = 0;
const log: string[] = [];
const turns = new Turns(
  60_000,
  () => time,
  async (ms) => {
    log.push(`wait ${ms}`);
    time += ms;
  },
);
let running = 0;
let most = 0;
const job = (name: string, takes: number, fails = false) => async () => {
  most = Math.max(most, ++running);
  log.push(`${name} starts at ${time}`);
  await new Promise((r) => setTimeout(r, 1));
  time += takes;
  running--;
  if (fails) throw new Error(`${name} failed`);
  return name;
};

// Three jobs asked for together, as when Edward is opened in the morning.
const all = await Promise.allSettled([turns.run(job("bills", 5000)), turns.run(job("summary", 2000, true)), turns.run(job("trips", 1000))]);
eq("in the order asked, a minute after the one before ended", log, ["bills starts at 0", "wait 60000", "summary starts at 65000", "wait 60000", "trips starts at 127000"]);
eq("one at a time", most, 1);
eq("each gets its own result; a failure doesn't stop the next", all.map((r) => (r.status === "fulfilled" ? r.value : String(r.reason.message))), ["bills", "summary failed", "trips"]);

// Later in the day nothing waits.
log.length = 0;
time += 3_600_000;
eq("a job long after the last one starts at once", [await turns.run(job("evening summary", 1000)), log.length], ["evening summary", 1]);
log.length = 0;
time += 20_000;
await turns.run(job("soon after", 0));
eq("…and one soon after waits for the rest of the minute", log[0], "wait 40000");

console.log(results.map(([name, pass, info]) => `${pass ? "PASS" : "FAIL"}  ${name}${pass ? "" : "  → " + info}`).join("\n"));
if (results.some(([, pass]) => !pass)) process.exitCode = 1;
