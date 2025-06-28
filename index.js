const express = require('express');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 3000;

const BOT_TOKEN = process.env.BOT_TOKEN;
const WRIKE_TOKEN = process.env.WRIKE_TOKEN;
const MAPPING_ENV = process.env.FOLDER_TO_ROOM_MAP || '';

// Static custom field IDs will be replaced by dynamic lookup
let customFieldsMap = {};
let statusIdMap = {};

// Parse FOLDER_TO_ROOM_MAP
const folderToRoomMap = MAPPING_ENV.split(',')
  .map(pair => pair.trim().split(':'))
  .filter(pair => pair.length === 2)
  .reduce((map, [folderId, roomId]) => {
    map[folderId] = roomId;
    return map;
  }, {});

app.use(express.json());

app.listen(PORT, async () => {
  console.log(`✅ Server running on port ${PORT}`);
  await loadCustomFields();
  await loadWorkflowStatuses();
  console.log('✅ Ready for Webhook events.');
});

// Load all custom fields and cache name → ID
async function loadCustomFields() {
  try {
    const res = await axios.get('https://www.wrike.com/api/v4/customfields', {
      headers: { Authorization: `Bearer ${WRIKE_TOKEN}` },
    });
    res.data.data.forEach(field => {
      customFieldsMap[field.id] = field.title;
    });
    console.log('✅ Custom field map loaded.');
  } catch (err) {
    console.error('❌ Failed to load custom fields:', err.response?.data || err.message);
  }
}

// Load workflow statuses and cache ID → Name
async function loadWorkflowStatuses() {
  try {
    const res = await axios.get('https://www.wrike.com/api/v4/workflows', {
      headers: { Authorization: `Bearer ${WRIKE_TOKEN}` },
    });
    res.data.data.forEach(workflow => {
      workflow.customStatuses.forEach(status => {
        statusIdMap[status.id] = status.name;
      });
    });
    console.log('✅ Workflow status map loaded.');
  } catch (err) {
    console.error('❌ Failed to load workflow statuses:', err.response?.data || err.message);
  }
}

// Webhook handler
app.post('/wrike-webhook', async (req, res) => {
  const token = req.headers['x-request-token'];
  if (token) return res.status(200).send(token); // Verification

  const events = req.body;
  if (!Array.isArray(events) || events.length === 0) return res.sendStatus(400);

  const event = events[0];
  const taskId = event.taskId;

  try {
    const taskRes = await axios.get(`https://www.wrike.com/api/v4/tasks/${taskId}`, {
      headers: { Authorization: `Bearer ${WRIKE_TOKEN}` },
    });

    const task = taskRes.data.data[0];
    const folderIds = task.parentIds || [];

    // Match room ID
    let roomId = null;
    for (const folderId of folderIds) {
      if (folderToRoomMap[folderId]) {
        roomId = folderToRoomMap[folderId];
        break;
      }
    }
    if (!roomId) return res.sendStatus(204); // No mapped room

    // Priority and Technology
    let priority = '(None)', technology = '(None)';
    const priorityMap = {
      High: '🔴 High',
      Medium: '🟡 Medium',
      Low: '🟢 Low',
    };

    for (const field of task.customFields || []) {
      const label = customFieldsMap[field.id];
      if (label === 'Priority') {
        priority = priorityMap[field.value] || field.value;
      } else if (label === 'Technology') {
        technology = field.value;
      }
    }

    // Item type from metadata
    let itemType = 'Task';
    if (Array.isArray(task.metadata)) {
      const typeMeta = task.metadata.find(m => m.key === 'Item type');
      if (typeMeta?.value) itemType = typeMeta.value;
    }

    // Status from custom workflow
    const statusName = statusIdMap[task.customStatusId] || task.status;

    // Assignees
    const assignees = (task.responsibleIds || []).length
      ? await getUserNames(task.responsibleIds)
      : ['(Unassigned)'];

    // Format message
    const message = `📌 **${itemType} - ${event.eventType}**

- 📝 **Name**: ${task.title || 'Untitled'}  
- 🔄 **Status**: ${statusName}  
- 🔺 **Priority**: ${priority}  
- 👤 **Assignees**: ${assignees.join(', ')}  
- 🧪 **Technology**: ${technology}  
- 🔗 [Open in Wrike](${task.permalink})`;

    // Send to Webex
    await axios.post(
      'https://webexapis.com/v1/messages',
      {
        roomId,
        markdown: message,
      },
      {
        headers: { Authorization: `Bearer ${BOT_TOKEN}` },
      }
    );

    console.log(`✅ Sent to Webex → ${itemType}: "${task.title}"`);
    res.sendStatus(200);
  } catch (err) {
    console.error('❌ Task error:', err.response?.data || err.message);
    res.sendStatus(500);
  }
});

// Helper: Get user full names
async function getUserNames(userIds) {
  try {
    const res = await axios.get(`https://www.wrike.com/api/v4/contacts/${userIds.join(',')}`, {
      headers: { Authorization: `Bearer ${WRIKE_TOKEN}` },
    });
    return res.data.data.map(user => `${user.firstName} ${user.lastName}`);
  } catch (err) {
    console.warn('⚠️ Cannot fetch user names:', err.response?.data || err.message);
    return ['(Lookup failed)'];
  }
}
