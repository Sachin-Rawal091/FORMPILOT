// THE CRITICAL TEST:
// What does formatDate produce when the recorded value was used during recording?

function formatDate(date, formatSample) {
  const yyyy = String(date.getUTCFullYear());
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const m = String(date.getUTCMonth() + 1);
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const d = String(date.getUTCDate());

  if (!formatSample || typeof formatSample !== 'string') return `${yyyy}-${mm}-${dd}`;

  const sampleClean = formatSample.replace(/[{}]/g, '').trim();
  if (/[a-zA-Z]/.test(sampleClean)) return `${yyyy}-${mm}-${dd}`;

  let separator = '';
  if (formatSample.includes('/')) separator = '/';
  else if (formatSample.includes('-')) separator = '-';
  else if (formatSample.includes('.')) separator = '.';
  if (!separator) return `${yyyy}-${mm}-${dd}`;

  const parts = sampleClean.split(separator);
  if (parts.length !== 3) return `${yyyy}-${mm}-${dd}`;

  // Year is first: YYYY/MM/DD
  if (parts[0].length === 4) {
    const padMonth = parts[1].length === 2;
    const padDay = parts[2].length === 2;
    return `${yyyy}${separator}${padMonth ? mm : m}${separator}${padDay ? dd : d}`;
  }

  // Year is last: DD/MM/YYYY or MM/DD/YYYY
  if (parts[2].length === 4) {
    const pad1 = parts[0].length === 2;
    const pad2 = parts[1].length === 2;
    const val1 = Number(parts[0]);
    const val2 = Number(parts[1]);

    console.log(`  formatDate internals: val1=${val1}, val2=${val2}, pad1=${pad1}, pad2=${pad2}`);

    if (!isNaN(val1) && val1 > 12) {
      console.log(`  -> DD/MM/YYYY (val1 > 12)`);
      return `${pad1 ? dd : d}${separator}${pad2 ? mm : m}${separator}${yyyy}`;
    } else if (!isNaN(val2) && val2 > 12) {
      console.log(`  -> MM/DD/YYYY (val2 > 12)`);
      return `${pad1 ? mm : m}${separator}${pad2 ? dd : d}${separator}${yyyy}`;
    }
    console.log(`  -> Default DD/MM/YYYY (ambiguous)`);
    return `${pad1 ? dd : d}${separator}${pad2 ? mm : m}${separator}${yyyy}`;
  }

  return `${yyyy}-${mm}-${dd}`;
}

// Target date: December 13, 2025
const dec13 = new Date(Date.UTC(2025, 11, 13)); // Month 11 = December
console.log(`Target date: ${dec13.toISOString()}`);
console.log(`UTC: year=${dec13.getUTCFullYear()}, month=${dec13.getUTCMonth()+1}, day=${dec13.getUTCDate()}`);

// Scenario: The form was originally filled/recorded with the date "13/05/2025" 
// (May 13, 2025 in DD/MM/YYYY format, which is how Indian RMDP date pickers work)
// This value becomes step.defaultValue
console.log('\n=== Test 1: formatSample = "13/05/2025" (recorded value) ===');
console.log('Result:', formatDate(dec13, "13/05/2025"));

console.log('\n=== Test 2: formatSample = "05/13/2025" (MM/DD/YYYY) ===');
console.log('Result:', formatDate(dec13, "05/13/2025"));

console.log('\n=== Test 3: formatSample = "12/13/2025" (MM/DD/YYYY - user\'s excel format) ===');
console.log('Result:', formatDate(dec13, "12/13/2025"));

// But what if the datepicker on the site shows dates as DD/MM/YYYY
// and the user recorded with a DD/MM/YYYY date like "13/05/2025"?
// WAIT - what about the DATEPICKER handler path?
// Maybe the issue is in DatePickerEngine.parseDate, not formatDate

// The value that reaches DatePickerEngine.fill() is the output of formatDate
// If formatDate returns "2025-12-13" (ISO), then parseDate gets that

console.log('\n=== DatePickerEngine.parseDate tests ===');

