const express = require('express');
const { body, validationResult } = require('express-validator');
const Order = require('../models/Order');
const Medicine = require('../models/Medicine');
const Chat = require('../models/Chat');
const User = require('../models/User');
const { auth, authorize } = require('../middleware/auth');

const router = express.Router();

// @route   POST /api/orders
// @desc    Create new order
// @access  Private (Patient)
router.post('/', auth, authorize('patient'), async (req, res) => {
  try {
    const { items, pharmacy, deliveryAddress, prescription, paymentMethod } = req.body;

    let subtotal = 0;
    const orderItems = [];

    for (const item of items) {
      const medicine = await Medicine.findById(item.medicine);
      if (!medicine) {
        return res.status(404).json({ message: `Medicine ${item.medicine} not found` });
      }

      const pharmacyInventory = (medicine.pharmacyInventory || []).find(
        inv => inv.pharmacy.toString() === pharmacy && inv.isAvailable && inv.stock >= item.quantity
      );

      let invRecord = pharmacyInventory;
      if (!invRecord && medicine.pharmacy?.toString() === pharmacy) {
        if (medicine.stock < item.quantity) {
          return res.status(400).json({ message: `Insufficient stock for ${medicine.name}` });
        }
        invRecord = { price: medicine.price, discount: 0, stock: medicine.stock };
      }

      if (!invRecord) {
        return res.status(400).json({ message: `Insufficient stock for ${medicine.name} at this pharmacy.` });
      }

      const finalPrice = invRecord.price * (1 - (invRecord.discount || 0) / 100);
      orderItems.push({
        medicine: item.medicine,
        quantity: item.quantity,
        price: invRecord.price,
        discount: invRecord.discount || 0,
        finalPrice
      });
      subtotal += finalPrice * item.quantity;
    }

    const tax = subtotal * 0.05; // 5% tax
    const deliveryFee = 50; // Flat delivery fee
    const total = subtotal + tax + deliveryFee;

    const newOrder = new Order({
      orderNumber: `MEDISMRT-${Date.now()}`,
      patient: req.user.id,
      pharmacy,
      items: orderItems,
      pricing: { subtotal, tax, deliveryFee, total },
      deliveryAddress,
      prescription,
      paymentMethod,
      statusHistory: [{ status: 'pending', updatedBy: req.user.id }]
    });

    const order = await newOrder.save();

    const participants = [
      { user: req.user.id, role: 'patient' },
      { user: pharmacy, role: 'pharmacy' }
    ];
    const chat = new Chat({
      order: order._id,
      participants
    });
    await chat.save();

    order.chat = chat._id;
    await order.save();

    res.status(201).json(order);

  } catch (err) {
    console.error('Order creation error:', {
      name: err.name,
      message: err.message,
      stack: err.stack,
      errors: err.errors ? Object.keys(err.errors) : 'No errors object',
      code: err.code,
      keyPattern: err.keyPattern,
      keyValue: err.keyValue,
      // Log the full error object for debugging
      fullError: JSON.stringify(err, Object.getOwnPropertyNames(err))
    });
    
    if (err.name === 'ValidationError') {
      const validationErrors = {};
      for (let field in err.errors) {
        validationErrors[field] = {
          message: err.errors[field].message,
          value: err.errors[field].value,
          kind: err.errors[field].kind,
          path: err.errors[field].path,
          properties: err.errors[field].properties
        };
      }
      console.log('Full validation errors:', JSON.stringify(validationErrors, null, 2));
      return res.status(400).json({ 
        message: 'Validation Error', 
        errors: validationErrors 
      });
    }
    
    res.status(500).json({ 
      message: 'Server error during order creation', 
      error: err.message,
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
  }
});

// @route   GET /api/orders
// @desc    Get user orders
// @access  Private
router.get('/', auth, async (req, res) => {
  try {
    const { status, page = 1, limit = 10 } = req.query;
    
    const orders = await Order.getOrdersByStatus(status, req.user.id, req.user.role)
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    res.json({ orders });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching orders' });
  }
});

// @route   PUT /api/orders/:id/status
// @desc    Update order status
// @access  Private
router.put('/:id/status', auth, async (req, res) => {
  try {
    const { status, notes, location } = req.body;
    const order = await Order.findById(req.params.id);

    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    // Check authorization
    const canUpdate = (
      (req.user.role === 'pharmacy' && order.pharmacy.toString() === req.user.id) ||
      (req.user.role === 'delivery_boy' && order.deliveryBoy?.toString() === req.user.id)
    );

    if (!canUpdate) {
      return res.status(403).json({ message: 'Not authorized to update this order' });
    }

    order.status = status;
    order._updatedBy = req.user.id;

    if (notes || location) {
      order.statusHistory.push({
        status,
        updatedBy: req.user.id,
        notes,
        location
      });
    }

    await order.save();

    // Emit real-time update
    const { io } = require('../server');
    io.to(`order-${order._id}`).emit('order-status-updated', {
      orderId: order._id,
      status,
      updatedBy: req.user.name,
      timestamp: new Date()
    });

    res.json({ message: 'Order status updated', order });
  } catch (error) {
    res.status(500).json({ message: 'Error updating order status' });
  }
});

// @route   GET /api/orders/assigned
// @desc    Get orders assigned to a delivery person
// @access  Private (Delivery Boy)
router.get('/assigned', auth, authorize('delivery_boy'), async (req, res) => {
  try {
    const assignedOrders = await Order.find({ deliveryBoy: req.user.id })
      .populate('patient', 'name')
      .populate('pharmacy', 'name location.address')
      .sort({ createdAt: -1 });

    res.json({ orders: assignedOrders });
  } catch (error) {
    console.error('Error fetching assigned orders:', error);
    res.status(500).json({ message: 'Error fetching assigned orders' });
  }
});

// @route   PUT /api/orders/:id/assign-delivery
// @desc    Assign a delivery boy to an order
// @access  Private (Pharmacy)
router.put('/:id/assign-delivery', auth, authorize('pharmacy'), async (req, res) => {
  try {
        const { deliveryBoyId } = req.body;
    console.log(`Assigning delivery boy. Order ID: ${req.params.id}, Delivery Boy ID: ${deliveryBoyId}`);
    const order = await Order.findById(req.params.id);

    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    if (order.pharmacy.toString() !== req.user.id) {
      return res.status(403).json({ message: 'Not authorized to update this order' });
    }

        const deliveryBoy = await User.findOne({ _id: deliveryBoyId, role: 'delivery_boy' });
    if (!deliveryBoy) {
      return res.status(404).json({ message: 'Delivery boy not found' });
    }

    order.deliveryBoy = deliveryBoyId;
    order.status = 'pending_acceptance';
    if (!Array.isArray(order.statusHistory)) order.statusHistory = [];
    order.statusHistory.push({
      status: 'assigned',
      updatedBy: req.user.id,
      notes: `Delivery request sent to ${deliveryBoy.name}`
    });
    
    await order.save({ validateBeforeSave: false });

    res.json({ message: 'Delivery boy assigned successfully', order });
  } catch (error) {
        console.error('Error assigning delivery boy:', error?.message, error?.stack);
    res.status(500).json({ message: `Server error while assigning delivery boy: ${error.message}` });
  }
});

// @route   GET /api/orders/delivery
// @desc    Get orders assigned to the logged-in delivery boy
// @access  Private (Delivery Boy)
router.get('/delivery/my-orders', auth, authorize('delivery_boy'), async (req, res) => {
  try {
    const orders = await Order.find({ deliveryBoy: req.user.id })
      .populate('patient', 'name deliveryAddress')
      .populate('pharmacy', 'name address')
      .sort({ createdAt: -1 });

    if (!orders) {
      return res.status(404).json({ message: 'No orders found for this delivery boy.' });
    }

    res.json(orders);
  } catch (error) {
    console.error('Server Error:', error);
    res.status(500).send('Server Error');
  }
});

// @route   PUT /api/orders/:id/respond
// @desc    Delivery boy accepts or rejects an order
// @access  Private (Delivery Boy)
router.put('/:id/respond', auth, authorize('delivery_boy'), async (req, res) => {
  const { response } = req.body; // 'accepted' or 'rejected'

  try {
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ message: 'Order not found' });
    if (order.deliveryBoy?.toString() !== req.user.id) {
      return res.status(403).json({ message: 'You are not assigned to this order.' });
    }
    if (order.status !== 'pending_acceptance') {
      return res.status(400).json({ message: 'Order is not pending acceptance.' });
    }

    // Ensure statusHistory array exists for legacy orders
    if (!Array.isArray(order.statusHistory)) order.statusHistory = [];

    if (response === 'accepted') {
      order.status = 'assigned';
      order.statusHistory.push({ status: 'assigned', updatedBy: req.user.id, notes: 'Delivery accepted by boy.' });
    } else if (response === 'rejected') {
      order.status = 'rejected';
      order.statusHistory.push({ status: 'rejected', updatedBy: req.user.id, notes: 'Delivery rejected by boy.' });
      order.deliveryBoy = null;
    } else {
      return res.status(400).json({ message: 'Invalid response.' });
    }

    await order.save({ validateBeforeSave: false });
    res.json(order);
  } catch (error) {
    console.error('Error responding to order:', error?.message, error?.stack);
    res.status(500).json({ message: 'Server Error while responding to order', error: error?.message });
  }
});

