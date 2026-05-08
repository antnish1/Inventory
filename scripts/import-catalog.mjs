import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";

const require = createRequire(import.meta.url);
const XLSX = require("xlsx");

const source = process.argv[2];
const outFile = path.join("public", "catalog.json");
const requiredColumns = [
  "Material",
  "Description",
  "DNP",
  "RTL",
  "MRP",
  "HSN",
  "GST",
  "Cat 1",
  "Cat 2",
];

if (!source) {
  console.error("Usage: node scripts/import-catalog.mjs <price-list.xlsx>");
  process.exit(1);
}

if (!fs.existsSync(source)) {
  console.error(`Workbook not found: ${source}`);
  process.exit(1);
}

const workbook = XLSX.readFile(source, { cellDates: false });
const firstSheetName = workbook.SheetNames[0];
const sheet = workbook.Sheets[firstSheetName];
const rows = XLSX.utils.sheet_to_json(sheet, { defval: "", raw: true });
const headers = Object.keys(rows[0] ?? {});
const missing = requiredColumns.filter((column) => !headers.includes(column));

if (missing.length) {
  console.error(`Missing required columns: ${missing.join(", ")}`);
  process.exit(1);
}

const normalizeText = (value) => String(value ?? "").trim();
const normalizePrice = (value) => {
  if (value === null || value === undefined || value === "") return "";
  const number = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(number) ? number : "";
};

const catalog = rows
  .map((row) => ({
    material: normalizeText(row.Material),
    description: normalizeText(row.Description),
    dnp: normalizePrice(row.DNP),
    rtl: normalizePrice(row.RTL),
    mrp: normalizePrice(row.MRP),
    hsn: normalizeText(row.HSN),
    gst: normalizeText(row.GST),
    cat1: normalizeText(row["Cat 1"]),
    cat2: normalizeText(row["Cat 2"]),
  }))
  .filter((part) => part.material || part.description);

fs.mkdirSync("public", { recursive: true });
fs.writeFileSync(
  outFile,
  JSON.stringify(
    {
      sourceFile: path.basename(source),
      importedAt: new Date().toISOString(),
      rowCount: catalog.length,
      requiredColumns,
      parts: catalog,
    },
    null,
    0,
  ),
);

console.log(`Imported ${catalog.length.toLocaleString("en-IN")} parts to ${outFile}`);
