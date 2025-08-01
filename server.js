require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");

const app = express();
const PORT = process.env.PORT || 3000;

const ALLOWED_CHANNEL_ID = "C08DT4RE96K"; // Your allowed channel

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// ✅ Fix for "missing_charset" warning
app.use((req, res, next) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  next();
});

const reasonOptions = [
  { text: { type: "plain_text", text: "Operational Issues" }, value: "operational_issues" },
  { text: { type: "plain_text", text: "Contract Expired" }, value: "contract_expired" },
  { text: { type: "plain_text", text: "Store Physically Closed" }, value: "store_physically_closed" },
  { text: { type: "plain_text", text: "Logistical Decision" }, value: "logistical_decision" },
  { text: { type: "plain_text", text: "Finance Concerns" }, value: "finance_concerns" },
  { text: { type: "plain_text", text: "Public Holiday" }, value: "public_holiday" },
];

// Slash Command → Modal
app.post("/slack/command", async (req, res) => {
  const { trigger_id, command, channel_id } = req.body;

  if (channel_id !== ALLOWED_CHANNEL_ID) {
    return res.json({
      response_type: "ephemeral",
      text: "❌ This command can only be used in the allowed channel.",
    });
  }

  const callbackId = command === "/temporaryclosure" ? "temp_closure" : "perm_closure";

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

  if (callbackId === "temp_closure") {
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
      callback_id: callbackId,
      title: {
        type: "plain_text",
        text: callbackId === "temp_closure" ? "Temporary Closure" : "Permanent Closure",
      },
      blocks,
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

// Interactions: Modal Submit + Button Click
app.post("/slack/interactions", async (req, res) => {
  const payload = JSON.parse(req.body.payload);
  const userId = payload.user.id;
  const todaysDate = new Date().toISOString().slice(0, 10);

  // ✅ Handle button clicks
  if (payload.type === "block_actions") {
    const action = payload.actions[0];

    if (["reopen_delivery_slot", "reopen_retailer"].includes(action.action_id)) {
      const actionId = action.action_id;
      const buttonText = action.text?.text?.toLowerCase().trim();

      if (buttonText === "submitted") {
        console.log("⚠️ Button already submitted. Ignoring further clicks.");
        return res.status(200).send();
      }

      const originalChannel = payload.channel.id;
      const originalTs = payload.message.ts;
      const taskRef = action.value || "N/A";

      // Get user info
      let userEmail = "Unavailable";
      try {
        const userInfo = await axios.get("https://slack.com/api/users.info", {
          headers: { Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}` },
          params: { user: userId },
        });
        userEmail = userInfo.data?.user?.profile?.email || "Unavailable";
      } catch (err) {
        console.error("Error fetching user info:", err.response?.data || err.message);
      }

      let statusText = "";
      if (actionId === "reopen_delivery_slot") {
        statusText = `✅ *Delivery Slot Reopened*\n• ID: ${taskRef}\n• By: <@${userId}> (${userEmail})\n• Date: ${todaysDate}`;
      } else if (actionId === "reopen_retailer") {
        statusText = `✅ *Retailer Reopened*\n• ID: ${taskRef}\n• By: <@${userId}> (${userEmail})\n• Date: ${todaysDate}`;
      }

      // Send summary message to channel
      try {
        await axios.post("https://slack.com/api/chat.postMessage", {
          channel: ALLOWED_CHANNEL_ID,
          text: statusText,
        }, {
          headers: { Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}` },
        });
      } catch (err) {
        console.error("Error posting summary message:", err.response?.data || err.message);
      }

      // Update the original button
      const updatedBlocks = payload.message.blocks.map(block => {
        if (block.type === "actions") {
          return {
            ...block,
            elements: block.elements.map(el => {
              if (el.type === "button" && el.action_id === actionId) {
                return {
                  ...el,
                  text: { type: "plain_text", text: "Submitted" },
                  style: "primary",
                };
              }
              return el;
            }),
          };
        }
        return block;
      });

      try {
        const updateResponse = await axios.post("https://slack.com/api/chat.update", {
          channel: originalChannel,
          ts: originalTs,
          blocks: updatedBlocks,
          text: `✅ ${actionId === "reopen_retailer" ? "Retailer" : "Delivery Slot"} ${taskRef} marked as active.`,
        }, {
          headers: { Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}` },
        });
        console.log("✅ Button updated:", updateResponse.data);
      } catch (err) {
        console.error("Error updating message:", err.response?.data || err.message);
      }

      return res.status(200).send();
    }
  }

  // ✅ Handle Modal Submission
  if (payload.type === "view_submission") {
    const state = payload.view.state.values;
    const callbackId = payload.view.callback_id;
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
    const reopeningDate = callbackId === "temp_closure"
      ? state.reopening_date_input.reopening_date.selected_date
      : null;

    let userEmail = "Unavailable";
    try {
      const userInfo = await axios.get("https://slack.com/api/users.info", {
        headers: { Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}` },
        params: { user: userId },
      });
      userEmail = userInfo.data?.user?.profile?.email || "Unavailable";
    } catch (err) {
      console.error("Error fetching user info:", err.response?.data || err.message);
    }

    let text = `*${callbackId === "temp_closure" ? "Temporary" : "Permanent"} Closure Request*`;
    text += `\n• Store ID: ${storeId}`;
    text += `\n• Closure Reason: ${closureReason}`;
    if (reopeningDate) text += `\n• Store Reopening Date: ${reopeningDate}`;
    text += `\n• Request Date: ${todaysDate}`;
    text += `\n• Requested By: <@${userId}> (${userEmail})`;

    try {
      await axios.post("https://slack.com/api/chat.postMessage", {
        channel: ALLOWED_CHANNEL_ID,
        text: text,
      }, {
        headers: { Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}` },
      });
    } catch (err) {
      console.error("Error posting modal message:", err.response?.data || err.message);
    }

    res.status(200).send();
  }
});

app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