function dpParseDate(value) {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) {
    const isoDate = new Date(value);
    return isNaN(isoDate.getTime()) ? null : isoDate;
  }
  const parts = value.split(/[\/\-.]/).filter(Boolean);
  if (parts.length !== 3) return null;
  const [p1, p2, p3] = parts.map(Number);
  if ([p1, p2, p3].some(n => isNaN(n))) return null;
  if (parts[0].length === 4) return new Date(p1, p2 - 1, p3);
  if (parts[2].length === 4) {
    if (p1 > 12) return new Date(p3, p2 - 1, p1);
    if (p2 > 12) return new Date(p3, p1 - 1, p2);
    return new Date(p3, p2 - 1, p1); // default day-first
  }
  return null;
}

// If formatDate returned "13/12/2025" 
const result1 = dpParseDate("13/12/2025");
console.log('dpParseDate("13/12/2025"):', result1 ? `${result1.getFullYear()}-${result1.getMonth()+1}-${result1.getDate()}` : null);

// If formatDate returned "2025-12-13" (ISO)
const result2 = dpParseDate("2025-12-13");
console.log('dpParseDate("2025-12-13"):', result2 ? `${result2.getFullYear()}-${result2.getMonth()+1}-${result2.getDate()}` : null);

// Let's check: what if new Date("2025-12-13") gives wrong month/day in IST timezone?
const isoDate = new Date("2025-12-13");
console.log('\nnew Date("2025-12-13"):');
console.log('  ISO:', isoDate.toISOString());
console.log('  Local:', `${isoDate.getFullYear()}-${isoDate.getMonth()+1}-${isoDate.getDate()}`);
console.log('  UTC:', `${isoDate.getUTCFullYear()}-${isoDate.getUTCMonth()+1}-${isoDate.getUTCDate()}`);

// Key question: does DatePickerEngine.parseDate use local or UTC?
// Line 148: return new Date(value) for ISO - this is UTC midnight
// Line 162: new Date(p1, p2-1, p3) for YYYY/MM/DD - this is LOCAL midnight
// 
// And how does RmdpAdapter read the month/day?

// Let's check: when ISO format is parsed by dpParseDate, 
// new Date("2025-12-13") -> creates UTC midnight date
// Then RmdpAdapter likely reads .getMonth()/.getDate() (LOCAL getters)
// In IST (UTC+5:30), UTC midnight = same day in IST, so it should be OK
// BUT: new Date("2025-12-13") without time -> in some JS engines this is UTC
// which means getMonth()/getDate() in IST would be correct since IST is ahead

console.log('\n=== CRITICAL: Test what the website\'s datepicker actually shows ===');
console.log('The user sees "13/05/2025" in the automation log.');
console.log('This means the value "13/05/2025" was actually passed to the DATEPICKER action.');
console.log('This IS the resolvedValue from resolveAndValidateValue.');
console.log('');
console.log('For this to happen, formatDate must have produced "13/05/2025".');
console.log('That means: dd=13, mm=05, yyyy=2025');
console.log('Month = 5 (May) -> the parsedDate must have month=5');
console.log('Day = 13 -> correct');
console.log('Year = 2025 -> correct');
console.log('');
console.log('How can parsedDate have month=5 (May) when Excel has Dec 13 (month=12)?');
console.log('');
console.log('THEORY: the Excel value is NOT being parsed as serial number.');
console.log('Instead it might be coming in as a formatted string like "12/13/2025"');
console.log('and being parsed incorrectly.');

console.log('\n=== What if Excel returns string "12/13/2025"? ===');
// If Excel format with mm/dd/yyyy and raw:false, SheetJS returns "12/13/2025" or "12/13/25"
// But with raw:true it returns 46004 (number)
// What if the user's Excel has the date as TEXT, not a date cell?

// When text: rawValue = "12/13/2025" (string)
// normalizeCellValue("12/13/2025") returns "12/13/2025" (string)
// In resolveAndValidateValue:
//   stringValue = "12/13/2025"
//   numValue = NaN -> serial path skipped
//   parseDateString("12/13/2025", "13/05/2025") called

