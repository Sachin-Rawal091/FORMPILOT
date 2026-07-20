import XLSX from '@e965/xlsx';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const data = [
  {
    "Full Legal Name": "Aarav Sharma",
    "Date of Birth": "1994-08-15",
    "National ID Number": "KRP-9821-X9",
    "Gender": "Male",
    "Street Address": "128 Green Valley Road, Sector 4",
    "State / Province": "North KRP",
    "Postal Code / Zip": "560092",
    "Primary Contact Number": "+91 98765 43210",
    "Registration Entity Type": "MSME Small Enterprise",
    "Land Holding / Office Size (Acres)": 5.5,
    "Estimated Annual Revenue (KRP Credit)": "50,000 - 250,000",
    "Audit Consent": "true",
    "Signature Acknowledgment": "Aarav Sharma"
  },
  {
    "Full Legal Name": "Priya Patel",
    "Date of Birth": "1991-03-24",
    "National ID Number": "KRP-1049-P2",
    "Gender": "Female",
    "Street Address": "45 Blue Ridge Colony",
    "State / Province": "South KRP",
    "Postal Code / Zip": "600028",
    "Primary Contact Number": "+91 91234 56789",
    "Registration Entity Type": "Independent Professional",
    "Land Holding / Office Size (Acres)": 1.2,
    "Estimated Annual Revenue (KRP Credit)": "Above 250,000",
    "Audit Consent": "true",
    "Signature Acknowledgment": "Priya Patel"
  },
  {
    "Full Legal Name": "Rajesh Kumar",
    "Date of Birth": "1985-11-02",
    "National ID Number": "KRP-4820-K7",
    "Gender": "Male",
    "Street Address": "Farm 12, West Valley Outskirts",
    "State / Province": "West Valley",
    "Postal Code / Zip": "411005",
    "Primary Contact Number": "+91 94455 66778",
    "Registration Entity Type": "Agricultural Farmer",
    "Land Holding / Office Size (Acres)": 12.4,
    "Estimated Annual Revenue (KRP Credit)": "Under 50,000",
    "Audit Consent": "true",
    "Signature Acknowledgment": "Rajesh Kumar"
  },
  {
    "Full Legal Name": "Ananya Sen",
    "Date of Birth": "1996-05-19",
    "National ID Number": "KRP-7712-S3",
    "Gender": "Female",
    "Street Address": "Flat 4B, Heritage Apartments, Capital Road",
    "State / Province": "Capital District",
    "Postal Code / Zip": "700019",
    "Primary Contact Number": "+91 98300 12345",
    "Registration Entity Type": "MSME Small Enterprise",
    "Land Holding / Office Size (Acres)": 0.5,
    "Estimated Annual Revenue (KRP Credit)": "50,000 - 250,000",
    "Audit Consent": "true",
    "Signature Acknowledgment": "Ananya Sen"
  },
  {
    "Full Legal Name": "Vikram Singh",
    "Date of Birth": "1988-09-09",
    "National ID Number": "KRP-3091-V5",
    "Gender": "Male",
    "Street Address": "88 North Gate Boulevard",
    "State / Province": "North KRP",
    "Postal Code / Zip": "560098",
    "Primary Contact Number": "+91 98800 55443",
    "Registration Entity Type": "Independent Professional",
    "Land Holding / Office Size (Acres)": 2.8,
    "Estimated Annual Revenue (KRP Credit)": "Above 250,000",
    "Audit Consent": "true",
    "Signature Acknowledgment": "Vikram Singh"
  },
  {
    "Full Legal Name": "Meera Nair",
    "Date of Birth": "1993-12-12",
    "National ID Number": "KRP-2983-N4",
    "Gender": "Female",
    "Street Address": "15 coconut Grove Road",
    "State / Province": "South KRP",
    "Postal Code / Zip": "682011",
    "Primary Contact Number": "+91 99470 11223",
    "Registration Entity Type": "MSME Small Enterprise",
    "Land Holding / Office Size (Acres)": 4.2,
    "Estimated Annual Revenue (KRP Credit)": "50,000 - 250,000",
    "Audit Consent": "true",
    "Signature Acknowledgment": "Meera Nair"
  },
  {
    "Full Legal Name": "Amit Hegde",
    "Date of Birth": "1982-02-28",
    "National ID Number": "KRP-9304-H1",
    "Gender": "Male",
    "Street Address": "Greenacres Farmstead, Valley Area",
    "State / Province": "West Valley",
    "Postal Code / Zip": "411038",
    "Primary Contact Number": "+91 94220 88990",
    "Registration Entity Type": "Agricultural Farmer",
    "Land Holding / Office Size (Acres)": 25.0,
    "Estimated Annual Revenue (KRP Credit)": "Above 250,000",
    "Audit Consent": "true",
    "Signature Acknowledgment": "Amit Hegde"
  },
  {
    "Full Legal Name": "Siddharth Roy",
    "Date of Birth": "1990-07-07",
    "National ID Number": "KRP-6184-R9",
    "Gender": "Male",
    "Street Address": "304 Crescent Heights, District Core",
    "State / Province": "Capital District",
    "Postal Code / Zip": "700091",
    "Primary Contact Number": "+91 98311 99887",
    "Registration Entity Type": "Independent Professional",
    "Land Holding / Office Size (Acres)": 1.5,
    "Estimated Annual Revenue (KRP Credit)": "50,000 - 250,000",
    "Audit Consent": "true",
    "Signature Acknowledgment": "Siddharth Roy"
  },
  {
    "Full Legal Name": "Kavitha Rao",
    "Date of Birth": "1995-10-31",
    "National ID Number": "KRP-5290-R2",
    "Gender": "Female",
    "Street Address": "Sector 3, Main Market Area",
    "State / Province": "North KRP",
    "Postal Code / Zip": "560012",
    "Primary Contact Number": "+91 98450 98450",
    "Registration Entity Type": "MSME Small Enterprise",
    "Land Holding / Office Size (Acres)": 3.0,
    "Estimated Annual Revenue (KRP Credit)": "Under 50,000",
    "Audit Consent": "true",
    "Signature Acknowledgment": "Kavitha Rao"
  },
  {
    "Full Legal Name": "Suresh Pillai",
    "Date of Birth": "1978-04-05",
    "National ID Number": "KRP-8120-P8",
    "Gender": "Male",
    "Street Address": "104 Temple View Lane",
    "State / Province": "South KRP",
    "Postal Code / Zip": "600004",
    "Primary Contact Number": "+91 98401 23456",
    "Registration Entity Type": "Agricultural Farmer",
    "Land Holding / Office Size (Acres)": 8.5,
    "Estimated Annual Revenue (KRP Credit)": "50,000 - 250,000",
    "Audit Consent": "true",
    "Signature Acknowledgment": "Suresh Pillai"
  }
];

const worksheet = XLSX.utils.json_to_sheet(data);
const workbook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(workbook, worksheet, "KRP_Registrations");

const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

const fixturesPath = path.join(__dirname, "krp_sample_data.xlsx");
const rootPath = path.join(__dirname, "../krp_sample_data.xlsx");

fs.writeFileSync(fixturesPath, buffer);
fs.writeFileSync(rootPath, buffer);

console.log("✅ Excel file successfully created at:");
console.log("  - " + fixturesPath);
console.log("  - " + rootPath);
