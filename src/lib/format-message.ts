export type MessageBlock =
  | { type: "section"; marker: string; title: string; content: string }
  | { type: "paragraph"; content: string }
  | { type: "bullet"; content: string }
  | { type: "number"; number: string; content: string };

const sectionMarkers = [
  "📋",
  "📌",
  "🗺",
  "🎯",
  "⚙",
  "📊",
  "🚫",
  "📝",
  "💡",
  "🔍",
  "📚",
];

const sectionTitles = [
  "ข้อควรปฏิบัติและข้อห้าม",
  "หน้าที่และความรับผิดชอบ",
  "หน้าที่ความรับผิดชอบ",
  "ตัวชี้วัดความสำเร็จ",
  "เอกสารอ้างอิง",
  "ขั้นตอนการทำงาน",
  "ขอบเขตงาน",
  "วัตถุประสงค์",
  "รายละเอียด",
  "คุณสมบัติ",
  "คำแนะนำ",
  "หมายเหตุ",
  "ตำแหน่ง",
  "สรุป",
  "Key performance indicators",
  "Responsibilities",
  "Recommendations",
  "References",
  "Objective",
  "Workflow",
  "Position",
  "Summary",
  "Details",
  "Scope",
  "Notes",
  "KPI",
];

const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function separateStructure(value: string) {
  let result = value.replace(/\r\n?/g, "\n").replaceAll("️", "").trim();

  for (const marker of sectionMarkers) {
    result = result.replace(
      new RegExp(`\\s*${escapeRegExp(marker)}\\s*`, "gu"),
      `\n${marker} `,
    );
  }

  result = result
    .replace(/\s*[▸►▪•]\s*/gu, "\n▸ ")
    .replace(/(?:^|\s)(\d{1,2}[.)])\s+/gu, "\n$1 ");

  return result
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function parseSection(line: string): MessageBlock | null {
  const marker = sectionMarkers.find((item) => line.startsWith(item));
  if (!marker) return null;

  const displayMarker = marker === "🗺" ? "🗺️" : marker === "⚙" ? "⚙️" : marker;
  const content = line.slice(marker.length).trim();
  const knownTitle = sectionTitles.find((title) =>
    content.toLocaleLowerCase().startsWith(title.toLocaleLowerCase()),
  );

  if (knownTitle) {
    return {
      type: "section",
      marker: displayMarker,
      title: knownTitle,
      content: content
        .slice(knownTitle.length)
        .replace(/^\s*[:：—–-]\s*/u, "")
        .trim(),
    };
  }

  const separator = content.search(/[:：—–]/u);
  if (separator > 0 && separator < 55) {
    return {
      type: "section",
      marker: displayMarker,
      title: content.slice(0, separator).trim(),
      content: content.slice(separator + 1).trim(),
    };
  }

  if (content.length <= 72) {
    return {
      type: "section",
      marker: displayMarker,
      title: content,
      content: "",
    };
  }

  return { type: "paragraph", content: `${displayMarker} ${content}` };
}

export function formatMessageBlocks(value: string): MessageBlock[] {
  if (!value.trim()) return [];

  return separateStructure(value).map((line) => {
    const section = parseSection(line);
    if (section) return section;

    const markdownHeading = line.match(/^#{1,6}\s+(.+)$/u);
    if (markdownHeading) {
      return {
        type: "section",
        marker: "",
        title: markdownHeading[1].replace(/\*\*/g, "").trim(),
        content: "",
      };
    }

    const numbered = line.match(/^(\d{1,2})[.)]\s*(.+)$/u);
    if (numbered) {
      return { type: "number", number: numbered[1], content: numbered[2] };
    }

    const bullet = line.match(/^(?:▸|►|▪|•|-|\*)\s*(.+)$/u);
    if (bullet) return { type: "bullet", content: bullet[1] };

    return { type: "paragraph", content: line };
  });
}
