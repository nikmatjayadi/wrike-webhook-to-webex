const express = require('express');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 3000;

const BOT_TOKEN = process.env.BOT_TOKEN;
const WRIKE_TOKEN = process.env.WRIKE_TOKEN;
const MAPPING_ENV = process.env.FOLDER_TO_ROOM_MAP || '';

app.use(express.json());

// Parse env: "123:ROOMID1,456:ROOMID2"
const folderToRoomMap = MAPPING_ENV.split(',')
  .map(pair => pair.trim().split(':'))
  .filter(pair => pair.length === 2)
  .reduce((map, [folderId, roomId]) => {
    map[folderId] = roomId;
    return map;
  }, {});

console.log('✅ Folder → Room mapping:', folderToRoomMap);

app.post('/wrike-webhook', async (req, res) => {
  const token = req.headers['x-request-token'];
  if (token) {
    console.log('✅ Wrike verification request received:', token);
    return res.status(200).send(token);
  }

  const events = req.body;
  if (!Array.isArray(events) || events.length === 0) {
    console.error('❌ Invalid webhook payload:', req.body);
    return res.sendStatus(400);
  }

  const event = events[0];
  const taskId = event.taskId;
  const eventType = event.eventType;

  if (!taskId) {
    console.error('❌ No taskId found in event:', event);
    return res.sendStatus(400);
  }

  try {
    // Get full task details
    const wrikeRes = await axios.get(`https://www.wrike.com/api/v4/tasks/${taskId}`, {
      headers: {
        Authorization: `Bearer ${WRIKE_TOKEN}`
      }
    });

    const task = wrikeRes.data.data[0];
    const folderIds = task.parentIds || [];

    // Find matching roomId
    let roomId = null;
    for (const folderId of folderIds) {
      if (folderToRoomMap[folderId]) {
        roomId = folderToRoomMap[folderId];
        break;
      }
    }

    if (!roomId) {
      console.warn(`⚠️ No matching Webex room for folders: ${folderIds.join(', ')}`);
      return res.sendStatus(204); // No match → ignore silently
    }

    const message = `🎫 **Wrike Task ${eventType}**  
📝 ${task.title || 'No title'}  
📁 Folder(s): ${folderIds.join(', ')}  
🔗 [Open in Wrike](https://www.wrike.com/open.htm?id=${task.id})`;

    await axios.post(
      'https://webexapis.com/v1/messages',
      {
        roomId,
        markdown: message
      },
      {
        headers: {
          Authorization: `Bearer ${BOT_TOKEN}`
        }
      }
    );

    console.log(`✅ Message sent to Webex room ${roomId} for task ${taskId}`);
    res.sendStatus(200);
  } catch (err) {
    console.error('❌ Error handling event:', err.response?.data || err.message);
    res.sendStatus(500);
  }
});

app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
