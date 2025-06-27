const express = require('express');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 3000;

const BOT_TOKEN = process.env.BOT_TOKEN;
const WEBEX_ROOM_ID = process.env.WEBEX_ROOM_ID;

app.use(express.json());

app.post('/wrike-webhook', async (req, res) => {
  const secret = req.headers['x-hook-secret'];
  if (secret) {
    res.set('X-Hook-Secret', secret);
    return res.sendStatus(200);
  }

  const body = req.body;
  const task = body.data[0];

  const message = `🎫 **New Wrike Task**\n\n📝 ${task.title}\n🔗 [Open in Wrike](https://www.wrike.com/open.htm?id=${task.id})`;

  try {
    await axios.post('https://webexapis.com/v1/messages', {
      roomId: WEBEX_ROOM_ID,
      markdown: message
    }, {
      headers: { Authorization: `Bearer ${BOT_TOKEN}` }
    });
    res.sendStatus(200);
  } catch (err) {
    console.error(err.response?.data || err);
    res.sendStatus(500);
  }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
