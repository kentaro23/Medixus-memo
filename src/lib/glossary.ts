export const GLOSSARY_CATEGORY_OPTIONS = [
  "略語",
  "遺伝子",
  "疾患名",
  "薬剤",
  "手技",
  "その他",
] as const;

type ParsedGlossaryCsvCore = {
  term: string;
  reading: string | null;
  pronunciationVariants: string[];
  definition: string | null;
  detailedExplanation: string | null;
  fullForm: string | null;
  category: string | null;
  aliases: string[];
};

export type ParsedGlossaryCsvRow = ParsedGlossaryCsvCore & {
  rowNumber: number;
};

function uniqueStrings(values: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    result.push(trimmed);
  }

  return result;
}

export function toNullableText(value: string | null | undefined) {
  const normalized = value?.trim() ?? "";
  return normalized.length > 0 ? normalized : null;
}

export function parseListInput(value: string | null | undefined) {
  const normalized = value?.replace(/\r/g, "").trim() ?? "";
  if (!normalized) {
    return [] as string[];
  }

  return uniqueStrings(normalized.split(/[\n,、;|]+/g));
}

export function formatListInput(values: string[] | null | undefined) {
  return (values ?? []).join(", ");
}

function normalizeHeader(header: string) {
  return header.trim().toLowerCase().replace(/[\s_-]+/g, "");
}

function parseCsvMatrix(content: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  const input = content.replace(/^\uFEFF/, "");

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];

    if (inQuotes) {
      if (char === '"') {
        if (input[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      continue;
    }

    if (char === ",") {
      row.push(cell);
      cell = "";
      continue;
    }

    if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }

    if (char !== "\r") {
      cell += char;
    }
  }

  row.push(cell);
  if (row.length > 1 || row.some((value) => value.trim().length > 0)) {
    rows.push(row);
  }

  return rows;
}

function getCell(row: string[], index: number | undefined) {
  if (index === undefined) {
    return "";
  }
  return row[index] ?? "";
}

export function parseGlossaryCsv(rawCsv: string) {
  const matrix = parseCsvMatrix(rawCsv);
  if (matrix.length === 0) {
    return {
      rows: [] as ParsedGlossaryCsvRow[],
      error: "CSV内容が空です。",
    };
  }

  const headerRow = matrix[0].map((value) => value.trim());
  const headerIndex = new Map<string, number>();
  headerRow.forEach((header, index) => {
    headerIndex.set(normalizeHeader(header), index);
  });

  const columnAliases: Record<keyof ParsedGlossaryCsvCore, string[]> = {
    term: ["term", "用語"],
    reading: ["reading", "読み", "よみ"],
    pronunciationVariants: ["pronunciationvariants", "pronunciation", "発音バリエーション", "発音", "variants"],
    definition: ["definition", "定義"],
    detailedExplanation: ["detailedexplanation", "detail", "詳細解説", "解説"],
    fullForm: ["fullform", "正式名称", "正式名"],
    category: ["category", "カテゴリ", "分類"],
    aliases: ["aliases", "alias", "別名", "別表記"],
  };

  const getColumnIndex = (field: keyof ParsedGlossaryCsvCore) => {
    for (const alias of columnAliases[field]) {
      const index = headerIndex.get(normalizeHeader(alias));
      if (index !== undefined) {
        return index;
      }
    }
    return undefined;
  };

  const termIndex = getColumnIndex("term");
  if (termIndex === undefined) {
    return {
      rows: [] as ParsedGlossaryCsvRow[],
      error: "CSVヘッダーに term（または 用語）列が必要です。",
    };
  }

  const readingIndex = getColumnIndex("reading");
  const pronunciationVariantsIndex = getColumnIndex("pronunciationVariants");
  const definitionIndex = getColumnIndex("definition");
  const detailedExplanationIndex = getColumnIndex("detailedExplanation");
  const fullFormIndex = getColumnIndex("fullForm");
  const categoryIndex = getColumnIndex("category");
  const aliasesIndex = getColumnIndex("aliases");

  const rows: ParsedGlossaryCsvRow[] = [];

  for (let rowIndex = 1; rowIndex < matrix.length; rowIndex += 1) {
    const row = matrix[rowIndex];
    if (row.every((value) => value.trim().length === 0)) {
      continue;
    }

    const term = getCell(row, termIndex).trim();
    if (!term) {
      return {
        rows: [] as ParsedGlossaryCsvRow[],
        error: `${rowIndex + 1}行目: term（用語）が空です。`,
      };
    }

    rows.push({
      rowNumber: rowIndex + 1,
      term,
      reading: toNullableText(getCell(row, readingIndex)),
      pronunciationVariants: parseListInput(getCell(row, pronunciationVariantsIndex)),
      definition: toNullableText(getCell(row, definitionIndex)),
      detailedExplanation: toNullableText(getCell(row, detailedExplanationIndex)),
      fullForm: toNullableText(getCell(row, fullFormIndex)),
      category: toNullableText(getCell(row, categoryIndex)),
      aliases: parseListInput(getCell(row, aliasesIndex)),
    });
  }

  if (rows.length === 0) {
    return {
      rows: [] as ParsedGlossaryCsvRow[],
      error: "CSVに有効なデータ行がありません。",
    };
  }

  return {
    rows,
    error: "",
  };
}
