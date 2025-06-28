const express = require('express');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 3000;

const BOT_TOKEN = process.env.BOT_TOKEN;
const WRIKE_TOKEN = process.env.WRIKE_TOKEN;

// Example env vars format:
// FOLDER_TO_ROOM_MAP="IEAEOPF5I5SNLVWJ:roomId1,IEAEOPF5I5SNLYAB:roomId2"
// FOLDER_TO_ITEMTYPE_MAP="IEAEOPF5I5SNLVWJ:Incident,IEAEOPF5I5SNLYAB:Service Request"

// Custom field IDs for Priority & Technology
const PRIORITY_FIELD_ID = process.env.PRIORITY_FIELD_ID || 'IEAEOPF5JUAIUOUD'; // adjust
const TECHNOLOGY_FIELD_ID = process.env.TECHNOLOGY_FIELD_ID || 'IEAEOPF5JUAIUORM'; // adjust

// Parse folder-to-room map from env
const folderToRoomMap = (process.env.FOLDER_TO_ROOM_MAP || '')
  .split(',')
  .map(p => p.trim().split(':'))
  .filter(p => p.length === 2)
  .reduce((acc, [folderId, roomId]) => {
    acc[folderId] = roomId;
    return acc;
  }, {});

// Parse folder-to-itemType map from env
const folderToItemTypeMap = (process.env.FOLDER_TO_ITEMTYPE_MAP || '')
  .split(',')
  .map(p => p.trim().split(':'))
  .filter(p => p.length === 2)
  .reduce((acc, [folderId, itemType]) => {
    acc[folderId] = itemType;
    return acc;
  }, {});

app.use(express.json());

app.post('/wrike-webhook', async (req, res) => {
  const token = req.headers['x-request-token'];
  if (token) {
    console.log('✅ Wrike verification token received:', token);
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
    console.error('❌ Missing taskId in event:', event);
    return res.sendStatus(400);
  }

  try {
    // Get full task info
    const taskRes = await axios.get(`https://www.wrike.com/api/v4/tasks/${taskId}`, {
      headers: { Authorization: `Bearer ${WRIKE_TOKEN}` }
    });
    const task = taskRes.data.data[0];

    // Find roomId by mapping parent folder of task
    const parentIds = task.parentIds || [];
    let roomId = null;
    let itemType = 'Task'; // default item type

    for (const parentId of parentIds) {
      if (folderToRoomMap[parentId]) {
        roomId = folderToRoomMap[parentId];
      }
      if (folderToItemTypeMap[parentId]) {
        itemType = folderToItemTypeMap[parentId];
      }
      if (roomId && itemType !== 'Task') break; // got both
    }

    if (!roomId) {
      console.warn(`⚠️ No Webex room mapped for folders: ${parentIds.join(', ')}`);
      return res.sendStatus(204);
    }

    // Decode customStatusId to workflow status name
    let statusName = task.status || '(No status)';
    if (task.customStatusId) {
      try {
        const wfRes = await axios.get(`https://www.wrike.com/api/v4/workflows/${task.customStatusId}`, {
          headers: { Authorization: `Bearer ${WRIKE_TOKEN}` }
        });
        statusName = wfRes.data.data[0].name || statusName;
      } catch {
        // fallback to task.status if workflow lookup fails
      }
    }

    // Extract Priority custom field
    let priority = '(None)';
    const priorityMap = {
      High: '🔴 High',
      Medium: '🟡 Medium',
      Low: '🟢 Low'
    };
    if (Array.isArray(task.customFields)) {
      const pf = task.customFields.find(f => f.id === PRIORITY_FIELD_ID);
      if (pf?.value) {
        priority = priorityMap[pf.value] || pf.value;
      }
    }

    // Extract Technology custom field
    let technology = '(None)';
    if (Array.isArray(task.customFields)) {
      const tf = task.customFields.find(f => f.id === TECHNOLOGY_FIELD_ID);
      if (tf?.value) {
        technology = tf.value;
      }
    }

    // Get assignee names
    const assignees = (task.responsibleIds || []).length
      ? await getUserNames(task.responsibleIds)
      : ['(Unassigned)'];

    // Build message differently based on itemType
    let message = `📌 **${itemType}** - ${eventType}\n`;
    message += `\t• 📝 Name: ${task.title || '(No title)'}\n`;
    message += `\t• 🔄 Status: ${statusName}\n`;
    message += `\t• 🔺 Priority: ${priority}\n`;
    message += `\t• 👤 Assignees: ${assignees.join(', ')}\n`;
    message += `\t• 🧪 Technology: ${technology}\n`;

    // Additional fields depending on itemType, example:
    if (itemType.toLowerCase() === 'incident') {
      message += `\t• 🚨 Incident-specific info could go here\n`;
    } else if (itemType.toLowerCase() === 'service request') {
      message += `\t• 🛠️ Service Request-specific info could go here\n`;
    }

    message += `\t• 🔗 [Open in Wrike](${task.permalink || `https://www.wrike.com/open.htm?id=${task.id}`})`;

    // Send to Webex
    await axios.post('https://webexapis.com/v1/messages', {
      roomId,
      markdown: message
    }, {
      headers: { Authorization: `Bearer ${BOT_TOKEN}` }
    });

    console.log(`✅ Sent message for task "${task.title}" in room ${roomId}`);
    res.sendStatus(200);
  } catch (err) {
    console.error('❌ Error processing webhook:', err.response?.data || err.message);
    res.sendStatus(500);
  }
});

async function getUserNames(userIds) {
  if (!userIds.length) return ['(Unassigned)'];
  try {
    const res = await axios.get(`https://www.wrike.com/api/v4/contacts/${userIds.join(',')}`, {
      headers: { Authorization: `Bearer ${WRIKE_TOKEN}` }
    });
    return res.data.data.map(u => `${u.firstName} ${u.lastName}`);
  } catch {
    return ['(Lookup failed)'];
  }
}

app.listen(PORT, () => {
  console.log(`✅ Server listening on port ${PORT}`);
});
