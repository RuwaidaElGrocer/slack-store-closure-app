require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");

const app = express();
const PORT = process.env.PORT || 3000;

// Hardcoded Allowed Channel ID – replace with your actual channel ID
const ALLOWED_CHANNEL_ID = "C08DT4RE96K";

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// Dropdown options for "Closure Reason"
const reasonOptions = [
  {
    text: { type: "plain_text", text: "Operational Issues" },
    value: "operational_issues",
  },
  {
    text: { type: "plain_text", text: "Contract Expired" },
    value: "contract_expired",
  },
  {
    text: { type: "plain_text", text: "Store Physically Closed" },
    value: "store_physically_closed",
  },
  {
    text: { type: "plain_text", text: "Logistical Decision" },
    value: "logistical_decision",
  },
  {
    text: { type: "plain_text", text: "Finance Concerns" },
    value: "finance_concerns",
  },
  {
    text: { type: "plain_text", text: "Public Holiday" },
    value: "public_holiday",
  },
];

app.post("/slack/command", async (req, res) => {
  const { trigger_id, channel_id, command } = req.body;

  // Ensure the command comes from the allowed channel
  if (channel_id !== ALLOWED_CHANNEL_ID) {
    return res.json({
      response_type: "ephemeral",
      text: "❌ This command is only allowed in a specific channel.",
    });
  }

  let modalView;

  if (command === "/temporaryclosure") {
    modalView = {
      trigger_id,
      private_metadata: channel_id, // Pass channel ID for later use in submission
      view: {
        type: "modal",
        callback_id: "temp_closure",
        title: { type: "plain_text", text: "Temporary Closure" },
        blocks: [
          {
            type: "input",
            block_id: "store_id_input",
            element: {
              type: "plain_text_input",
              action_id: "store_id",
              placeholder: { type: "plain_text", text: "Enter store ID as a number" },
            },
            label: { type: "plain_text", text: "Store ID:" },
          },
          {
            type: "input",
            block_id: "reason_input",
            element: {
              type: "static_select",
              action_id: "closure_reason",
              placeholder: { type: "plain_text", text: "Select a closure reason" },
              options: reasonOptions,
            },
            label: { type: "plain_text", text: "Closure Reason:" },
          },
          {
            type: "input",
            block_id: "reopening_date_input",
            element: {
              type: "datepicker",
              action_id: "reopening_date",
              placeholder: { type: "plain_text", text: "Select reopening date" },
            },
            label: { type: "plain_text", text: "Store Reopening Date:" },
          },
        ],
        submit: { type: "plain_text", text: "Submit" },
      },
    };
  } else if (command === "/permanentclosure") {
    modalView = {
      trigger_id,
      private_metadata: channel_id,
      view: {
        type: "modal",
        callback_id: "perm_closure",
        title: { type: "plain_text", text: "Permanent Closure" },
        blocks: [
          {
            type: "input",
            block_id: "store_id_input",
            element: {
              type: "plain_text_input",
              action_id: "store_id",
              placeholder: { type: "plain_text", text: "Enter store ID as a number" },
            },
            label: { type: "plain_text", text: "Store ID:" },
          },
          {
            type: "input",
            block_id: "reason_input",
            element: {
              type: "static_select",
              action_id: "closure_reason",
              placeholder: { type: "plain_text", text: "Select a closure reason" },
              options: reasonOptions,
            },
            label: { type: "plain_text", text: "Closure Reason:" },
          },
        ],
        submit: { type: "plain_text", text: "Submit" },
      },
    };
  } else {
    return res.status(400).json({
      response_type: "ephemeral",
      text: "Unknown command.",
    });
  }

  try {
    await axios.post("https://slack.com/api/views.open", modalView, {
      headers: { Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}` },
    });
    res.status(200).send();
  } catch (error) {
    console.error(
      "Error opening modal:",
      error.response ? error.response.data : error.message
    );
    res.status(500).send("Error opening modal");
  }
});

app.post("/slack/interactions", async (req, res) => {
  const payload = JSON.parse(req.body.payload);
  let responseText = "";

  // Retrieve the channel ID from private_metadata
  const channel = payload.view.private_metadata;
  // Get today's date (YYYY-MM-DD)
  const todaysDate = new Date().toISOString().slice(0, 10);
  // Get the user ID who submitted the modal
  const userId = payload.user.id;
  let userEmail = "";

  // Fetch the user's email using Slack's users.info API
  try {
    const userInfoResponse = await axios.get("https://slack.com/api/users.info", {
      params: { user: userId },
      headers: { Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}` },
    });
    if (userInfoResponse.data.ok) {
      userEmail = userInfoResponse.data.user.profile.email;
    }
  } catch (error) {
    console.error("Error fetching user info:", error.response ? error.response.data : error.message);
  }

  if (payload.type === "view_submission") {
    if (payload.view.callback_id === "temp_closure") {
      const storeId = payload.view.state.values.store_id_input.store_id.value;
      // Validate that store ID is numeric
      if (!/^\d+$/.test(storeId)) {
        return res.json({
          response_action: "errors",
          errors: {
            store_id_input: "Store ID must be a number.",
          },
        });
      }
      // Extract selected closure reason from the dropdown
      const closureReason = payload.view.state.values.reason_input.closure_reason.selected_option.value;
      // Extract the store reopening date from the datepicker
      const reopeningDate = payload.view.state.values.reopening_date_input.reopening_date.selected_date;
      responseText = `*Temporary Closure Request*\n• Store ID: ${storeId}\n• Closure Reason: ${closureReason}\n• Store Reopening Date: ${reopeningDate}\n• Closure Requested On: ${todaysDate}\n• Requested By: ${userEmail}`;
    } else if (payload.view.callback_id === "perm_closure") {
      const storeId = payload.view.state.values.store_id_input.store_id.value;
      if (!/^\d+$/.test(storeId)) {
        return res.json({
          response_action: "errors",
          errors: {
            store_id_input: "Store ID must be a number.",
          },
        });
      }
      const closureReason = payload.view.state.values.reason_input.closure_reason.selected_option.value;
      responseText = `*Permanent Closure Request*\n• Store ID: ${storeId}\n• Closure Reason: ${closureReason}\n• Closure Requested On: ${todaysDate}\n• Requested By: ${userEmail}`;
    }

    // Post the message back to the same channel the slash command was received
    try {
      await axios.post("https://slack.com/api/chat.postMessage", {
        channel: channel,
        text: responseText,
      }, {
        headers: { Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}` },
      });
    } catch (error) {
      console.error("Error posting message:", error.response ? error.response.data : error.message);
    }

    res.status(200).send();
  }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
