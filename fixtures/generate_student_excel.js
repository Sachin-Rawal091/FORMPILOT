import XLSX from 'xlsx';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const firstNames = ["James", "Mary", "John", "Patricia", "Robert", "Jennifer", "Michael", "Linda", "William", "Elizabeth", "David", "Barbara", "Richard", "Susan", "Joseph", "Jessica", "Thomas", "Sarah", "Charles", "Karen", "Christopher", "Nancy", "Daniel", "Lisa", "Matthew", "Betty", "Anthony", "Margaret", "Mark", "Sandra", "Donald", "Ashley", "Steven", "Kimberly", "Paul", "Emily", "Andrew", "Donna", "Joshua", "Michelle", "Kenneth", "Carol", "Kevin", "Amanda", "Brian", "Dorothy", "George", "Melissa", "Timothy", "Deborah"];
const lastNames = ["Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis", "Rodriguez", "Martinez", "Hernandez", "Lopez", "Gonzalez", "Wilson", "Anderson", "Thomas", "Taylor", "Moore", "Jackson", "Martin", "Lee", "Perez", "Thompson", "White", "Harris", "Sanchez", "Clark", "Ramirez", "Lewis", "Robinson", "Walker", "Young", "Allen", "King", "Wright", "Scott", "Torres", "Nguyen", "Hill", "Flores", "Green", "Adams", "Nelson", "Baker", "Hall", "Rivera", "Campbell", "Mitchell", "Carter", "Roberts"];
const states = ["North Region", "South Region", "East Region", "West Region"];
const relationships = ["Parent", "Guardian", "Sibling", "Other"];
const grades = ["Grade 8", "Grade 9", "Grade 10", "Grade 11"];
const streams = ["Science", "Commerce", "Arts"];
const interests = ["Sports", "Music", "Arts"];

const data = [];
for (let i = 0; i < 50; i++) {
  const firstName = firstNames[i % firstNames.length];
  const lastName = lastNames[i % lastNames.length];
  const name = `${firstName} ${lastName}`;
  
  const gFirstName = firstNames[(i + 15) % firstNames.length];
  const gLastName = lastNames[i % lastNames.length];
  const guardianName = `${gFirstName} ${gLastName}`;
  
  const birthYear = 2008 + (i % 4);
  const birthMonth = String(1 + (i % 12)).padStart(2, '0');
  const birthDay = String(1 + (i % 28)).padStart(2, '0');
  const birthDate = `${birthYear}-${birthMonth}-${birthDay}`;
  
  const gender = (i % 3 === 0) ? "Male" : (i % 3 === 1 ? "Female" : "Other");
  const email = `${firstName.toLowerCase()}.${lastName.toLowerCase()}${10 + i}@example.com`;
  
  const phone = `+1 (555) ${100 + i}-${2000 + i}`;
  const address = `${100 + i * 7} Academy Lane, Suite ${i + 1}`;
  const city = `Metro City ${1 + (i % 5)}`;
  const state = states[i % states.length];
  const zip = String(10000 + i * 17).padStart(5, '0');
  
  const prevSchool = `Academy of Excellence ${1 + (i % 3)}`;
  const grade = grades[i % grades.length];
  const gpa = (3.0 + (i % 11) * 0.1).toFixed(2);
  
  const stream = streams[i % streams.length];
  const interest = interests[i % interests.length];
  
  data.push({
    "Full Name": name,
    "Date of Birth": birthDate,
    "Gender": gender,
    "Email Address": email,
    "Guardian Full Name": guardianName,
    "Relationship to Student": relationships[i % relationships.length],
    "Guardian Contact Phone": phone,
    "Street Address": address,
    "City": city,
    "State / Region": state,
    "Postal / ZIP Code": zip,
    "Previous School Attended": prevSchool,
    "Last Grade Completed": grade,
    "GPA / Percentage (%)": `${gpa}`,
    "Desired Academic Stream": stream,
    "Extracurricular Interests": interest,
    "Special Accommodations": i % 5 === 0 ? "Requires extra time on exams." : "",
    "Policy Consent": "true",
    "Signature": name
  });
}

const worksheet = XLSX.utils.json_to_sheet(data);
const workbook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(workbook, worksheet, "Student_Enrollments");
XLSX.writeFile(workbook, path.join(__dirname, "../fixtures/student_sample_data.xlsx"));
console.log("Excel file successfully created at fixtures/student_sample_data.xlsx!");
