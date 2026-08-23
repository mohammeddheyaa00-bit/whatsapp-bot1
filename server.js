Const express = require('express');
const mongoose = require('mongoose');
const axios = require('axios');
const Shop = require('./models/Shop');

const app = express();
app.use(express.json());

mongoose.connect(process.env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
}).then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('MongoDB connection error:', err));

app.post('/api/register-shop', async (req, res) => {
    try {
        const { shopName, phoneNumberId, accessToken } = req.body;
        
        const existingShop = await Shop.findOne({ phoneNumberId });
        if (existingShop) {
            return res.status(400).json({ error: 'هذا المحل أو رقم الواتساب مسجل مسبقاً!' });
        }

        const newShop = new Shop({ shopName, phoneNumberId, accessToken });
        await newShop.save();

        res.status(201).json({ message: 'تم تسجيل المحل بنجاح وأصبح له بوت مستقل!', shop: newShop });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/webhook', (req, res) => {
    const VERIFY_TOKEN = "my_secure_verify_token";
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode && token === VERIFY_TOKEN) {
        res.status(200).send(challenge);
    } else {
        res.sendStatus(403);
    }
});

app.post('/webhook', async (req, res) => {
    try {
        const entry = req.body.entry?.[0];
        const changes = entry?.changes?.[0];
        const value = changes?.value;

        if (value?.messages) {
            const phoneNumberId = value.metadata.phone_number_id; 
            const message = value.messages[0];
            const senderPhone = message.from;                    
            const messageText = message.text?.body;              

            const shop = await Shop.findOne({ phoneNumberId });

            if (!shop) {
                console.log(`تم استقبال رسالة لرقم غير مسجل: ${phoneNumberId}`);
                return res.sendStatus(200);
            }

            console.log(`رسالة موجهة إلى محل (${shop.shopName}) من الزبون: ${senderPhone}`);

            await axios.post(
                `https://graph.facebook.com/v17.0/${phoneNumberId}/messages`,
                {
                    messaging_product: "whatsapp",
                    to: senderPhone,
                    text: { body: `أهلاً بك في ${shop.shopName}! تم استلام رسالتك بنجاح.` }
                },
                {
                    headers: { Authorization: `Bearer ${shop.accessToken}` }
                }
            );
        }

        res.sendStatus(200);
    } catch (error) {
        console.error("Error handling webhook:", error);
        res.sendStatus(500);
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
