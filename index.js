const express = require('express');
const axios = require('axios');
const app = express();

const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN;
const WRIKE_TOKEN = process.env.WRIKE_TOKEN;
const PRIORITY_FIELD_ID = process.env.PRIORITY_FIELD_ID;
const TECHNOLOGY_FIELD_ID = process.env.TECHNOLOGY_FIELD_ID;

const folderToRoomMap = (process.env.FOLDER_TO_ROOM_MAP || '')
  .split(',')
  .map(pair => pair.trim().split(':'))
  .filter(pair => pair.length === 2)
  .reduce((map, [folderId, roomId]) => {
    map[folderId] = roomId;
    return map;
  }, {});

app.use(express.json());

app.post('/wrike-webhook', async (req, res) => {
  // Handle verification challenge from Wrike
  if (req.headers['x-request-token']) {
    return res.status(200).send(req.headers['x-request-token']);
  }

  const events = req.body;
  if (!Array.isArray(events) || events.length === 0) {
    console.error('Invalid webhook payload', req.body);
    return res.sendStatus(400);
  }

  const event = events[0];
  const taskId = event.taskId;
  const eventType = event.eventType;

  if (!taskId) {
    console.error('No taskId in event', event);
    return res.sendStatus(400);
  }

  try {
    // Get full task info
    const taskRes = await axios.get(`https://www.wrike.com/api/v4/tasks/${taskId}`, {
      headers: { Authorization: `Bearer ${WRIKE_TOKEN}` }
    });

    const task = taskRes.data.data[0];

    // Find mapped Webex room based on any parent folder
    let roomId = null;
    (task.parentIds || []).some(folderId => {
      if (folderToRoomMap[folderId]) {
        roomId = folderToRoomMap[folderId];
        return true;
      }
      return false;
    });

    if (!roomId) {
      console.warn('No Webex room mapped for folders:', task.parentIds);
      return res.sendStatus(204); // No content, no message sent
    }

    // Resolve workflow status name
    let statusName = task.status || '(No status)';
    if (task.customStatusId) {
      try {
        const wfRes = await axios.get(`https://www.wrike.com/api/v4/workflows/${task.customStatusId}`, {
          headers: { Authorization: `Bearer ${WRIKE_TOKEN}` }
        });
        if (wfRes.data.data.length > 0) {
          statusName = wfRes.data.data[0].name || statusName;
        }
      } catch (err) {
        console.warn('Failed to fetch workflow status:', err.message);
      }
    }

    // Priority field mapping
    const priorityMap = { High: '🔴 High', Medium: '🟡 Medium', Low: '🟢 Low' };
    let priority = '(None)';
    if (Array.isArray(task.customFields)) {
      const p = task.customFields.find(f => f.id === PRIORITY_FIELD_ID);
      if (p?.value) priority = priorityMap[p.value] || p.value;
    }

    // Technology field
    let technology = '(None)';
    if (Array.isArray(task.customFields)) {
      const t = task.customFields.find(f => f.id === TECHNOLOGY_FIELD_ID);
      if (t?.value) technology = t.value;
    }

    // Assignees names
    const assignees = (task.responsibleIds && task.responsibleIds.length > 0)
      ? await getUserNames(task.responsibleIds)
      : ['(Unassigned)'];

    // Compose message
    const message =
      `📌 Task - ${eventType}\n` +
      `• 📝 Name: ${task.title || '(No title)'}\n` +
      `• 🔄 Status: ${statusName}\n` +
      `• 🔺 Priority: ${priority}\n` +
      `• 👤 Assignees: ${assignees.join(', ')}\n` +
      `• 🧪 Technology: ${technology}\n` +
      `• 🔗 [Open in Wrike](${task.permalink || `https://www.wrike.com/open.htm?id=${task.id}`})`;

    // Send message to Webex room
    await axios.post('https://webexapis.com/v1/messages', {
      roomId,
      markdown: message,
    }, {
      headers: { Authorization: `Bearer ${BOT_TOKEN}` }
    });

    console.log(`Message sent for task ${task.id} to room ${roomId}`);

    res.sendStatus(200);

  } catch (error) {
    console.error('Error handling webhook:', error.response?.data || error.message);
    res.sendStatus(500);
  }
});

async function getUserNames(userIds) {
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
  console.log(`Server listening on port ${PORT}`);
});
