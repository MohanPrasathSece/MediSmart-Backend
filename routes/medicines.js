const express = require('express');
const { body, query, validationResult } = require('express-validator');
const Medicine = require('../models/Medicine');
const { auth, authorize, optionalAuth } = require('../middleware/auth');
const Order = require('../models/Order');
const router = express.Router();

// @route   GET /api/medicines/search
// @desc    Search medicines with price comparison
// @access  Public
router.get('/search', async (req, res) => {
  try {
    const { q, category, minPrice, maxPrice, page = 1, limit = 20 } = req.query;
    
    const filters = { isActive: true };
    if (category) filters.category = category;
    
    const medicines = await Medicine.searchMedicines(q, filters)
      .populate('pharmacyInventory.pharmacy', 'name address')
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const formattedMedicines = medicines.map(medicine => ({
      ...medicine.toObject(),
      priceComparison: medicine.getPriceComparison(),
      minPrice: medicine.minPrice,
      isAvailable: medicine.isAvailable
    }));

    res.json({ medicines: formattedMedicines });
  } catch (error) {
    res.status(500).json({ message: 'Search error' });
  }
});

// @desc    Get medicines previously ordered by the user
// @route   GET /api/medicines/my-medicines
// @access  Private
router.get('/my-medicines', auth, async (req, res) => {
  try {
    // Fetch recent orders for this patient and populate items.medicine and medicine.pharmacy
    const orders = await Order.find({ patient: req.user.id })
      .populate({
        path: 'items.medicine',
        populate: { path: 'pharmacy', select: 'name address' }
      })
      .sort({ createdAt: -1 })
      .limit(50);

    if (!orders || orders.length === 0) {
      return res.json([]);
    }

    // Collect unique medicines from order items
    const uniqueMedicines = new Map();
    orders.forEach(order => {
      (order.items || []).forEach(item => {
        const med = item.medicine;
        if (med && med._id) {
          const key = med._id.toString();
          if (!uniqueMedicines.has(key)) {
            const medObj = med.toObject ? med.toObject() : med;
            uniqueMedicines.set(key, medObj);
          }
        }
      });
    });

    res.json(Array.from(uniqueMedicines.values()));
  } catch (error) {
    console.error('Error fetching user medicines:', error);
    res.status(500).json({ message: 'Server Error' });
  }
});

// @route   GET /api/medicines/:id
// @desc    Get medicine details
// @access  Public
router.get('/:id', async (req, res) => {
  try {
    const medicine = await Medicine.findById(req.params.id)
      .populate('pharmacy', 'name address phone location');

    if (!medicine) {
      return res.status(404).json({ message: 'Medicine not found' });
    }

    res.json({
      ...medicine.toObject(),
      priceComparison: medicine.getPriceComparison()
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /api/medicines
// @desc    Add new medicine (Pharmacy only)
// @access  Private
router.post('/', auth, authorize('pharmacy'), async (req, res) => {
  try {
    const medicine = new Medicine(req.body);
    await medicine.save();
    res.status(201).json(medicine);
  } catch (error) {
    res.status(500).json({ message: 'Error creating medicine' });
  }
});

module.exports = router;
