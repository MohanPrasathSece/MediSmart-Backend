const express = require('express');
const Chat = require('../models/Chat');
const { auth } = require('../middleware/auth');

const router = express.Router();

// @route   GET /api/chat/:orderId
// @desc    Get chat for order
// @access  Private
router.get('/:orderId', auth, async (req, res) => {
  try {
    const chat = await Chat.findOne({ order: req.params.orderId })
      .populate('participants.user', 'name role')
      .populate('messages.sender', 'name role');

    if (!chat) {
      return res.status(404).json({ message: 'Chat not found' });
    }

    // Check if user is participant
    const isParticipant = chat.participants.some(p => 
      p.user._id.toString() === req.user.id
    );

    if (!isParticipant) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Mark messages as read
    await chat.markAsRead(req.user.id);

    res.json(chat);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching chat' });
  }
});

// @route   POST /api/chat/:orderId/messages
// @desc    Send message
// @access  Private
router.post('/:orderId/messages', auth, async (req, res) => {
  try {
    const { content, messageType = 'text', attachments = [], location } = req.body;

    const chat = await Chat.findOne({ order: req.params.orderId });
    if (!chat) {
      return res.status(404).json({ message: 'Chat not found' });
    }

    await chat.addMessage(req.user.id, req.user.role, content, messageType, attachments, location);

    // Emit real-time message
    const { io } = require('../server');
    io.to(`chat-${chat._id}`).emit('new-message', {
      sender: req.user.name,
      senderRole: req.user.role,
      content,
      messageType,
      timestamp: new Date()
    });

    res.json({ message: 'Message sent successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Error sending message' });
  }
});

module.exports = router;
