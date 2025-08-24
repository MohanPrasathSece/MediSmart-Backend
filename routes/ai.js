const express = require('express');
const stringSimilarity = require('string-similarity');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { auth } = require('../middleware/auth');
const axios = require('axios');
const Tesseract = require('tesseract.js');
const Jimp = require('jimp');


const { 
    checkDrugSafety,
    translateText,
    processHealthQuery
} = require('../utils/aiServices');

// Hugging Face API key from environment variables
const HUGGING_FACE_API_KEY = process.env.HUGGING_FACE_API_KEY;

// Validate HF API key is loaded
if (!HUGGING_FACE_API_KEY) {
    console.error('❌ HUGGING_FACE_API_KEY not found in environment variables');
    console.log('Please add HUGGING_FACE_API_KEY=your_key to your .env file');
} else {
    console.log('✅ HuggingFace API key loaded successfully');
}

const Medicine = require('../models/Medicine');

// --- Multer Configuration ---

// Ensure uploads directory exists for disk storage
const uploadDir = 'uploads/';
if (!fs.existsSync(uploadDir)){
    fs.mkdirSync(uploadDir);
}

// We will use two different storage configs because some routes work better with files, and others with buffers.

// Use memory storage to get a buffer, which is easier to forward
const memoryStorage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
        cb(null, true);
    } else {
        cb(new Error('Only image files are allowed!'), false);
    }
};

// Multer instances
const uploadToMemory = multer({ storage: memoryStorage, fileFilter: fileFilter, limits: { fileSize: 10 * 1024 * 1024 } }); // 10MB limit


// --- AI Routes ---

/**
 * @route   POST /api/ai/upload-prescription
 * @desc    Upload and process a prescription image with detailed logging
 * @access  Private
 */
