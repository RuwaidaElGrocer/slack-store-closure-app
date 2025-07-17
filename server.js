require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");

const app = express();
const PORT = process.env.PORT || 3000;

// Replace with your Slack channel ID
const ALLOWED_CHANNEL_ID = "C12345678";

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// Dropdown options for closure reasons
const reasonOptions = [
  { text: { type: "plain_text", text: "Operational Issues" }, value: "operational_issues" },
  { text: { type: "plain_text", text: "Contract Expired" }, value: "contract_expired" },
  { text: { type: "plain_text", text: "Store Physically Closed" }, value: "store_physically_closed" },
  { text: { type: "plain_text", text: "Logistical Decision" }, value: "logistical_decision" },
  { text: { type: "plain_text", text: "Finance Concerns" }, value: "finance_concerns" },
  { text: { type: "plain_text", text: "Public Holiday" }, value: "public_holiday" },
];

// Handle slash commands
app.post("/slack/command", async (req, res) => {
  const { trigger_id, command, channel_id } = req.body;

  if (channel_id !== ALLOWED_CHANNEL_ID) {
    return res.json({
      response_type: "ephemeral",
      text: "❌ This command can only be used in the allowed channel.",
    });
  }

  let modalView = {
    trigger_id,
    view: {
      type: "modal",
      callback_id: command === "/temporaryclosure" ? "temp_closure" : "perm_closure",
      title: { type: "plain_text", text: command === "/temporaryclosure" ? "Temporary Closure" : "Permanent Closure" },
      blocks: [
        {
          type: "input",
          block_id: "store_id_input",
          element: {
            type: "plain_text_input",
            action_id: "store_id",
            placeholder: { type: "plain_text", text: "Enter store ID" },
          },
          label: { type: "plain_text", text: "Store ID:" },
        },
        {
          type: "input",
          block_id: "reason_input",
          element: {
            type: "static_select",
            action_id: "closure_reason",
            placeholder: { type: "plain_text", text: "Select reason" },
            options: reasonOptions,
          },
          label: { type: "plain_text", text: "Closure Reason:" },
        },
      ],
      submit: { type: "plain_text", text: "Submit" },
    },
  };

  if (command === "/temporaryclosure") {
    modalView.view.blocks.push({
      type: "input",
      block_id: "reopening_date_input",
      element: {
        type: "datepicker",
        action_id: "reopening_date",
        placeholder: { type: "plain_text", text: "Select reopening date" },
      },
      label: { type: "plain_text", text: "Store Reopening Date:" },
    });
  }

  try {
    await axios.post("https://slack.com/api/views.open", modalView, {
      headers: { Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}` },
    });
    res.status(200).send();
  } catch (error) {
    console.error("Error opening modal:", error.response?.data || error.message);
    res.status(500).send("Failed to open modal");
  }
});

// Handle modal submission and button clicks
app.post("/slack/interactions", async (req, res) => {
  const payload = JSON.parse(req.body.payload);
  const userId = payload.user.id;
  const todaysDate = new Date().toISOString().slice(0, 10);

  // --- Handle buttons (from any channel)
  if (payload.type === "block_actions") {
    const action = payload.actions[0];
    const channel = payload.channel.id;

    try {
      await axios.post("https://slack.com/api/chat.postMessage", {
        channel: channel,
        text: `✅ Button "${action.text.text}" was clicked by <@${userId}> at ${todaysDate}`,
      }, {
        headers: { Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}` },
      });
      return res.status(200).send();
    } catch (error) {
      console.error("Error handling button click:", error.response?.data || error.message);
      return res.status(500).send();
    }
  }

  // --- Handle modal submissions
  if (payload.type === "view_submission") {
    const state = payload.view.state.values;
    const callbackId = payload.view.callback_id;
    const channel = ALLOWED_CHANNEL_ID;

    const storeId = state.store_id_input.store_id.value;
    if (!/^\d+$/.test(storeId)) {
      return res.json({
        response_action: "errors",
        errors: {
          store_id_input: "Store ID must be a number.",
        },
      });
    }

    const closureReason = state.reason_input.closure_reason.selected_option.value;

    // Fetch user email
    let userEmail = "Unavailable";
    try {
      const userInfo = await axios.get("https://slack.com/api/users.info", {
        headers: { Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}` },
        params: { user: userId },
      });
      userEmail = userInfo.data?.user?.profile?.email || "Unavailable";
    } catch (err) {
      console.error("Error fetching user email:", err.response?.data || err.message);
    }

    // Build message
    let text = `*${callbackId === "temp_closure" ? "Temporary" : "Permanent"} Closure Request*`;
    text += `\n• Store ID: ${storeId}`;
    text += `\n• Closure Reason: ${closureReason}`;
    if (callbackId === "temp_closure") {
      const reopeningDate = state.reopening_date_input.reopening_date.selected_date;
      text += `\n• Store Reopening Date: ${reopeningDate}`;
    }
    text += `\n• Request Date: ${todaysDate}`;
    text += `\n• Requested By: ${userEmail}`;

    // Post message
    try {
      await axios.post("https://slack.com/api/chat.postMessage", {
        channel: channel,
        text: text,
      }, {
        headers: { Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}` },
      });
    } catch (err) {
      console.error("Error posting message:", err.response?.data || err.message);
    }

    res.status(200).send();
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