// @route   PUT /api/orders/:id/update-delivery-status
// @desc    Delivery boy updates order status (picked_up, delivered)
// @access  Private (Delivery Boy)
router.put('/:id/update-delivery-status', auth, authorize('delivery_boy'), async (req, res) => {
  const { status } = req.body;

  try {
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ message: 'Order not found' });
    if (order.deliveryBoy?.toString() !== req.user.id) {
      return res.status(403).json({ message: 'You are not assigned to this order.' });
    }

    const allowedUpdates = {
      assigned: 'picked_up',
      picked_up: 'out_for_delivery', // Assuming pharmacy dispatches, then boy picks up
      out_for_delivery: 'delivered',
    };

    if (allowedUpdates[order.status] !== status) {
        return res.status(400).json({ message: `Cannot update status from ${order.status} to ${status}` });
    }

    // Ensure statusHistory array exists for legacy orders
    if (!Array.isArray(order.statusHistory)) order.statusHistory = [];

    order.status = status;
    order.statusHistory.push({ status, updatedBy: req.user.id });

    if (status === 'delivered') {
      order.deliveredAt = Date.now();
    }

    await order.save({ validateBeforeSave: false });
    res.json(order);
  } catch (error) {
    console.error('Error updating delivery status:', error?.message, error?.stack);
    res.status(500).json({ message: 'Server Error while updating delivery status', error: error?.message });
  }
});

// @route   GET /api/orders/:id
// @desc    Get a single order by ID (role-based access)
// @access  Private (Patient | Pharmacy | Delivery Boy)
router.get('/:id', auth, async (req, res) => {
  try {
    const order = await Order.findById(req.params.id)
      .populate('patient', 'name email phone')
      .populate('pharmacy', 'name address')
      .populate('deliveryBoy', 'name phone')
      .populate('items.medicine', 'name brand manufacturer');

    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    const userId = req.user.id;
    const role = req.user.role;

    const canView = (
      (role === 'patient' && order.patient?._id?.toString() === userId) ||
      (role === 'pharmacy' && order.pharmacy?._id?.toString() === userId) ||
      (role === 'delivery_boy' && order.deliveryBoy?._id?.toString() === userId)
    );

    if (!canView) {
      return res.status(403).json({ message: 'Not authorized to view this order' });
    }

    res.json(order);
  } catch (error) {
    console.error('Error fetching order by id:', error);
    res.status(500).json({ message: 'Error fetching order' });
  }
});

module.exports = router;
