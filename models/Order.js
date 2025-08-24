const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const deliveryAddressSchema = new Schema({
  street: { type: String, required: true },
  city: { type: String, required: true },
  state: { type: String, required: true },
  postalCode: { type: String, required: true },
  country: { type: String, required: true }
}, { _id: false });

const statusHistorySchema = new Schema({
  status: { 
    type: String, 
    required: true, 
    enum: ['pending', 'confirmed', 'ready', 'ready_for_pickup', 'assigned', 'pending_acceptance', 'picked_up', 'out_for_delivery', 'delivered', 'cancelled', 'rejected']
  },
  timestamp: { type: Date, default: Date.now },
  updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  notes: { type: String }
}, { _id: false });

const orderItemSchema = new Schema({
  medicine: { type: Schema.Types.ObjectId, ref: 'Medicine', required: true },
  // Name comes from frontend but orders route doesn't require it; keep optional
  name: { type: String },
  quantity: { type: Number, required: true },
  price: { type: Number, required: true },
  discount: { type: Number, default: 0, min: 0, max: 100 },
  finalPrice: { type: Number, required: true }
}, { _id: false });

const orderSchema = new Schema({
  orderNumber: { type: String },
  patient: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  pharmacy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  deliveryBoy: { type: Schema.Types.ObjectId, ref: 'User' },
  items: [orderItemSchema],
  // Pricing object aligned with route computation
  pricing: {
    subtotal: { type: Number, required: true },
    tax: { type: Number, required: true },
    deliveryFee: { type: Number, required: true },
    total: { type: Number, required: true }
  },
  status: { 
    type: String, 
    required: true, 
    enum: ['pending', 'confirmed', 'ready', 'ready_for_pickup', 'assigned', 'pending_acceptance', 'picked_up', 'out_for_delivery', 'delivered', 'cancelled', 'rejected'],
    default: 'pending' 
  },
  // Route uses `prescription` (not `prescriptionUrl`)
  prescription: { type: String, required: true },
  deliveryAddress: { type: deliveryAddressSchema, required: true },
  statusHistory: [statusHistorySchema],
  // Chat created after order
  chat: { type: Schema.Types.ObjectId, ref: 'Chat' },
  // Payment
  paymentMethod: { type: String, enum: ['cash_on_delivery', 'upi', 'card'], default: 'cash_on_delivery' },
  paymentDetails: {
    paymentId: { type: String },
    status: { type: String, enum: ['pending', 'completed', 'failed'], default: 'pending' }
  },
  // Inventory
  stockDeducted: { type: Boolean, default: false }
}, { timestamps: true });

orderSchema.pre('save', function(next) {
  if (this.isNew) {
    this.statusHistory.push({ status: 'pending', updatedBy: this.patient });
  }
  next();
});

// To prevent OverwriteModelError, check if the model is already compiled
orderSchema.statics.getOrdersByStatus = function(status, userId, userRole) {
  const query = {};

  if (status) {
    query.status = status;
  }

  switch (userRole) {
    case 'patient':
      query.patient = userId;
      break;
    case 'pharmacy':
      query.pharmacy = userId;
      break;
    case 'delivery_boy':
      query.deliveryBoy = userId;
      break;
    default:
      // This case should ideally not be hit if routes are protected
      break;
  }

  return this.find(query)
    .populate('patient', 'name email')
    .populate('pharmacy', 'name address')
    .populate('deliveryBoy', 'name')
    .sort({ createdAt: -1 });
};

module.exports = mongoose.models.Order || mongoose.model('Order', orderSchema);
