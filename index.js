const express = require('express');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 3000;

const BOT_TOKEN = process.env.BOT_TOKEN;
const WEBEX_ROOM_ID = process.env.WEBEX_ROOM_ID;
const WRIKE_TOKEN = process.env.WRIKE_TOKEN;

app.use(express.json());

app.post('/wrike-webhook', async (req, res) => {
  // Handle Wrike webhook verification
  const token = req.headers['x-request-token'];
  if (token) {
    console.log('✅ Wrike verification received with token:', token);
    return res.status(200).send(token); // Echo back token
  }

  const events = req.body;

  if (!Array.isArray(events) || events.length === 0) {
    console.error('❌ Invalid webhook payload:', req.body);
    return res.sendStatus(400);
  }

  // You can loop through events if needed, here we handle the first one
  const event = events[0];

  const taskId = event.taskId;
  const eventType = event.eventType;

  if (!taskId) {
    console.error('❌ Missing taskId in event:', event);
    return res.sendStatus(400);
  }

  try {
    // Fetch full task details from Wrike
    const wrikeRes = await axios.get(`https://www.wrike.com/api/v4/tasks/${taskId}`, {
      headers: {
        Authorization: `Bearer ${WRIKE_TOKEN}`
      }
    });

    const task = wrikeRes.data.data[0];

    const message = `🎫 **Wrike Task ${eventType}**  
📝 ${task.title || 'No title'}  
🔗 [Open in Wrike](https://www.wrike.com/open.htm?id=${task.id})`;

    await axios.post(
      'https://webexapis.com/v1/messages',
      {
        roomId: WEBEX_ROOM_ID,
        markdown: message
      },
      {
        headers: {
          Authorization: `Bearer ${BOT_TOKEN}`
        }
      }
    );

    console.log(`✅ Webex message sent for task ${taskId}`);
    res.sendStatus(200);
  } catch (err) {
    console.error('❌ Error handling webhook event:', err.response?.data || err.message);
    res.sendStatus(500);
  }
});

app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
