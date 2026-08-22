# whatsapp-bot1const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');

const app = express();
app.use(bodyParser.json({ limit: '10mb' })); // لدعم صور الإيصالات الكبيرة

// مفاتيح الربط (توضع لاحقاً في إعدادات المنصة البيئية Environment Variables)
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;

// قاعدة بيانات المحلات واشتراكاتها (يمكن نقلها لاحقاً لـ Database حقيقية)
const storesDB = {
  // مفتاحها هو الـ phone_number_id الخاص بواتساب المحل
  "STORE_PHONE_NUMBER_ID_HERE": {
    name: "مطعم الرافدين",
    type: "مطعم عراقي (شاورما وأكلات شعبية)",
    menu: "شاورما دجاج: 3000 دينار\nشاورما لحم: 3500 دينار\nتكة كباب: 5000 دينار",
    hours: "يومياً من 12 ظهراً إلى 12 منتصف الليل",
    extra: "نوصل داخل بغداد فقط. الدفع نقداً أو زين كاش.",
    subscriptionStatus: "active", // active أو expired
    expiresAt: "2026-09-25"       // تاريخ انتهاء الاشتراك
  }
};

// 1. التحقق من ربط الـ Webhook مع Meta
app.get('/webhook', (req, res) => {
  const VERIFY_TOKEN = "rafid_secure_token_2026";
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode && token === VERIFY_TOKEN) {
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// 2. استقبال الرسائل والصور من واتساب
app.post('/webhook', async (req, res) => {
  try {
    const body = req.body;

    if (body.object && body.entry && body.entry[0].changes) {
      const changeValue = body.entry[0].changes[0].value;
      
      if (changeValue.messages && changeValue.messages[0]) {
        const messageObj = changeValue.messages[0];
        const customerPhone = messageObj.from;
        const storeId = changeValue.metadata.phone_number_id;
        const store = storesDB[storeId];

        if (!store) {
          return res.sendStatus(200);
        }

        // التحقق من حالة اشتراك المحل
        const isExpired = new Date(store.expiresAt) < new Date();
        if (store.subscriptionStatus !== "active" || isExpired) {
          await sendWhatsAppMessage(customerPhone, "عذراً، هذا البوت متوقف مؤقتاً لتجديد الاشتراك الشهري.");
          return res.sendStatus(200);
        }

        // أ) إذا أرسل صاحب المحل صورة (إيصال زين كاش)
        if (messageObj.type === 'image') {
          const imageId = messageObj.image.id;
          const { base64Data, mimeType } = await getWhatsAppMedia(imageId);
          await handleReceiptUpload(customerPhone, storeId, base64Data, mimeType);
        } 
        // ب) إذا أرسل الزبون رسالة نصية طبيعية
        else if (messageObj.type === 'text') {
          const userMessage = messageObj.text.body;
          const aiReply = await getClaudeReply(userMessage, store);
          await sendWhatsAppMessage(customerPhone, aiReply);
        }
      }
      res.status(200).send('EVENT_RECEIVED');
    } else {
      res.sendStatus(404);
    }
  } catch (error) {
    console.error("Webhook Error:", error);
    res.sendStatus(500);
  }
});

// 3. دالة جلب الرد من Claude باللهجة العراقية
async function getClaudeReply(userMessage, store) {
  const systemPrompt = `أنت مساعد ذكاء اصطناعي يرد تلقائياً على رسائل الزبائن عبر واتساب نيابةً عن هذا المحل. استخدم فقط المعلومات المذكورة أدناه، ولا تختلق معلومات غير موجودة.

قواعد اللهجة والأسلوب:
- احچي بالعامية العراقية الدارجة الحقيقية (مثل: هلا وغلا، شلونك، شكو ماكو، اكو/ماكو، شنو، وين، هسه، چم، زين، خوش، تدلل، حاضر).
- اكتب بإملاء عربي صحيح تماماً بدون أخطاء، واجعل الرد قصير ومباشر (سطرين إلى ثلاثة أسطر كحد أقصى).

معلومات المحل:
اسم المحل: ${store.name}
نوع النشاط: ${store.type}
القائمة والأسعار:
${store.menu}
أوقات الدوام: ${store.hours}
معلومات إضافية: ${store.extra}`;

  try {
    const response = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: 'claude-sonnet-4-6',
        max_tokens: 300,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }]
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
        }
      }
    );

    return response.data.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim() || "عذراً، ما كدرت أجاوب هسه، جرب مرة ثانية.";
  } catch (err) {
    console.error("Claude API Error:", err.response?.data || err.message);
    return "عذراً، صار عندي خلل بسيط بالخدمة، ثواني وارجع أرد عليك.";
  }
}

// 4. دالة فحص إيصال زين كاش وتجديد الاشتراك تلقائياً عبر ميزة Vision
async function handleReceiptUpload(senderPhone, storeId, base64Image, mediaType) {
  try {
    const response = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: 'claude-sonnet-4-6',
        max_tokens: 300,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: { type: 'base64', media_type: mediaType, data: base64Image }
              },
              {
                type: 'text',
                text: "هذه صورة إيصال تحويل مالي عبر زين كاش لاشتراك بوت واتساب. افحص الصورة بدقة وأجبني فقط بكلمة واحدة: 'VALID' إذا كان الإيصال يبدو حقيقياً وواضحاً، أو 'INVALID' إذا كان غير واضح أو مزيفاً."
              }
            ]
          }
        ]
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
        }
      }
    );

    const aiVerdict = response.data.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();

    if (aiVerdict.includes('VALID')) {
      const store = storesDB[storeId];
      if (store) {
        const newExpiry = new Date();
        newExpiry.setDate(newExpiry.getDate() + 30);
        store.expiresAt = newExpiry.toISOString().split('T')[0];
        store.subscriptionStatus = "active";

        await sendWhatsAppMessage(senderPhone, "تم التحقق من إيصال زين كاش بنجاح! 🚀 تم تفعيل اشتراك محلك لشهر إضافي. شكراً لك.");
      }
    } else {
      await sendWhatsAppMessage(senderPhone, "عذراً، لم نتمكن من التحقق من الإيصال. يرجى التأكد من وضوح صورة التحويل وإعادة إرسالها.");
    }
  } catch (error) {
    console.error("Receipt Processing Error:", error);
    await sendWhatsAppMessage(senderPhone, "حدث خطأ أثناء معالجة الصورة، يرجى المحاولة لاحقاً.");
  }
}

// 5. دوال مساعدة لجلب الوسائط وإرسال رسائل واتساب
async function getWhatsAppMedia(mediaId) {
  const mediaMeta = await axios.get(`https://graph.facebook.com/v17.0/${mediaId}`, {
    headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` }
  });
  const mediaUrl = mediaMeta.data.url;
  const mimeType = mediaMeta.data.mime_type || 'image/jpeg';

  const mediaResponse = await axios.get(mediaUrl, {
    headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` },
    responseType: 'arraybuffer'
  });
  const base64Data = Buffer.from(mediaResponse.data).toString('base64');
  return { base64Data, mimeType };
}

async function sendWhatsAppMessage(recipientPhone, messageText) {
  // يرجى استبدال PHONE_NUMBER_ID برقم معرّف واتساب الخاص بك من ميتا
  const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
  await axios.post(
    `https://graph.facebook.com/v17.0/${PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to: recipientPhone,
      text: { body: messageText },
    },
    {
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        "Content-Type": "application/json",
      },
    }
  );
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
