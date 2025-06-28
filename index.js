const express = require('express');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 3000;

const BOT_TOKEN = process.env.BOT_TOKEN;
const WRIKE_TOKEN = process.env.WRIKE_TOKEN;

// Custom field IDs from environment variables
const PRIORITY_FIELD_ID = process.env.PRIORITY_FIELD_ID || '';
const TECHNOLOGY_FIELD_ID = process.env.TECHNOLOGY_FIELD_ID || '';
const TYPE_FIELD_ID = process.env.TYPE_FIELD_ID || '';

// Folder to Webex room map: "folderId:webexRoomId,folderId2:webexRoomId2"
const folderToRoomMap = (process.env.FOLDER_TO_ROOM_MAP || '')
  .split(',')
  .map(p => p.trim().split(':'))
  .filter(p => p.length === 2)
  .reduce((acc, [folderId, roomId]) => {
    acc[folderId] = roomId;
    return acc;
  }, {});

app.use(express.json());

app.post('/wrike-webhook', async (req, res) => {
  // Wrike webhook verification handshake
  const token = req.headers['x-request-token'];
  if (token) {
    console.log('✅ Wrike verification token:', token);
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
    // Get full task info from Wrike
    const taskRes = await axios.get(`https://www.wrike.com/api/v4/tasks/${taskId}`, {
      headers: { Authorization: `Bearer ${WRIKE_TOKEN}` }
    });
    const task = taskRes.data.data[0];

    // Find Webex room mapped to one of the task's parent folders
    const parentIds = task.parentIds || [];
    let roomId = null;
    for (const pid of parentIds) {
      if (folderToRoomMap[pid]) {
        roomId = folderToRoomMap[pid];
        break;
      }
    }
    if (!roomId) {
      console.warn(`⚠️ No Webex room mapped for task folders: ${parentIds.join(', ')}`);
      return res.sendStatus(204);
    }

    // Get workflow status name from customStatusId
    let statusName = task.status || '(No status)';
    if (task.customStatusId) {
      try {
        const wfRes = await axios.get(`https://www.wrike.com/api/v4/workflows/${task.customStatusId}`, {
          headers: { Authorization: `Bearer ${WRIKE_TOKEN}` }
        });
        statusName = wfRes.data.data[0]?.name || statusName;
      } catch {
        // fallback: keep original status
      }
    }

    // Extract Priority from custom fields
    let priority = '(None)';
    const priorityMap = { High: '🔴 High', Medium: '🟡 Medium', Low: '🟢 Low' };
    if (Array.isArray(task.customFields)) {
      const pf = task.customFields.find(f => f.id === PRIORITY_FIELD_ID);
      if (pf?.value) priority = priorityMap[pf.value] || pf.value;
    }

    // Extract Technology from custom fields
    let technology = '(None)';
    if (Array.isArray(task.customFields)) {
      const tf = task.customFields.find(f => f.id === TECHNOLOGY_FIELD_ID);
      if (tf?.value) technology = tf.value;
    }

    // Extract Type (custom field)
    let type = '(None)';
    if (Array.isArray(task.customFields)) {
      const typeField = task.customFields.find(f => f.id === TYPE_FIELD_ID);
      if (typeField?.value) type = typeField.value;
    }

    // Get assignee names from responsibleIds
    const assignees = (task.responsibleIds || []).length
      ? await getUserNames(task.responsibleIds)
      : ['(Unassigned)'];

    // Build message markdown with Type included
    const message =
      `📌 **${type}** - ${eventType}\n` +
      `• 📝 Name: ${task.title || '(No title)'}\n` +
      `• 🔄 Status: ${statusName}\n` +
      `• 🔺 Priority: ${priority}\n` +
      `• 👤 Assignees: ${assignees.join(', ')}\n` +
      `• 🧪 Technology: ${technology}\n` +
      `• 🔗 [Open in Wrike](${task.permalink || `https://www.wrike.com/open.htm?id=${task.id}`})`;

    // Send message to Webex room
    await axios.post(
      'https://webexapis.com/v1/messages',
      { roomId, markdown: message },
      { headers: { Authorization: `Bearer ${BOT_TOKEN}` } }
    );

    console.log(`✅ Sent message for task "${task.title}" to room ${roomId}`);
    res.sendStatus(200);
  } catch (err) {
    console.error('❌ Error processing webhook:', err.response?.data || err.message);
    res.sendStatus(500);
  }
});

// Helper: fetch user full names by user IDs
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
