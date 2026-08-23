const mongoose = require('mongoose');

const shopSchema = new mongoose.Schema({
    shopName: { type: String, required: true },
    phoneNumberId: { type: String, required: true, unique: true },
    accessToken: { type: String, required: true },
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Shop', shopSchema);
