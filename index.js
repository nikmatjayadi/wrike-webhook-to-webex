const express = require('express');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 3000;

const BOT_TOKEN = process.env.BOT_TOKEN;
const WRIKE_TOKEN = process.env.WRIKE_TOKEN;
const MAPPING_ENV = process.env.FOLDER_TO_ROOM_MAP || '';

// Custom field label to display (can be "Technology" or field ID)
const TECHNOLOGY_FIELD_NAME = 'Technology'; // Update to field ID if needed

app.use(express.json());

// Parse mapping from env: "123:FOLDER1,456:FOLDER2"
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
    // Fetch full task details
    const taskRes = await axios.get(`https://www.wrike.com/api/v4/tasks/${taskId}`, {
      headers: { Authorization: `Bearer ${WRIKE_TOKEN}` }
    });

    const task = taskRes.data.data[0];
    const folderIds = task.parentIds || [];

    // Match folder ID to Webex room
    let roomId = null;
    for (const folderId of folderIds) {
      if (folderToRoomMap[folderId]) {
        roomId = folderToRoomMap[folderId];
        break;
      }
    }

    if (!roomId) {
      console.warn(`⚠️ No Webex room for folders: ${folderIds.join(', ')}`);
      return res.sendStatus(204); // Skip if no match
    }

    // Format priority
    const priorityMap = {
      'Low': '🟢 Low',
      'Normal': '🟡 Normal',
      'High': '🔴 High',
      'Urgent': '🚨 Urgent'
    };
    const priority = priorityMap[task.importance] || '❔ Unknown';

    // Get assignees
    const assignees = (task.responsibleIds || []).length
      ? await getUserNames(task.responsibleIds)
      : ['(Unassigned)'];

    // Get Technology from custom fields
    let technology = '(None)';
    if (Array.isArray(task.customFields)) {
      const techField = task.customFields.find(
        field => field.name === TECHNOLOGY_FIELD_NAME || field.id === TECHNOLOGY_FIELD_NAME
      );
      if (techField?.value) {
        technology = techField.value;
      }
    }

    const message = `🎫 **Wrike ${eventType}**  

- 🆔 **Type**: Task  
- 📝 **Name**: ${task.title || 'Untitled'}  
- 🔺 **Priority**: ${priority}  
- 👤 **Assignees**: ${assignees.join(', ')}  
- 🧪 **Technology**: ${technology}  
- 🔗 [Open in Wrike](https://www.wrike.com/open.htm?id=${task.id})`;

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

    console.log(`✅ Sent task to Webex room ${roomId}`);
    res.sendStatus(200);
  } catch (err) {
    console.error('❌ Error handling event:', err.response?.data || err.message);
    res.sendStatus(500);
  }
});

// Helper to fetch user names
async function getUserNames(userIds) {
  try {
    const res = await axios.get(`https://www.wrike.com/api/v4/contacts`, {
      headers: { Authorization: `Bearer ${WRIKE_TOKEN}` },
      params: { id: userIds.join(',') }
    });
    return res.data.data.map(user => user.firstName + ' ' + user.lastName);
  } catch (err) {
    console.warn('⚠️ Failed to fetch user names:', err.response?.data || err.message);
    return ['(Lookup failed)'];
  }
}

app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
