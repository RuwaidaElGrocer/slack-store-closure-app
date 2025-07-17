require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");

const app = express();
const PORT = process.env.PORT || 3000;

const ALLOWED_CHANNEL_ID = "C12345678"; // Replace with your actual channel ID

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// Closure reason options
const reasonOptions = [
  { text: { type: "plain_text", text: "Operational Issues" }, value: "operational_issues" },
  { text: { type: "plain_text", text: "Contract Expired" }, value: "contract_expired" },
  { text: { type: "plain_text", text: "Store Physically Closed" }, value: "store_physically_closed" },
  { text: { type: "plain_text", text: "Logistical Decision" }, value: "logistical_decision" },
  { text: { type: "plain_text", text: "Finance Concerns" }, value: "finance_concerns" },
  { text: { type: "plain_text", text: "Public Holiday" }, value: "public_holiday" },
];

// Handle slash command
app.post("/slack/command", async (req, res) => {
  const { trigger_id, command, channel_id } = req.body;

  if (channel_id !== ALLOWED_CHANNEL_ID) {
    return res.json({
      response_type: "ephemeral",
      text: "❌ This command can only be used in the allowed channel.",
    });
  }

  const callback_id = command === "/temporaryclosure" ? "temp_closure" : "perm_closure";

  const blocks = [
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
  ];

  if (callback_id === "temp_closure") {
    blocks.push({
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

  const modalView = {
    trigger_id,
    view: {
      type: "modal",
      callback_id: callback_id,
      title: { type: "plain_text", text: callback_id === "temp_closure" ? "Temporary Closure" : "Permanent Closure" },
      blocks: blocks,
      submit: { type: "plain_text", text: "Submit" },
    },
  };

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

// Handle modals + button clicks
app.post("/slack/interactions", async (req, res) => {
  const payload = JSON.parse(req.body.payload);
  const userId = payload.user.id;
  const todaysDate = new Date().toISOString().slice(0, 10);

  // 1. Handle Button Clicks (Allow from any channel)
  if (payload.type === "block_actions") {
    const action = payload.actions[0];
    const taskRef = action.value || "store_1234"; // Use button value as task reference
    const channel = ALLOWED_CHANNEL_ID;

    let userEmail = "Unavailable";
    let userName = `<@${userId}>`;

    try {
      const userInfo = await axios.get("https://slack.com/api/users.info", {
        headers: { Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}` },
        params: { user: userId },
      });

      const profile = userInfo.data?.user?.profile;
      userEmail = profile?.email || "Unavailable";
      userName = `<@${userId}> (${userEmail})`;
    } catch (err) {
      console.error("Error fetching user for button click:", err.response?.data || err.message);
    }

    const message = `:white_check_mark: *Task Completed*\n• Task Ref: ${taskRef}\n• Submitted by: ${userName}\n• Date: ${todaysDate}`;

    try {
      await axios.post("https://slack.com/api/chat.postMessage", {
        channel,
        text: message,
      }, {
        headers: { Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}` },
      });
      return res.status(200).send();
    } catch (error) {
      console.error("Error posting button message:", error.response?.data || error.message);
      return res.status(500).send();
    }
  }

  // 2. Handle Modal Submissions
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

    let reopeningDate = "";
    if (callbackId === "temp_closure") {
      reopeningDate = state.reopening_date_input.reopening_date.selected_date;
    }

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

    let text = `*${callbackId === "temp_closure" ? "Temporary" : "Permanent"} Closure Request*`;
    text += `\n• Store ID: ${storeId}`;
    text += `\n• Closure Reason: ${closureReason}`;
    if (reopeningDate) text += `\n• Store Reopening Date: ${reopeningDate}`;
    text += `\n• Request Date: ${todaysDate}`;
    text += `\n• Requested By: <@${userId}> (${userEmail})`;

    try {
      await axios.post("https://slack.com/api/chat.postMessage", {
        channel,
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

app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
