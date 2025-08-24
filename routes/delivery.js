const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const Order = require('../models/Order');
const User = require('../models/User');

// Middleware to ensure user is a delivery boy
const isDeliveryBoy = (req, res, next) => {
  if (req.user.role !== 'delivery_boy') {
    return res.status(403).json({ message: 'Access denied. Delivery boy role required.' });
  }
  next();
};

// Get delivery boy dashboard stats
router.get('/dashboard/stats', auth, isDeliveryBoy, async (req, res) => {
  try {
    const deliveryBoyId = req.user.id;
    
    // Get assigned orders
    const assignedOrders = await Order.countDocuments({ 
      deliveryBoyId,
      status: { $in: ['assigned', 'out_for_delivery'] }
    });
    
    // Get completed deliveries today
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const todayDeliveries = await Order.countDocuments({
      deliveryBoyId,
      status: 'delivered',
      updatedAt: { $gte: today }
    });
    
    // Get total completed deliveries
    const totalDeliveries = await Order.countDocuments({
      deliveryBoyId,
      status: 'delivered'
    });
    
    // Calculate today's earnings
    const todayEarnings = await Order.aggregate([
      {
        $match: {
          deliveryBoyId: req.user.id,
          status: 'delivered',
          updatedAt: { $gte: today }
        }
      },
      {
        $group: {
          _id: null,
          total: { $sum: '$deliveryFee' }
        }
      }
    ]);
    
    res.json({
      assignedOrders,
      todayDeliveries,
      totalDeliveries,
      todayEarnings: todayEarnings[0]?.total || 0
    });
  } catch (error) {
    console.error('Delivery dashboard stats error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get assigned orders for delivery boy
router.get('/orders', auth, isDeliveryBoy, async (req, res) => {
  try {
    const { status, page = 1, limit = 10 } = req.query;
    const deliveryBoyId = req.user.id;
    
    let query = { deliveryBoyId };
    if (status && status !== 'all') {
      query.status = status;
    }
    
    const orders = await Order.find(query)
      .populate('userId', 'name email phone address')
      .populate('pharmacyId', 'name phone address')
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
    console.error('Get delivery orders error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Update delivery status
router.put('/orders/:id/status', auth, isDeliveryBoy, async (req, res) => {
  try {
    const { status, location } = req.body;
    
    const updateData = { status };
    if (location) {
      updateData.currentLocation = location;
    }
    
    const order = await Order.findOneAndUpdate(
      { _id: req.params.id, deliveryBoyId: req.user.id },
      updateData,
      { new: true }
    ).populate('userId', 'name email phone')
     .populate('pharmacyId', 'name phone');
    
    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }
    
    res.json(order);
  } catch (error) {
    console.error('Update delivery status error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   GET /api/delivery/available
// @desc    Get available delivery boys
// @access  Private (Pharmacy)
router.get('/available', auth, authorize('pharmacy'), async (req, res) => {
  try {
    const deliveryBoys = await User.find({ role: 'delivery_boy', 'deliveryDetails.isAvailable': true });
    res.json(deliveryBoys);
  } catch (error) {
    console.error('Error fetching available delivery boys:', error);
    res.status(500).json({ message: 'Error fetching available delivery boys' });
  }
});

// @route   PUT /api/delivery/orders/:id/accept
// @desc    Accept a delivery assignment
// @access  Private (Delivery Boy)
router.put('/orders/:id/accept', auth, isDeliveryBoy, async (req, res) => {
  try {
    const order = await Order.findOne({ _id: req.params.id, deliveryBoy: req.user.id, status: 'pending_acceptance' });

    if (!order) {
      return res.status(404).json({ message: 'Order not found or you are not authorized to accept it.' });
    }

    order.status = 'assigned';
    order.statusHistory.push({
      status: 'assigned',
      updatedBy: req.user.id,
      notes: 'Delivery accepted by delivery boy.'
    });

    await order.save();
    res.json({ message: 'Order accepted successfully.', order });

  } catch (error) {
    console.error('Error accepting order:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   PUT /api/delivery/orders/:id/reject
// @desc    Reject a delivery assignment
// @access  Private (Delivery Boy)
router.put('/orders/:id/reject', auth, isDeliveryBoy, async (req, res) => {
  try {
    const order = await Order.findOne({ _id: req.params.id, deliveryBoy: req.user.id, status: 'pending_acceptance' });

    if (!order) {
      return res.status(404).json({ message: 'Order not found or you are not authorized to reject it.' });
    }

    order.status = 'pending';
    order.deliveryBoy = undefined;
    order.statusHistory.push({
      status: 'pending',
      updatedBy: req.user.id,
      notes: 'Delivery rejected by delivery boy. Awaiting reassignment.'
    });

    await order.save();
    res.json({ message: 'Order rejected.', order });

  } catch (error) {
    console.error('Error rejecting order:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
