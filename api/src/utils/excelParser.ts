// Utility to parse Excel files using xlsx
import * as XLSX from 'xlsx';
import { writeExcelDataToFile } from './writeExcelDataToFile';

export function parseExcelFile(filePath: string) {
  // Read the file
  const workbook = XLSX.readFile(filePath);
  // Get the first sheet name
  const sheetName = workbook.SheetNames[0];
  // Get the worksheet
  const worksheet = workbook.Sheets[sheetName];
  // Convert to JSON
  const data = XLSX.utils.sheet_to_json(worksheet);
  // Write the parsed data to a file for inspection
  return data;

}