router.post('/upload-prescription', auth, uploadToMemory.single('prescription'), async (req, res) => {
  console.log('--- New Prescription Upload Request ---');
  try {
    if (!req.file) {
      console.error('ERROR: No file was uploaded in the request.');
      return res.status(400).json({ message: 'No prescription image file uploaded.' });
    }

    console.log('STEP 1: Received prescription image upload request.');

        // Step 2a: Pre-process image with Jimp to boost OCR accuracy (can be disabled via env)
    const enableJimp = process.env.AI_PREPROCESS === 'true';
    let processedImageBuffer = req.file.buffer;
    if (!enableJimp) {
      console.log('STEP 2a: Skipping Jimp preprocessing (AI_PREPROCESS is not "true").');
    } else {
      console.log('STEP 2a: Pre-processing image for better OCR accuracy...');
      try {
      // Jimp v1.x exports a { Jimp } key but some installs expose functions on root – handle both.
      const J = Jimp.Jimp || Jimp;
      const img = await J.read(req.file.buffer);

      // Apply operations step-by-step with compatibility fallbacks
      try { if (typeof img.greyscale === 'function') img.greyscale(); } catch (e) { console.warn('Jimp greyscale skipped:', e.message); }

      // Contrast API differs across versions; try number, then object signature
      try {
        if (typeof img.contrast === 'function') {
          try { img.contrast(0.6); }
          catch { img.contrast({ contrast: 0.6 }); }
        }
      } catch (e) { console.warn('Jimp contrast skipped:', e.message); }

      // Normalize may be absent in some builds
      try { if (typeof img.normalize === 'function') img.normalize(); } catch (e) { console.warn('Jimp normalize skipped:', e.message); }

      // Upscale for more DPI but cap to avoid OOM on small dynos
      try {
        const scale = 1.5; // lighter than 2x
        const maxDim = 1600;
        const w = Math.min(maxDim, Math.max(1, Math.round(img.bitmap.width * scale)));
        const h = Math.min(maxDim, Math.max(1, Math.round(img.bitmap.height * scale)));
        img.resize(w, h);
      } catch (e) { console.warn('Jimp resize skipped:', e.message); }

      // Threshold API can vary; try object form then numeric
      try {
        if (typeof img.threshold === 'function') {
          try { img.threshold({ max: 190 }); }
          catch { img.threshold(190); }
        }
      } catch (e) { console.warn('Jimp threshold skipped:', e.message); }

      // Always use a safe literal MIME; some environments don't expose J.MIME_PNG
      const outMime = 'image/png';
      try {
        if (typeof img.getBufferAsync === 'function') {
          processedImageBuffer = await img.getBufferAsync(outMime);
        } else {
          // fallback for older builds
          processedImageBuffer = await new Promise((res, rej) => {
            img.getBuffer(outMime, (err, buff) => (err ? rej(err) : res(buff)));
          });
        }
      } catch (bufErr) {
        console.warn('Jimp getBuffer failed, using original upload buffer:', bufErr.message);
        processedImageBuffer = req.file.buffer;
      }
    } catch (prepErr) {
      console.warn('🟡 Jimp preprocessing failed, falling back to raw buffer:', prepErr.message);
    }
    }

    // Step 2b: OCR with local Tesseract.js
    console.log('STEP 2b: Extracting text with Tesseract.js...');

    // Build Tesseract options conditionally: Node workers cannot use remote URLs
    const isNode = !!(typeof process !== 'undefined' && process.versions && process.versions.node);
    const tesseractOptions = { logger: m => console.log(m) };
    if (!isNode) {
      // In browser-like environments, allow CDN URLs
      tesseractOptions.workerPath = 'https://cdn.jsdelivr.net/npm/tesseract.js@v5/dist/worker.min.js';
      tesseractOptions.corePath = 'https://cdn.jsdelivr.net/npm/tesseract.js-core@v5/tesseract-core.wasm.js';
      tesseractOptions.langPath = 'https://tessdata.projectnaptha.com/4.0.0';
    }

    // Add a timeout wrapper to avoid long hangs on OCR
    const ocrWithTimeout = (buf, lang, opts, ms = 60000) => Promise.race([
      Tesseract.recognize(buf, lang, opts),
      new Promise((_, rej) => setTimeout(() => rej(new Error('OCR timeout')), ms))
    ]);

    const { data: { text } } = await ocrWithTimeout(
      processedImageBuffer,
      'eng',
      tesseractOptions,
      60000
    );
    console.log('--- Tesseract.js OCR Success ---');

    // Step 2c: Spelling correction using Hugging Face model
    console.log('STEP 2c: Correcting spelling with Hugging Face spell-checker...');
    let correctedText = text;

    // ---- Robust Spell Correction ----
    const spellModels = [
      'ai-forever/T5-large-spell'
    ];
    let spellCorrected = false;
    for (const model of spellModels) {
      try {
        console.log(`Attempting spell correction with model: ${model}`);
        const resp = await axios.post(
          `https://api-inference.huggingface.co/models/${model}`,
          { inputs: text },
          { headers: { Authorization: `Bearer ${HUGGING_FACE_API_KEY}` }, timeout: 20000 }
        );
        const genText = Array.isArray(resp.data) ? resp.data[0]?.generated_text : resp.data?.generated_text;
        if (genText) {
          correctedText = genText;
          console.log(`✅ Spell correction succeeded with ${model}`);
          spellCorrected = true;
          break;
        }
      } catch(err) {
        console.warn(`🟡 Model ${model} failed:`, err.response?.status || err.message);
        // Continue to next model
      }
    }

    if (!text || text.trim().length === 0) {
      return res.status(400).json({ message: 'Could not extract any text from the image.' });
    }

    // Step 3: Medicine-aware spelling refinement using database names
    let medicineNamesList = [];
    try {
      medicineNamesList = (await Medicine.find({}, 'name')).map(m => m.name);
    } catch(dbErr) { console.warn('Could not load medicine names for extra correction:', dbErr.message); }

    if (medicineNamesList.length) {
      const words = correctedText.split(/\s+/);
      const refinedWords = words.map(rawWord => {
        const clean = rawWord.replace(/[^a-z0-9]/gi, '');
        if (!clean) return rawWord; // keep punctuation
        const best = stringSimilarity.findBestMatch(clean.toLowerCase(), medicineNamesList.map(n=>n.toLowerCase())).bestMatch;
        return best.rating > 0.6 ? medicineNamesList[ medicineNamesList.map(n=>n.toLowerCase()).indexOf(best.target) ] : rawWord;
      });

      correctedText = refinedWords.join(' ');
      console.log('Applied medicine-name refinement.');
    }

    // Step 4: Try to identify medicines directly by matching DB names in corrected OCR text
    console.log('STEP 3: Detecting medicines via direct DB name match...');
    const allMedicines = await Medicine.find({}, 'name');
    const directMatches = allMedicines.filter(m => {
      const pattern = new RegExp(`\\b${m.name}\\b`, 'i');
      return pattern.test(correctedText);
    });

    let medicines = directMatches.map(m => ({ _id: m._id, word: m.name, score: 1.0, entity_group: 'Drug', source: 'direct_match' }));

    // If no direct matches, attempt fuzzy matching on OCR text
    if (medicines.length === 0) {
      console.log('No direct DB matches found. Trying fuzzy similarity match...');
      const ocrTextLower = correctedText.toLowerCase();
      const fuzzyMatches = allMedicines.filter(m => stringSimilarity.compareTwoStrings(m.name.toLowerCase(), ocrTextLower) > 0.5);
      medicines = fuzzyMatches.map(m => ({ word: m.name, score: 0.5, entity_group: 'Drug', source: 'fuzzy_match' }));
    }

    // If still none, fallback to Hugging Face NER model
    if (medicines.length === 0) {
      console.log('No fuzzy matches found. Falling back to Hugging Face NER...');
      const nerResponse = await axios.post(
        'https://api-inference.huggingface.co/models/d4data/biomedical-ner-all',
        { inputs: correctedText },
        {
          headers: {
            Authorization: `Bearer ${HUGGING_FACE_API_KEY}`,
            'Content-Type': 'application/json'
          },
          timeout: 20000
        }
      );

    // Filter for entities identified as 'Drug', ensuring the response is an array
    const hfEntities = Array.isArray(nerResponse.data) 
      ? nerResponse.data.filter(e => (e.entity_group || '').toUpperCase().includes('DRUG')) 
      : [];
    medicines = hfEntities.map(e => ({ ...e, source: 'huggingface' }));
    console.log('--- Hugging Face NER Success ---');
      console.log('--- Hugging Face NER Success ---');
    }

    // Step 3: Find pharmacies that stock these medicines
    console.log('STEP 3: Searching for pharmacies with extracted medicines...');
    const medicineNames = medicines.map(med => med.word.trim());

    if (medicineNames.length === 0) {
      return res.json({
        text,
        medicines,
        pharmacies: []
      });
    }

    const uniqueMedicineNames = [...new Set(medicineNames)];
    console.log(`STEP 3b: Finding best matches for [${uniqueMedicineNames.join(', ')}]`);

    const allDbMedicineNames = (await Medicine.find({}, 'name')).map(m => m.name);
    const matchedMedicines = [];

    uniqueMedicineNames.forEach(name => {
      const bestMatch = stringSimilarity.findBestMatch(name.trim(), allDbMedicineNames);
      // Only consider a match if the similarity is reasonably high (e.g., > 0.4)
      if (bestMatch.bestMatch.rating > 0.4) {
        console.log(`Found match for '${name}': '${bestMatch.bestMatch.target}' with rating ${bestMatch.bestMatch.rating}`);
        matchedMedicines.push(bestMatch.bestMatch.target);
      }
    });

    console.log(`STEP 3c: Querying DB for matched medicines: [${matchedMedicines.join(', ')}]`);
    // Step 4: Find pharmacies that stock these medicines
    console.log('STEP 4: Finding pharmacies for matched medicines...');
    const pharmacyResults = await Medicine.find(
      { name: { $in: matchedMedicines } },
      'name pharmacyInventory'
    ).populate('pharmacyInventory.pharmacy', 'name location');


    const pharmaciesFound = {};

    pharmacyResults.forEach(med => {
      med.pharmacyInventory.forEach(inv => {
        if (inv.pharmacy && inv.isAvailable && inv.stock > 0) {
          const pharmId = inv.pharmacy._id.toString();
          if (!pharmaciesFound[pharmId]) {
            pharmaciesFound[pharmId] = {
              ...inv.pharmacy.toObject(),
              medicinesInStock: [],
            };
          }
          pharmaciesFound[pharmId].medicinesInStock.push({
            _id: med._id,
            medicineId: med._id,
            id: med._id, // Include _id alias
            name: med.name,
            price: inv.price,
            stock: inv.stock,
          });
        }
      });
    });

    // Fallback: if no pharmacies were found via inventory, try using top-level pharmacy info on Medicine docs
    if (Object.keys(pharmaciesFound).length === 0 && matchedMedicines.length > 0) {
      console.log('STEP 4b: No inventory matches, falling back to top-level pharmacy fields on Medicine documents');
      const medsWithPharmacy = await Medicine.find({ name: { $in: matchedMedicines } })
        .populate('pharmacy', 'name location');
      medsWithPharmacy.forEach(med => {
        if (!med.pharmacy) return;
        const pid = med.pharmacy._id.toString();
        if (!pharmaciesFound[pid]) {
          pharmaciesFound[pid] = {
            ...med.pharmacy.toObject(),
            medicinesInStock: [],
          };
        }
        pharmaciesFound[pid].medicinesInStock.push({
          _id: med._id,
          medicineId: med._id,
          name: med.name,
          price: med.price,
          stock: med.stock,
        });
      });
    }

    console.log(`STEP 5: Aggregated ${Object.keys(pharmaciesFound).length} pharmacies (after fallback).`);

    res.json({
      text: correctedText,
      medicines: matchedMedicines.map(name => ({ word: name, source: 'matched' })),
      pharmacies: Object.values(pharmaciesFound),
    });

  } catch (error) {
    console.error('---!! PRESCRIPTION UPLOAD FAILED !!---');
    console.error('Timestamp:', new Date().toISOString());
    if (error.response) {
      // The request was made and the server responded with a status code
      // that falls out of the range of 2xx
      console.error('Hugging Face API Error Status:', error.response.status);
      console.error('Hugging Face API Error Data:', error.response.data);
    } else if (error.request) {
      // The request was made but no response was received
      console.error('No response received from Hugging Face API:', error.request);
    } else {
      // Something happened in setting up the request that triggered an Error
      console.error('Error setting up Hugging Face request:', error.message);
    }
    console.error('Full Error Stack:', error.stack);
    res.status(500).json({ message: 'Error processing prescription image.', error: error.message });
  }
});