function isDDMMFormat(formatStr) {
  const clean = formatStr.toLowerCase().trim();
  const separator = clean.includes('/') ? '/' : clean.includes('-') ? '-' : clean.includes('.') ? '.' : '';
  if (!separator) return true;
  const parts = clean.split(separator);
  if (parts.length !== 3) return true;
  if (parts[0].includes('d') || Number(parts[0]) > 12) return true;
  if (parts[1].includes('d') || Number(parts[1]) > 12) return false;
  if (parts[0].includes('m')) return false;
  if (parts[1].includes('m')) return true;
  return true;
}

function parseDateString(str, formatPreference) {
  if (!str) return null;
  const nativeParsed = new Date(str);
  if (!isNaN(nativeParsed.getTime())) {
    if (str.includes('T') || /^\d{4}-\d{2}-\d{2}/.test(str)) {
      return nativeParsed;
    }
  }
  const cleanStr = str.replace(/[^0-9\-/\.]/g, '').trim();
  let separator = '';
  if (cleanStr.includes('/')) separator = '/';
  else if (cleanStr.includes('-')) separator = '-';
  else if (cleanStr.includes('.')) separator = '.';
  if (!separator) { const p = new Date(cleanStr); return isNaN(p.getTime()) ? null : p; }
  const parts = cleanStr.split(separator);
  if (parts.length !== 3) { const p = new Date(cleanStr); return isNaN(p.getTime()) ? null : p; }
  const val1 = Number(parts[0]);
  const val2 = Number(parts[1]);
  const val3 = Number(parts[2]);
  if (isNaN(val1) || isNaN(val2) || isNaN(val3)) { const p = new Date(cleanStr); return isNaN(p.getTime()) ? null : p; }
  if (parts[0].length === 4) return new Date(Date.UTC(val1, val2 - 1, val3));
  if (parts[2].length === 4) {
    if (val1 > 12) {
      console.log(`    parseDateString: val1=${val1} > 12 -> DD/MM/YYYY: ${val3}-${val2}-${val1}`);
      return new Date(Date.UTC(val3, val2 - 1, val1));
    }
    if (val2 > 12) {
      console.log(`    parseDateString: val2=${val2} > 12 -> MM/DD/YYYY: ${val3}-${val1}-${val2}`);
      return new Date(Date.UTC(val3, val1 - 1, val2));
    }
    const isDDMM = formatPreference ? isDDMMFormat(formatPreference) : true;
    console.log(`    parseDateString: ambiguous, isDDMM=${isDDMM}, formatPreference="${formatPreference}"`);
    if (isDDMM) return new Date(Date.UTC(val3, val2 - 1, val1));
    else return new Date(Date.UTC(val3, val1 - 1, val2));
  }
  const p = new Date(cleanStr);
  return isNaN(p.getTime()) ? null : p;
}

console.log('\nParsing "12/13/2025" with formatPreference="13/05/2025":');
const parsed = parseDateString("12/13/2025", "13/05/2025");
if (parsed) {
  console.log(`Result: ${parsed.toISOString()}`);
  console.log(`UTC: month=${parsed.getUTCMonth()+1}, day=${parsed.getUTCDate()}, year=${parsed.getUTCFullYear()}`);
  
  // Now formatDate
  const formatted = formatDate(parsed, "13/05/2025");
  console.log(`formatDate result: "${formatted}"`);
}

// KEY: What if the value that reaches resolveAndValidateValue is NOT from Excel
// but from the step.value itself? What if there's NO column mapping and the 
// system is just using the step.value directly?

console.log('\n=== What if no column mapping? ===');
console.log('If step.columnName is undefined, resolveAndValidateValue returns step.value directly');
console.log('step.value = "{{DMR-OPEN-DATE}}" after mapping, or "13/05/2025" if no mapping');
console.log('If no mapping, then value = "13/05/2025" is passed directly to DATEPICKER');
console.log('This would explain the exact output!');
