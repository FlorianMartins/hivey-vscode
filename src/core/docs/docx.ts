// A Word document as text.
//
// A `.docx` is a ZIP whose `word/document.xml` holds the prose in WordprocessingML. Pulling the
// text out of it is honest work: the runs are plain `<w:t>` elements, paragraphs and breaks are
// marked, and what is lost — fonts, numbering, the exact shape of a table — is formatting rather
// than content. That is the test this has to pass. The project refuses what it cannot turn into
// something true, and attaching mojibake would be worse than refusing, because the model would
// answer confidently about the noise.
//
// What is lost and worth saying: a table becomes its cells separated by tabs, in reading order, and
// footnotes and comments are not followed. A document whose meaning is carried by its layout rather
// than by its sentences will read poorly, which is a property of that document.

import { readZipEntry } from "./zip.js";

export function docxText(data: Buffer): string | undefined {
  const xml = readZipEntry(data, "word/document.xml");
  if (!xml) return undefined;
  return wordXmlToText(xml.toString("utf8"));
}

export function wordXmlToText(xml: string): string {
  const out: string[] = [];
  // One pass over the markup, keeping only what carries text or separates it.
  const token = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\b[^>]*\/?>|<w:br\b[^>]*\/?>|<\/w:p>|<\/w:tc>/g;
  let m: RegExpExecArray | null;
  while ((m = token.exec(xml))) {
    const text = m[1];
    if (text !== undefined) {
      out.push(unescapeXml(text));
      continue;
    }
    const tag = m[0];
    if (tag.startsWith("<w:tab")) out.push("\t");
    else if (tag.startsWith("<w:br")) out.push("\n");
    else if (tag === "</w:tc>") out.push("\t");
    else out.push("\n"); // </w:p>
  }
  return out
    .join("")
    .replace(/\t+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function unescapeXml(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, "&");
}
