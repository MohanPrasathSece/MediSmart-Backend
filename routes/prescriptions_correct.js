const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const { extractMedicineFromImage } = require('../utils/aiServices');
const Prescription = require('../models/Prescription');

// Multer setup for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/prescriptions/');
  },
  filename: (req, file, cb) => {
    const uniqueName = `${uuidv4()}-${file.originalname}`;
    cb(null, uniqueName);
  }
});

const upload = multer({ storage: storage });

// @route   POST api/prescriptions/upload
// @desc    Upload a prescription
// @access  Private
router.post('/upload', [auth, upload.single('prescription')], async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ msg: 'Please upload a file' });
    }

    const imagePath = req.file.path;
    const extractedMedicines = await extractMedicineFromImage(imagePath);

    const newPrescription = new Prescription({
      user: req.user.id,
      imagePath: imagePath,
      extractedMedicines: extractedMedicines.map(name => ({ name: name, status: 'pending' }))
    });

    await newPrescription.save();

    res.status(201).json(newPrescription);

  } catch (err) {
    console.error('Error uploading prescription:', err.message);
    res.status(500).send('Server Error');
  }
});

// @route   GET api/prescriptions
// @desc    Get all prescriptions for a user
// @access  Private
router.get('/', auth, async (req, res) => {
  try {
    const prescriptions = await Prescription.find({ user: req.user.id }).sort({ date: -1 });
    res.json(prescriptions);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

module.exports = router;
