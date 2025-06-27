const express = require('express');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 3000;

const BOT_TOKEN = process.env.BOT_TOKEN;
const WEBEX_ROOM_ID = process.env.WEBEX_ROOM_ID;

app.use(express.json());

app.post('/wrike-webhook', async (req, res) => {
  // Handle Wrike webhook verification
  const token = req.headers['x-request-token'];
  if (token) {
    console.log('Received Wrike verification request with token:', token);
    return res.status(200).send(token); // Echo back token in response body
  }

  // Handle actual webhook event
  const body = req.body;

  if (!body.data || !Array.isArray(body.data) || body.data.length === 0) {
    console.error('Invalid webhook payload:', body);
    return res.sendStatus(400);
  }

  const task = body.data[0];

  const message = `🎫 **New Wrike Task Event**\n\n📝 ${task.title || 'No title'}\n🔗 [Open in Wrike](https://www.wrike.com/open.htm?id=${task.id})`;

  try {
    await axios.post(
      'https://webexapis.com/v1/messages',
      {
        roomId: WEBEX_ROOM_ID,
        markdown: message
      },
      {
        headers: { Authorization: `Bearer ${BOT_TOKEN}` }
      }
    );
    res.sendStatus(200);
  } catch (err) {
    console.error('Failed to send Webex message:', err.response?.data || err.message);
    res.sendStatus(500);
  }
});

app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
