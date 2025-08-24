const mongoose = require('mongoose');

const medicineSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Medicine name is required'],
    trim: true,
    index: true
  },
  genericName: {
    type: String,
    trim: true,
    index: true
  },
  pharmacy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  brand: {
    type: String,
    required: [true, 'Brand name is required'],
    default: 'N/A',
    trim: true
  },
  category: {
    type: String,
    required: [true, 'Category is required'],
    enum: [
      'antibiotics', 'painkillers', 'vitamins', 'supplements',
      'diabetes', 'blood_pressure', 'heart', 'respiratory',
      'digestive', 'skin_care', 'eye_care', 'mental_health',
      'women_health', 'men_health', 'pediatric', 'elderly_care', 'Pain Relief', 'Antibiotics'
    ]
  },
  price: {
    type: Number,
    required: true,
    min: 0,
    default: 0
  },
  stock: {
    type: Number,
    required: true,
    min: 0,
    default: 0
  },
  description: {
    type: String,
    required: [true, 'Description is required']
  },
  composition: {
    type: String,
    required: [true, 'Composition is required'],
    default: 'N/A'
  },
  dosage: {
    form: {
      type: String,
      required: true,
      default: 'N/A',
      enum: ['tablet', 'capsule', 'syrup', 'injection', 'cream', 'drops', 'inhaler', 'powder']
    },
    strength: {
      type: String,
      required: true,
      default: 'N/A'
    },
    instructions: {
      type: String,
      required: true,
      default: 'N/A'
    }
  },
  images: [{
    url: String,
    alt: String
  }],
  manufacturer: {
    type: String,
    required: [true, 'Manufacturer is required']
  },
  // Pharmacy inventory
  pharmacyInventory: [{
    pharmacy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    price: {
      type: Number,
      required: true,
      min: 0
    },
    stock: {
      type: Number,
      required: true,
      min: 0
    },
    discount: {
      type: Number,
      default: 0,
      min: 0,
      max: 100
    },
    isAvailable: {
      type: Boolean,
      default: true
    },
    expiryDate: {
      type: Date,
      required: true
    },
    batchNumber: String,
    lastUpdated: {
      type: Date,
      default: Date.now
    }
  }],
  // Drug safety information
  safetyInfo: {
    sideEffects: [String],
    contraindications: [String],
    interactions: [String],
    warnings: [String],
    pregnancyCategory: {
      type: String,
      enum: ['A', 'B', 'C', 'D', 'X', 'N']
    },
    ageRestrictions: {
      minAge: Number,
      maxAge: Number
    }
  },
  // Prescription requirements
  prescriptionRequired: {
    type: Boolean,
    default: false
  },
  // Search and filtering
  tags: [String],
  isActive: {
    type: Boolean,
    default: true
  },
  // Analytics
  searchCount: {
    type: Number,
    default: 0
  },
  orderCount: {
    type: Number,
    default: 0
  },
  rating: {
    average: {
      type: Number,
      default: 0,
      min: 0,
      max: 5
    },
    count: {
      type: Number,
      default: 0
    }
  }
}, {
  timestamps: true
});

// Indexes for search optimization
medicineSchema.index({ name: 'text', genericName: 'text', brand: 'text', tags: 'text' });
medicineSchema.index({ category: 1 });
medicineSchema.index({ 'pharmacyInventory.pharmacy': 1 });
medicineSchema.index({ 'pharmacyInventory.price': 1 });
medicineSchema.index({ prescriptionRequired: 1 });
medicineSchema.index({ isActive: 1 });

// Virtual for minimum price
medicineSchema.virtual('minPrice').get(function() {
  if (!this.pharmacyInventory || this.pharmacyInventory.length === 0) return null;
  
  const availableInventory = this.pharmacyInventory.filter(inv => 
    inv.isAvailable && inv.stock > 0
  );
  
  if (availableInventory.length === 0) return null;
  
  return Math.min(...availableInventory.map(inv => 
    inv.price * (1 - inv.discount / 100)
  ));
});

// Virtual for availability
medicineSchema.virtual('isAvailable').get(function() {
  return this.pharmacyInventory && this.pharmacyInventory.some(inv => 
    inv.isAvailable && inv.stock > 0
  );
});

// Method to get price comparison
medicineSchema.methods.getPriceComparison = function() {
  return this.pharmacyInventory
    .filter(inv => inv.isAvailable && inv.stock > 0)
    .map(inv => ({
      pharmacy: inv.pharmacy,
      originalPrice: inv.price,
      discount: inv.discount,
      finalPrice: inv.price * (1 - inv.discount / 100),
      stock: inv.stock,
      expiryDate: inv.expiryDate
    }))
    .sort((a, b) => a.finalPrice - b.finalPrice);
};

// Static method for search
medicineSchema.statics.searchMedicines = function(query, filters = {}) {
  const searchQuery = {
    isActive: true,
    ...filters
  };

  if (query) {
    searchQuery.$text = { $search: query };
  }

  return this.find(searchQuery)
    .populate('pharmacyInventory.pharmacy', 'name address pharmacyDetails')
    .sort(query ? { score: { $meta: 'textScore' } } : { name: 1 });
};

module.exports = mongoose.model('Medicine', medicineSchema);
