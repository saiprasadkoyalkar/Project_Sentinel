import express from 'express';
import multer from 'multer';
import path from 'path';
import { parseExcelFile } from '../utils/excelParser';
import { seedCustomersFromExcel } from '../scripts/seed';

const router = express.Router();
const upload = multer({ dest: path.join(__dirname, '../../uploads/') });

router.post('/', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    // Parse Excel file
    const data = parseExcelFile(req.file.path);
  // Pass 'data' to your seeding logic (e.g., create DB records)
  await seedCustomersFromExcel(data);
  return res.status(200).json({ message: 'Excel file processed and customers seeded.', preview: data.slice(0, 5) });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to process Excel file.' });
  }
});

export default router;
