const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const extractedMedicineSchema = new Schema({
  name: String,
  status: { type: String, default: 'pending' }
}, { _id: false });

const prescriptionSchema = new Schema({
  user: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  imagePath: {
    type: String,
    required: true
  },
  extractedMedicines: [extractedMedicineSchema],
  status: {
    type: String,
    enum: ['pending', 'processing', 'completed', 'failed'],
    default: 'pending'
  }
}, {
  timestamps: true
});

// Indexes for better query performance
prescriptionSchema.index({ user: 1 });
prescriptionSchema.index({ status: 1 });

module.exports = mongoose.model('Prescription', prescriptionSchema);
