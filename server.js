require('dotenv').config();
const express = require('express');
const cors = require('cors');

const authController = require('./authController');
const leaseController = require('./leaseController');
const adminController = require('./adminController');
const webhookController = require('./webhookController');
require('./cronJobs'); // Starts background daily yield worker

const app = express();
app.use(cors());
app.use(express.json());

// Routes
app.post('/api/auth/register', authController.register);
app.post('/api/leases/purchase', leaseController.purchaseLease); // Add your auth middleware here
app.get('/api/admin/pending', adminController.getPendingTransactions);
app.post('/api/admin/resolve', adminController.resolveTransaction);
app.post('/api/webhook/flutterwave', webhookController.handleFlutterwaveWebhook);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`AgriYield Server running on port ${PORT}`);
});