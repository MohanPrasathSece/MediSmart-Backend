const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const Medicine = require('../models/Medicine');
const Order = require('../models/Order');
const User = require('../models/User');

// Middleware to ensure user is a pharmacy
const isPharmacy = (req, res, next) => {
  const allowedRoles = ['pharmacy', 'pharmacist'];
  if (process.env.ALLOW_ADMIN_PHARMACY === 'true') allowedRoles.push('admin');
  if (!allowedRoles.includes(req.user.role)) {
    return res.status(403).json({ message: 'Access denied. Pharmacy role required.' });
  }
  next();
};

// Get pharmacy dashboard stats
router.get('/dashboard/stats', auth, isPharmacy, async (req, res) => {
  try {
    const pharmacy = req.user.id;
    
    // Get total orders for this pharmacy
    const totalOrders = await Order.countDocuments({ pharmacy: pharmacy });
    
    // Get pending orders
    const pendingOrders = await Order.countDocuments({ 
      pharmacy: pharmacy, 
      status: { $in: ['pending', 'confirmed'] } 
    });
    
    // Get completed orders this month
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    
    const monthlyOrders = await Order.countDocuments({
      pharmacy: pharmacy,
      status: 'delivered',
      createdAt: { $gte: startOfMonth }
    });
    
    // Calculate monthly revenue
    const monthlyRevenue = await Order.aggregate([
      {
        $match: {
          pharmacy: req.user.id,
          status: 'delivered',
          createdAt: { $gte: startOfMonth }
        }
      },
      {
        $group: {
          _id: null,
          total: { $sum: '$totalAmount' }
        }
      }
    ]);
    
    // Get low stock medicines count (assuming we have a stock field)
    const lowStockCount = await Medicine.countDocuments({
      pharmacy: pharmacy,
      stock: { $lt: 10 }
    });
    
    res.json({
      totalOrders,
      pendingOrders,
      monthlyOrders,
      monthlyRevenue: monthlyRevenue[0]?.total || 0,
      lowStockCount
    });
  } catch (error) {
    console.error('Dashboard stats error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get pharmacy medicines
router.get('/medicines', auth, isPharmacy, async (req, res) => {
  try {
    const { search, page = 1, limit = 10 } = req.query;
    const pharmacy = req.user.id;
    
    let query = { pharmacy };
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { manufacturer: { $regex: search, $options: 'i' } }
      ];
    }
    
    const medicines = await Medicine.find(query)
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .sort({ createdAt: -1 });
    
    const total = await Medicine.countDocuments(query);
    
    res.json({
      medicines,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      total
    });
  } catch (error) {
    console.error('Get medicines error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Add new medicine
router.post('/medicines', auth, isPharmacy, async (req, res) => {
  try {
        const medicineData = {
      ...req.body,
      pharmacy: req.user.id,
      // provide sane defaults so only minimal 5 fields are needed from client
      price: Number(req.body.price) || 0,
      stock: Number(req.body.stock) || 0,
      brand: req.body.brand || 'Generic',
      genericName: req.body.genericName || req.body.name,
      category: req.body.category || 'supplements',
      description: req.body.description || 'N/A',
      composition: req.body.composition || 'N/A',
      dosage: req.body.dosage || { form: 'tablet', strength: 'N/A', instructions: 'N/A' },
      manufacturer: req.body.manufacturer || 'N/A'
    };
    
    const medicine = new Medicine(medicineData);
    await medicine.save();
    
    res.status(201).json(medicine);
  } catch (error) {
    console.error('Add medicine error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Update medicine
router.put('/medicines/:id', auth, isPharmacy, async (req, res) => {
  try {
    const medicine = await Medicine.findOneAndUpdate(
      { _id: req.params.id, pharmacy: req.user.id },
      req.body,
      { new: true }
    );
    
    if (!medicine) {
      return res.status(404).json({ message: 'Medicine not found' });
    }
    
    res.json(medicine);
  } catch (error) {
    console.error('Update medicine error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Delete medicine
router.delete('/medicines/:id', auth, isPharmacy, async (req, res) => {
  try {
    const medicine = await Medicine.findOneAndDelete({
      _id: req.params.id,
      pharmacy: req.user.id
    });
    
    if (!medicine) {
      return res.status(404).json({ message: 'Medicine not found' });
    }
    
    res.json({ message: 'Medicine deleted successfully' });
  } catch (error) {
    console.error('Delete medicine error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get pharmacy orders
router.get('/orders', auth, isPharmacy, async (req, res) => {
  try {
    const { status, page = 1, limit = 10 } = req.query;
    const pharmacy = req.user.id;
    
    let query = { pharmacy };
    if (status && status !== 'all') {
      query.status = status;
    }
    
    const orders = await Order.find(query)
      .populate('patient', 'name email phone')
      .populate('deliveryBoy', 'name phone')
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .sort({ createdAt: -1 });
    
    const total = await Order.countDocuments(query);
    
    res.json({
      orders,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      total
    });
  } catch (error) {
    console.error('Get orders error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Update order status
router.put('/orders/:id/status', auth, isPharmacy, async (req, res) => {
  try {
    const { status, deliveryBoyId } = req.body;
    const validStatuses = ['pending', 'confirmed', 'ready', 'ready_for_pickup', 'assigned', 'pending_acceptance', 'picked_up', 'out_for_delivery', 'delivered', 'cancelled', 'rejected'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ message: 'Invalid status value' });
    }

    // Load order to handle inventory atomically with status change
    const order = await Order.findOne({ _id: req.params.id, pharmacy: req.user.id });
    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    // Optional: assign delivery boy via this route
    if (deliveryBoyId) {
      order.deliveryBoy = deliveryBoyId;
    }

    // If transitioning to ready states, deduct stock once
    const isReadyState = status === 'ready' || status === 'ready_for_pickup';
    const wasReadyState = order.status === 'ready' || order.status === 'ready_for_pickup';
    if (isReadyState && !order.stockDeducted) {
      // Sum quantities per medicine
      const qtyMap = new Map();
      for (const it of order.items || []) {
        const id = String(it.medicine);
        qtyMap.set(id, (qtyMap.get(id) || 0) + Number(it.quantity || 0));
      }

      const ids = Array.from(qtyMap.keys());
      if (ids.length > 0) {
        const meds = await Medicine.find({ _id: { $in: ids }, pharmacy: req.user.id }).select('_id stock name');
        const byId = new Map(meds.map(m => [String(m._id), m]));

        // Validate stock availability
        const insufficient = [];
        for (const [mid, need] of qtyMap.entries()) {
          const m = byId.get(mid);
          if (!m) {
            insufficient.push({ medicineId: mid, reason: 'not_found' });
          } else if ((m.stock || 0) < need) {
            insufficient.push({ medicineId: mid, name: m.name, available: m.stock, required: need, reason: 'insufficient_stock' });
          }
        }
        if (insufficient.length > 0) {
          return res.status(400).json({ message: 'Insufficient stock for one or more medicines', details: insufficient });
        }

        // Perform bulk decrement with $gte guards
        const ops = ids.map(mid => ({
          updateOne: {
            filter: { _id: mid, pharmacy: req.user.id, stock: { $gte: qtyMap.get(mid) } },
            update: { $inc: { stock: -qtyMap.get(mid) } }
          }
        }));
        const bulkRes = await Medicine.bulkWrite(ops, { ordered: true });
        // Sanity check
        if ((bulkRes.modifiedCount || 0) !== ops.length) {
          return res.status(409).json({ message: 'Concurrent inventory update detected. Please retry.' });
        }

        order.stockDeducted = true;
      }
    }

    // Update status and history
    order.status = status;
    order.statusHistory.push({ status, updatedBy: req.user.id });
    await order.save();

    const populated = await Order.findById(order._id)
      .populate('patient', 'name email phone')
      .populate('deliveryBoy', 'name phone');

    res.json(populated);
  } catch (error) {
    console.error('Update order status error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get available delivery boys
router.get('/delivery-boys', auth, isPharmacy, async (req, res) => {
  try {
    const deliveryBoys = await User.find(
      { role: 'delivery_boy' },
      'name phone email'
    );

    // Determine busy delivery boys: those who have an order in an active state
    const activeStates = ['pending_acceptance', 'assigned', 'picked_up', 'out_for_delivery'];
    const busyOrders = await Order.find({
      deliveryBoy: { $ne: null },
      status: { $in: activeStates }
    }).select('deliveryBoy');

    const busySet = new Set(
      busyOrders
        .map(o => o.deliveryBoy && o.deliveryBoy.toString())
        .filter(Boolean)
    );

    const enriched = deliveryBoys.map(db => ({
      _id: db._id,
      name: db.name,
      phone: db.phone,
      email: db.email,
      isBusy: busySet.has(db._id.toString())
    }));
    
    res.json({ deliveryBoys: enriched });
  } catch (error) {
    console.error('Get delivery boys error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get pharmacy analytics
router.get('/analytics', auth, isPharmacy, async (req, res) => {
  try {
    const { days = 30 } = req.query;
    const pharmacyId = req.user.id;

    const toDate = new Date();
    const fromDate = new Date();
    fromDate.setDate(toDate.getDate() - parseInt(days));

    const orders = await Order.find({
      pharmacy: pharmacyId,
      createdAt: { $gte: fromDate, $lte: toDate }
    });

    const totalOrders = orders.length;
    const totalRevenue = orders.reduce((acc, order) => acc + order.totalAmount, 0);

    const newCustomers = await Order.distinct('patient', {
      pharmacy: pharmacyId,
      createdAt: { $gte: fromDate, $lte: toDate }
    });

    const topSellingMedicines = await Order.aggregate([
      { $match: { pharmacy: pharmacyId, createdAt: { $gte: fromDate, $lte: toDate } } },
      { $unwind: '$items' },
      { $group: { _id: '$items.medicine', totalQuantity: { $sum: '$items.quantity' } } },
      { $sort: { totalQuantity: -1 } },
      { $limit: 5 },
      { $lookup: { from: 'medicines', localField: '_id', foreignField: '_id', as: 'medicineDetails' } },
      { $unwind: '$medicineDetails' },
      { $project: { name: '$medicineDetails.name', totalQuantity: 1 } }
    ]);

    res.json({
      totalOrders,
      totalRevenue,
      newCustomers: newCustomers.length,
      topSellingMedicines
    });
  } catch (error) {
    console.error('Get analytics error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   PUT /api/pharmacy/orders/:id/assign-delivery
// @desc    Assign a delivery boy to an order
// @access  Private (Pharmacy)
router.put('/orders/:id/assign-delivery', auth, isPharmacy, async (req, res) => {
  try {
    const { deliveryBoyId } = req.body;
    if (!deliveryBoyId) {
      return res.status(400).json({ message: 'Delivery boy ID is required' });
    }

    const order = await Order.findOne({ _id: req.params.id, pharmacy: req.user.id });

    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    const deliveryBoy = await User.findOne({ _id: deliveryBoyId, role: 'delivery_boy', isVerified: true });

    if (!deliveryBoy) {
      return res.status(404).json({ message: 'Delivery boy not found or not verified' });
    }

    order.deliveryBoy = deliveryBoyId;
    order.status = 'out_for_delivery';
    await order.save();

    const updatedOrder = await Order.findById(order._id)
      .populate('patient', 'name email phone')
      .populate('deliveryBoy', 'name phone');

    res.json(updatedOrder);
  } catch (error) {
    console.error('Error assigning delivery boy:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
