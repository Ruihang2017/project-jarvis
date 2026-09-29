/**
 * Streaming Markdown → ANSI renderer.
 *
 * Processes deltas as they arrive, holding back only the few characters needed to
 * disambiguate a construct (line-start markers, `**` vs `*`, link syntax). Covers
 * what chat replies actually use: headings, bullets, quotes, rules, fenced code,
 * inline code, bold, italic, links. Tables and everything else pass through as text.
 */

const ESC = "\x1b[";
const RESET = `${ESC}0m`;
const MAX_LINK_LOOKAHEAD = 400;
const ANSI_RE = /\x1b\[[0-9;]*m|\x1b\]8;;[^\x1b]*\x1b\\/g;

// Windows Terminal, iTerm2, VS Code and most modern terminals render OSC 8 hyperlinks.
const supportsHyperlinks = Boolean(
  process.env.WT_SESSION || process.env.TERM_PROGRAM === "vscode" || process.env.TERM_PROGRAM === "iTerm.app",
);

type LineKind = "plain" | "heading" | "quote" | "fence";

export class MarkdownStream {
  private pending = "";
  private atLineStart = true;
  private inFence = false;
  private line: LineKind = "plain";
  private bold = false;
  private italic = false;
  private code = false;
  private prev = ""; // last source char emitted, for italic open/close heuristics
  /** True when the last emitted character was a newline (or nothing emitted yet). */
  endsWithNewline = true;

  constructor(private readonly enabled: boolean) {}

  /** Feed a delta; returns what is safe to print now. */
  write(delta: string): string {
    if (!this.enabled) {
      if (delta) this.endsWithNewline = delta.endsWith("\n");
      return delta;
    }
    this.pending += delta;
    return this.drain(false);
  }

  /** End of message: render anything held back and reset styles. */
  flush(): string {
    if (!this.enabled) return "";
    const out = this.drain(true);
    const reset = this.bold || this.italic || this.code || this.line !== "plain" || this.inFence;
    this.bold = this.italic = this.code = this.inFence = false;
    this.line = "plain";
    this.atLineStart = true;
    return out + (reset ? RESET : "");
  }

  private drain(final: boolean): string {
    let out = "";
    while (this.pending) {
      const step = this.atLineStart ? this.lineStart(final) : this.inline(final);
      if (step === null) break; // need more input
      out += step;
    }
    const visible = out.replace(ANSI_RE, "");
    if (visible) this.endsWithNewline = visible.endsWith("\n");
    return out;
  }

  private take(n: number): string {
    const s = this.pending.slice(0, n);
    this.pending = this.pending.slice(n);
    return s;
  }

  private style(): string {
    let s = RESET;
    if (this.line === "heading") s += `${ESC}1;35m`;
    if (this.line === "quote") s += `${ESC}2m`;
    if (this.line === "fence") s += `${ESC}36m`;
    if (this.bold) s += `${ESC}1m`;
    if (this.italic) s += `${ESC}3m`;
    if (this.code) s += `${ESC}36m`;
    return s;
  }

  /** Decide how a new line begins. Returns null to wait for more input. */
  private lineStart(final: boolean): string | null {
    const nl = this.pending.indexOf("\n");
    const head = nl === -1 ? this.pending : this.pending.slice(0, nl);
    // Only indentation and marker characters so far: can't tell yet.
    if (!final && nl === -1 && /^[ \t]*[`#>*+\-_]*$/.test(head) && head.length < 80) return null;

    const indent = /^[ \t]*/.exec(head)![0];
    const rest = head.slice(indent.length);

    if (/^```/.test(rest)) {
      if (!final && nl === -1) return null; // consume the whole fence line
      this.take(nl === -1 ? this.pending.length : nl + 1);
      this.inFence = !this.inFence;
      this.prev = "\n";
      return this.inFence ? "" : RESET;
    }

    this.atLineStart = false;
    if (this.inFence) {
      this.line = "fence";
      return this.style();
    }

    if (/^([-*_])( ?\1){2,} *$/.test(rest) && (nl !== -1 || final)) {
      this.take(nl === -1 ? this.pending.length : nl + 1);
      this.atLineStart = true;
      this.prev = "\n";
      return `${ESC}2m${"─".repeat(40)}${RESET}\n`;
    }

    let m: RegExpExecArray | null;
    if ((m = /^#{1,6} /.exec(rest))) {
      this.take(indent.length + m[0].length);
      this.line = "heading";
      return indent + this.style();
    }
    if ((m = /^[-*+] /.exec(rest))) {
      this.take(indent.length + m[0].length);
      this.prev = " ";
      return `${indent}${ESC}2m•${RESET}${this.style()} `;
    }
    if ((m = /^> ?/.exec(rest))) {
      this.take(indent.length + m[0].length);
      this.line = "quote";
      return `${indent}${ESC}2m│${RESET} ${this.style()}`;
    }
    return "";
  }

  /** Render inline content up to the next decision point. Returns null to wait. */
  private inline(final: boolean): string | null {
    const c = this.pending[0]!;

    if (c === "\n") {
      this.take(1);
      const hadStyle = this.line !== "plain" || this.bold || this.italic || this.code;
      this.line = "plain";
      this.bold = this.italic = this.code = false;
      this.atLineStart = true;
      this.prev = "\n";
      return (hadStyle ? RESET : "") + "\n";
    }

    if (this.line === "fence") return this.takeRun(/[^\n]+/);

    if (c === "`") {
      this.take(1);
      this.code = !this.code;
      this.prev = c;
      return this.style();
    }
    if (this.code) return this.takeRun(/[^`\n]+/);

    if (c === "*") {
      if (this.pending.length < 2 && !final) return null;
      if (this.pending[1] === "*") {
        this.take(2);
        this.bold = !this.bold;
        return this.style();
      }
      const next = this.pending[1] ?? "";
      const opens = !this.italic && next !== "" && !/\s/.test(next);
      const closes = this.italic && !/\s/.test(this.prev);
      if (opens || closes) {
        this.take(1);
        this.italic = !this.italic;
        return this.style();
      }
      this.prev = this.take(1);
      return this.prev;
    }

    if (c === "[") {
      const link = /^\[([^\]\n]*)\]\(([^)\s]*)\)/.exec(this.pending);
      if (link) {
        this.take(link[0].length);
        this.prev = ")";
        const [, text, url] = link;
        const label = `${ESC}4;34m${text || url}${this.style()}`;
        return supportsHyperlinks ? `\x1b]8;;${url}\x1b\\${label}\x1b]8;;\x1b\\` : `${label} ${ESC}2m(${url})${this.style()}`;
      }
      // Could still become a link: wait, unless the line ended or it's too long to be one.
      const openEnded = !this.pending.includes("\n") && this.pending.length < MAX_LINK_LOOKAHEAD;
      if (!final && openEnded && /^\[[^\]\n]*(\](\([^)\s]*)?)?$/.test(this.pending)) return null;
      this.prev = this.take(1);
      return this.prev;
    }

    return this.takeRun(/[^\n`*[]+/);
  }

  private takeRun(re: RegExp): string {
    const m = re.exec(this.pending);
    const s = this.take(m && m.index === 0 ? m[0].length : 1);
    this.prev = s.at(-1) ?? this.prev;
    return s;
  }
}
