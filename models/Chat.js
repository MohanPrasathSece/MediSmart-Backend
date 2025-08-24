const mongoose = require('mongoose');

const chatSchema = new mongoose.Schema({
  order: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Order',
    required: true
  },
  participants: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    role: {
      type: String,
      enum: ['patient', 'pharmacy', 'delivery_boy'],
      required: true
    },
    joinedAt: {
      type: Date,
      default: Date.now
    },
    lastSeen: {
      type: Date,
      default: Date.now
    }
  }],
  messages: [{
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    senderRole: {
      type: String,
      enum: ['patient', 'pharmacy', 'delivery_boy'],
      required: true
    },
    content: {
      type: String,
      required: true,
      trim: true
    },
    messageType: {
      type: String,
      enum: ['text', 'image', 'location', 'system'],
      default: 'text'
    },
    attachments: [{
      type: String,
      url: String,
      filename: String
    }],
    location: {
      latitude: Number,
      longitude: Number,
      address: String
    },
    timestamp: {
      type: Date,
      default: Date.now
    },
    readBy: [{
      user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      },
      readAt: {
        type: Date,
        default: Date.now
      }
    }],
    isEdited: {
      type: Boolean,
      default: false
    },
    editedAt: Date
  }],
  isActive: {
    type: Boolean,
    default: true
  },
  lastActivity: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Indexes
chatSchema.index({ order: 1 });
chatSchema.index({ 'participants.user': 1 });
chatSchema.index({ 'messages.timestamp': -1 });
chatSchema.index({ lastActivity: -1 });

// Update last activity when new message is added
chatSchema.pre('save', function(next) {
  if (this.isModified('messages')) {
    this.lastActivity = new Date();
  }
  next();
});

// Method to add message
chatSchema.methods.addMessage = function(senderId, senderRole, content, messageType = 'text', attachments = [], location = null) {
  const message = {
    sender: senderId,
    senderRole,
    content,
    messageType,
    attachments,
    location,
    timestamp: new Date()
  };
  
  this.messages.push(message);
  this.lastActivity = new Date();
  
  return this.save();
};

// Method to mark messages as read
chatSchema.methods.markAsRead = function(userId) {
  const unreadMessages = this.messages.filter(msg => 
    !msg.readBy.some(read => read.user.toString() === userId.toString())
  );
  
  unreadMessages.forEach(msg => {
    msg.readBy.push({
      user: userId,
      readAt: new Date()
    });
  });
  
  // Update participant's last seen
  const participant = this.participants.find(p => 
    p.user.toString() === userId.toString()
  );
  if (participant) {
    participant.lastSeen = new Date();
  }
  
  return this.save();
};

// Method to get unread message count for a user
chatSchema.methods.getUnreadCount = function(userId) {
  return this.messages.filter(msg => 
    msg.sender.toString() !== userId.toString() &&
    !msg.readBy.some(read => read.user.toString() === userId.toString())
  ).length;
};

// Static method to create chat for order
chatSchema.statics.createOrderChat = async function(orderId, patientId, pharmacyId) {
  const chat = new this({
    order: orderId,
    participants: [
      { user: patientId, role: 'patient' },
      { user: pharmacyId, role: 'pharmacy' }
    ]
  });
  
  // Add system message
  chat.messages.push({
    sender: patientId,
    senderRole: 'patient',
    content: 'Order chat created. You can now communicate with the pharmacy.',
    messageType: 'system',
    timestamp: new Date()
  });
  
  return await chat.save();
};

// Method to add delivery boy to chat
chatSchema.methods.addDeliveryBoy = function(deliveryBoyId) {
  const existingParticipant = this.participants.find(p => 
    p.user.toString() === deliveryBoyId.toString()
  );
  
  if (!existingParticipant) {
    this.participants.push({
      user: deliveryBoyId,
      role: 'delivery_boy',
      joinedAt: new Date()
    });
    
    // Add system message
    this.messages.push({
      sender: deliveryBoyId,
      senderRole: 'delivery_boy',
      content: 'Delivery boy joined the chat.',
      messageType: 'system',
      timestamp: new Date()
    });
  }
  
  return this.save();
};

module.exports = mongoose.model('Chat', chatSchema);
