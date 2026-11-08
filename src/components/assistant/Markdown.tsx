import { Fragment, type ReactNode } from "react";

/**
 * A small, SAFE Markdown renderer for assistant answers: headings, paragraphs,
 * bold/italic/code, lists, tables, quotes, rules and fenced code. It builds
 * React elements only — model output is never injected as HTML, so a reply
 * cannot smuggle markup or script into the page. Links render as text.
 */

function inline(text: string, key = 0): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\*[^*\s][^*]*\*|\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    const k = `${key}-${i++}`;
    if (t.startsWith("**") || t.startsWith("__")) out.push(<strong key={k}>{inline(t.slice(2, -2), i)}</strong>);
    else if (t.startsWith("`")) out.push(<code key={k} className="md-code">{t.slice(1, -1)}</code>);
    else if (t.startsWith("[")) out.push(<span key={k}>{t.slice(1, t.indexOf("]"))}</span>);
    else out.push(<em key={k}>{inline(t.slice(1, -1), i)}</em>);
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const isTableRow = (l: string) => /^\s*\|.*\|\s*$/.test(l);
const isSeparator = (l: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);
const cells = (l: string) => l.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());

export default function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let k = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    if (line.trim().startsWith("```")) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) body.push(lines[i++]);
      i++;
      blocks.push(<pre key={k++} className="md-pre" dir="ltr">{body.join("\n")}</pre>);
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      const level = Math.min(4, h[1].length);
      const Tag = (["h3", "h3", "h4", "h5"] as const)[level - 1];
      blocks.push(<Tag key={k++} className={`md-h md-h${level}`} dir="auto">{inline(h[2])}</Tag>);
      i++;
      continue;
    }
    if (/^\s*(?:-\s*){3,}$|^\s*(?:\*\s*){3,}$|^\s*(?:_\s*){3,}$/.test(line)) {
      blocks.push(<hr key={k++} className="md-hr" />);
      i++;
      continue;
    }
    if (isTableRow(line) && i + 1 < lines.length && isSeparator(lines[i + 1])) {
      const head = cells(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && isTableRow(lines[i])) rows.push(cells(lines[i++]));
      blocks.push(
        <div key={k++} className="md-table-wrap">
          <table className="md-table" dir="auto">
            <thead>
              <tr>{head.map((c, j) => <th key={j}>{inline(c)}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri}>{head.map((_, j) => <td key={j}>{inline(r[j] ?? "")}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }
    if (/^\s*>/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) body.push(lines[i++].replace(/^\s*>\s?/, ""));
      blocks.push(<blockquote key={k++} className="md-quote" dir="auto">{inline(body.join(" "))}</blockquote>);
      continue;
    }
    const listRe = /^(\s*)([-*•]|\d+[.)])\s+(.*)$/;
    if (listRe.test(line)) {
      const ordered = /^\s*\d/.test(line);
      const items: { depth: number; text: string }[] = [];
      while (i < lines.length && (listRe.test(lines[i]) || (/^\s{2,}\S/.test(lines[i]) && items.length))) {
        const m = listRe.exec(lines[i]);
        if (m) items.push({ depth: m[1].length >= 2 ? 1 : 0, text: m[3] });
        else items[items.length - 1].text += ` ${lines[i].trim()}`;
        i++;
      }
      const List = ordered ? "ol" : "ul";
      blocks.push(
        <List key={k++} className={ordered ? "md-ol" : "md-ul"} dir="auto">
          {items.map((it, j) => (
            <li key={j} className={it.depth ? "md-li-nested" : undefined}>{inline(it.text)}</li>
          ))}
        </List>,
      );
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|```|\s*>|\s*([-*•]|\d+[.)])\s)/.test(lines[i]) && !isTableRow(lines[i])) para.push(lines[i++]);
    if (!para.length) para.push(lines[i++]);
    blocks.push(
      <p key={k++} className="md-p" dir="auto">
        {para.map((p, j) => (
          <Fragment key={j}>
            {j > 0 && <br />}
            {inline(p, j)}
          </Fragment>
        ))}
      </p>,
    );
  }
  return <div className="md">{blocks}</div>;
}
