import XLSX from '@e965/xlsx';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const data = [];
for (let i = 0; i < 10; i++) {
  // Generate 10 distinct rows of dates
  const appDate = `2026/07/${String(1 + i).padStart(2, '0')}`;
  const dob = `1990/${String(1 + (i % 12)).padStart(2, '0')}/${String(10 + i).padStart(2, '0')}`;
  const loanDate = `2026/06/${String(12 + i).padStart(2, '0')}`;
  const claimDate = `2026/07/${String(2 + i).padStart(2, '0')}`;
  const insDate = `2026/05/${String(5 + i).padStart(2, '0')}`;
  
  // Range Date Picker: e.g. "2026/07/01 - 2026/07/10"
  const startDay = 1 + i;
  const endDay = 10 + i;
  const rangeDate = `2026/07/${String(startDay).padStart(2, '0')} - 2026/07/${String(endDay).padStart(2, '0')}`;
  
  // Multi Date Picker: e.g. "2026/07/01, 2026/07/03, 2026/07/05"
  const multiDate = `2026/07/${String(startDay).padStart(2, '0')}, 2026/07/${String(startDay + 2).padStart(2, '0')}, 2026/07/${String(startDay + 4).padStart(2, '0')}`;

  data.push({
    "Application Date": appDate,
    "DOB": dob,
    "Loan Date": loanDate,
    "Claim Date": claimDate,
    "Insurance Date": insDate,
    "Range Date Picker": rangeDate,
    "Multi Date Picker": multiDate
  });
}

const worksheet = XLSX.utils.json_to_sheet(data);
const workbook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(workbook, worksheet, "RMDP_Date_Samples");

const outputPath = path.join(__dirname, "../fixtures/rmdp_sample_data.xlsx");

// Core sheetjs writing to memory buffer
const excelBuffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

// Native Node fs file writing (ignores sandboxing issues of the library)
fs.writeFileSync(outputPath, excelBuffer);

console.log(`Excel file successfully created at: ${outputPath}`);
