/*
 Seed medicines with random values for required fields.
 Usage: npm run seed:medicines
*/

require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../config/database');
const Medicine = require('../models/Medicine');
const User = require('../models/User');

const INPUT = [
  // Pain/fever
  { name: 'Paracetamol', strength: '500mg', range: [1, 3], category: 'painkillers' },
  { name: 'Ibuprofen', strength: '400mg', range: [2, 5], category: 'painkillers' },

  // Antibiotics
  { name: 'Amoxicillin', strength: '500mg', range: [5, 10], category: 'antibiotics' },
  { name: 'Amoxicillin + Clavulanate', strength: '625mg', range: [12, 20], category: 'antibiotics' },
  { name: 'Azithromycin', strength: '500mg', range: [15, 25], category: 'antibiotics' },
  { name: 'Ciprofloxacin', strength: '500mg', range: [5, 8], category: 'antibiotics' },
  { name: 'Doxycycline', strength: '100mg', range: [3, 6], category: 'antibiotics' },
  { name: 'Metronidazole', strength: '400mg', range: [2, 5], category: 'antibiotics' },
  { name: 'Cefixime', strength: '200mg', range: [10, 20], category: 'antibiotics' },

  // Gastro/digestive
  { name: 'Omeprazole', strength: '20mg', range: [3, 5], category: 'digestive' },
  { name: 'Pantoprazole', strength: '40mg', range: [4, 7], category: 'digestive' },
  { name: 'Rabeprazole', strength: '20mg', range: [5, 8], category: 'digestive' },
  { name: 'Ranitidine', strength: '150mg', range: [2, 4], category: 'digestive' },
  { name: 'Domperidone', strength: '10mg', range: [2, 4], category: 'digestive' },
  { name: 'Ondansetron', strength: '4mg', range: [10, 15], category: 'digestive' },
  { name: 'ORS Sachet', strength: '1L', range: [15, 20], category: 'digestive' },

  // Respiratory/allergy
  { name: 'Levocetirizine', strength: '5mg', range: [2, 4], category: 'respiratory' },
  { name: 'Cetirizine', strength: '10mg', range: [2, 3], category: 'respiratory' },
  { name: 'Chlorpheniramine', strength: '4mg', range: [1, 2], category: 'respiratory' },
  { name: 'Montelukast', strength: '10mg', range: [8, 12], category: 'respiratory' },
  { name: 'Salbutamol Inhaler', strength: '200 doses', range: [120, 150], category: 'respiratory', dosageForm: 'inhaler' },
  { name: 'Budesonide Inhaler', strength: '200mcg', range: [180, 220], category: 'respiratory', dosageForm: 'inhaler' },

  // Cardio/HTN/heart
  { name: 'Amlodipine', strength: '5mg', range: [2, 4], category: 'blood_pressure' },
  { name: 'Losartan', strength: '50mg', range: [4, 6], category: 'blood_pressure' },
  { name: 'Telmisartan', strength: '40mg', range: [6, 10], category: 'blood_pressure' },
  { name: 'Atorvastatin', strength: '10mg', range: [5, 7], category: 'heart' },
  { name: 'Clopidogrel', strength: '75mg', range: [8, 12], category: 'heart' },

  // Diabetes
  { name: 'Metformin', strength: '500mg', range: [3, 5], category: 'diabetes' },
  { name: 'Glibenclamide', strength: '5mg', range: [2, 4], category: 'diabetes' },
  { name: 'Insulin', strength: '10ml vial', range: [120, 180], category: 'diabetes', dosageForm: 'injection' },

  // Vitamins/supplements
  { name: 'Vitamin C', strength: '500mg', range: [2, 4], category: 'vitamins' },
  { name: 'Zinc', strength: '50mg', range: [2, 3], category: 'supplements' },
  { name: 'Calcium + Vitamin D3', strength: '500mg/250IU', range: [4, 8], category: 'supplements' },
  { name: 'Vitamin B-Complex', strength: 'N/A', range: [3, 6], category: 'vitamins' },
  { name: 'Folic Acid', strength: '5mg', range: [1, 2], category: 'vitamins' },
  { name: 'Iron + Folic Acid tablet', strength: 'N/A', range: [1, 2], category: 'supplements' },
];

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randPrice([min, max]) {
  // Return 2-decimal price within range
  const p = Math.random() * (max - min) + min;
  return Math.round(p * 100) / 100;
}

async function getExistingPharmacy() {
  const preferredEmail = process.env.SEED_PHARMACY_EMAIL;
  let user = null;
  if (preferredEmail) {
    user = await User.findOne({ email: preferredEmail.toLowerCase(), role: 'pharmacy' });
    if (!user) {
      throw new Error(`No pharmacy user found with email ${preferredEmail}. Set SEED_PHARMACY_EMAIL to a valid pharmacy email.`);
    }
    return user;
  }
  user = await User.findOne({ role: 'pharmacy' });
  if (!user) {
    throw new Error('No existing pharmacy user found. Please create a pharmacy account or set SEED_PHARMACY_EMAIL in your environment.');
  }
  return user;
}

async function run() {
  try {
    await connectDB();
    const pharmacy = await getExistingPharmacy();

    const ops = INPUT.map(item => {
      const dosageForm = item.dosageForm || 'tablet';
      const brand = ['MediPharm', 'HealthPlus', 'CareWell', 'BioLife'][randInt(0, 3)];
      const manufacturer = ['Acme Labs', 'Zenith Pharma', 'NovaCare', 'PrimeMedic'][randInt(0, 3)];
      const price = randPrice(item.range);
      const stock = randInt(20, 200);

      const doc = {
        name: item.name,
        genericName: item.name,
        pharmacy: pharmacy._id,
        brand,
        category: item.category,
        price,
        stock,
        description: `${item.name} ${item.strength} - seeded entry for testing.`,
        composition: item.name,
        dosage: {
          form: dosageForm,
          strength: item.strength || 'N/A',
          instructions: 'Use as directed by physician.'
        },
        images: [],
        manufacturer,
        pharmacyInventory: [
          {
            pharmacy: pharmacy._id,
            price,
            stock,
            discount: randInt(0, 15),
            isAvailable: stock > 0,
            expiryDate: new Date(Date.now() + randInt(120, 720) * 24 * 60 * 60 * 1000),
            batchNumber: `BATCH-${randInt(10000, 99999)}`
          }
        ],
        safetyInfo: {
          sideEffects: [],
          contraindications: [],
          interactions: [],
          warnings: []
        },
        prescriptionRequired: /insulin|inhaler|ciprofloxacin|doxycycline|clopidogrel/i.test(item.name),
        tags: [item.name.toLowerCase(), item.category]
      };

      // Insert-only to avoid modifying existing docs
      return {
        updateOne: {
          filter: { name: item.name, pharmacy: pharmacy._id },
          update: { $setOnInsert: doc },
          upsert: true
        }
      };
    });

    const result = await Medicine.bulkWrite(ops);
    console.log('Seed complete:', JSON.stringify(result, null, 2));
  } catch (err) {
    console.error('Seed error:', err);
  } finally {
    await mongoose.connection.close();
  }
}

run();
