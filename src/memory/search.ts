/**
 * Lexical relevance scoring for memories (no embeddings are available with a ChatGPT login).
 * Latin text → lowercase words; CJK runs → overlapping bigrams, so "我老板" matches "老板".
 * Scores with BM25 over text + keywords; the corpus is small enough to score in full.
 */

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
// Bigrams that appear in almost every memory ("用户住在…", "我的经理…") and carry no topic.
const CJK_STOP = new Set(["用户", "我的", "是我", "我是", "的是", "他的", "她的", "用户的", "户住", "户在", "户是", "户有"]);
const STOP = new Set(
  "a an and are as at be but by for from has have i in is it its me my of on or our so that the this to was we were what when where which who why will with you your do does did can could would should about user users".split(" "),
);

export function tokenize(text: string): string[] {
  const out: string[] = [];
  const norm = text.normalize("NFKC").toLowerCase();
  // Split into runs of CJK vs. latin/digits; everything else separates.
  for (const m of norm.matchAll(/([\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+)|([\p{L}\p{N}]+)/gu)) {
    const run = m[0];
    if (CJK.test(run)) {
      if (run.length === 1) out.push(run);
      for (let i = 0; i + 1 < run.length; i++) {
        const bigram = run.slice(i, i + 2);
        if (!CJK_STOP.has(bigram)) out.push(bigram);
      }
    } else if (run.length > 1 && !STOP.has(run)) {
      out.push(run);
    }
  }
  return out;
}

export interface ScoredDoc<T> {
  doc: T;
  score: number;
}

/** BM25 (k1=1.2, b=0.75). `fields` returns weighted text per doc, e.g. keywords count 1.5×. */
export function rank<T>(query: string, docs: T[], fields: (d: T) => [text: string, weight: number][]): ScoredDoc<T>[] {
  const qTerms = [...new Set(tokenize(query))];
  if (!qTerms.length || !docs.length) return [];

  const tf = docs.map((d) => {
    const counts = new Map<string, number>();
    let len = 0;
    for (const [text, weight] of fields(d)) {
      for (const t of tokenize(text)) {
        counts.set(t, (counts.get(t) ?? 0) + weight);
        len += weight;
      }
    }
    return { counts, len };
  });
  const avgLen = tf.reduce((s, x) => s + x.len, 0) / docs.length || 1;
  const df = new Map(qTerms.map((t) => [t, tf.filter((x) => x.counts.has(t)).length]));

  const k1 = 1.2, b = 0.75, N = docs.length;
  return docs
    .map((doc, i) => {
      const { counts, len } = tf[i]!;
      let score = 0;
      for (const t of qTerms) {
        const f = counts.get(t);
        if (!f) continue;
        const n = df.get(t)!;
        const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
        score += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * len) / avgLen)));
      }
      return { doc, score };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);
}