/**
 * @route   POST /api/ai/drug-safety
 * @desc    Check drug safety and interactions
 * @access  Private
 */
router.post('/drug-safety', auth, async (req, res) => {
  try {
    const { medicines, patientAge, conditions = [] } = req.body;
    if (!medicines || !Array.isArray(medicines)) {
      return res.status(400).json({ message: 'Medicines array is required' });
    }
    const safetyReport = await checkDrugSafety(medicines, patientAge, conditions);
    res.json({ message: 'Drug safety check completed', safetyReport });
  } catch (error) {
    console.error('Drug safety check error:', error);
    res.status(500).json({ message: 'Error checking drug safety', error: error.message });
  }
});

/**
 * @route   POST /api/ai/translate
 * @desc    Translate text using LibreTranslate API
 * @access  Private
 */
router.post('/translate', auth, async (req, res) => {
  try {
    const { text, targetLanguage = 'en', sourceLanguage = 'auto' } = req.body;
    if (!text) {
      return res.status(400).json({ message: 'Text is required for translation' });
    }
    const translatedText = await translateText(text, targetLanguage, sourceLanguage);
    res.json({ message: 'Translation completed', originalText: text, translatedText, sourceLanguage, targetLanguage });
  } catch (error) {
    console.error('Translation error:', error);
    res.status(500).json({ message: 'Error translating text', error: error.message });
  }
});

/**
 * @route   POST /api/ai/health-query
 * @desc    Process health-related queries
 * @access  Private
 */
router.post('/health-query', auth, async (req, res) => {
  try {
    const { query, context = {} } = req.body;
    if (!query) {
      return res.status(400).json({ message: 'Health query is required' });
    }
    const response = await processHealthQuery(query, context);
    res.json({ message: 'Health query processed', query, response });
  } catch (error) {
    console.error('Health query processing error:', error);
    res.status(500).json({ message: 'Error processing health query', error: error.message });
  }
});


module.exports = router;
