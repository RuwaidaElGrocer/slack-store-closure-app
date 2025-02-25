require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");

const app = express();
const PORT = process.env.PORT || 3000;

// Hardcoded Allowed Channel ID
const ALLOWED_CHANNEL_ID = "C08DT4RE96K"; // Replace with your actual channel ID

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// Handle Slash Command
app.post("/slack/command", async (req, res) => {
  const { trigger_id, channel_id, command } = req.body;

  // Check if the command is from the allowed channel
  if (channel_id !== ALLOWED_CHANNEL_ID) {
    return res.json({
      response_type: "ephemeral",
      text: "❌ This command is only allowed in a specific channel.",
    });
  }

  let modalView;

  // Build modal view based on which slash command was invoked
  if (command === "/temporaryclosure") {
    modalView = {
      trigger_id,
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
            block_id: "date_input",
            element: {
              type: "plain_text_input",
              action_id: "closure_date",
              placeholder: { type: "plain_text", text: "YYYY-MM-DD" },
            },
            label: { type: "plain_text", text: "Closure Date:" },
          },
          {
            type: "input",
            block_id: "reason_input",
            element: {
              type: "plain_text_input",
              action_id: "closure_reason",
              multiline: true,
            },
            label: { type: "plain_text", text: "Reason for Closure:" },
          },
        ],
        submit: { type: "plain_text", text: "Submit" },
      },
    };
  } else if (command === "/permanentclosure") {
    modalView = {
      trigger_id,
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
            block_id: "store_name_input",
            element: {
              type: "plain_text_input",
              action_id: "store_name",
            },
            label: { type: "plain_text", text: "Store Name:" },
          },
          {
            type: "input",
            block_id: "additional_info_input",
            element: {
              type: "plain_text_input",
              action_id: "additional_info",
              multiline: true,
            },
            label: { type: "plain_text", text: "Additional Info:" },
          },
        ],
        submit: { type: "plain_text", text: "Submit" },
      },
    };
  } else {
    // Unknown command case
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

// Handle Modal Submission
app.post("/slack/interactions", async (req, res) => {
  const payload = JSON.parse(req.body.payload);
  let responseText = "";

  if (payload.type === "view_submission") {
    if (payload.view.callback_id === "temp_closure") {
      const storeId = payload.view.state.values.store_id_input.store_id.value;
      const closureDate = payload.view.state.values.date_input.closure_date.value;
      const closureReason = payload.view.state.values.reason_input.closure_reason.value;
      responseText = `Temporary Closure for store ID ${storeId} on ${closureDate}\nReason: ${closureReason}`;
    } else if (payload.view.callback_id === "perm_closure") {
      const storeId = payload.view.state.values.store_id_input.store_id.value;
      const storeName = payload.view.state.values.store_name_input.store_name.value;
      const additionalInfo = payload.view.state.values.additional_info_input.additional_info.value;
      responseText = `Permanent Closure for store ID ${storeId} (${storeName})\nAdditional Info: ${additionalInfo}`;
    }

    // Post the message back to the channel (using payload.user.id here; adjust if needed)
    await axios.post(
      "https://slack.com/api/chat.postMessage",
      {
        channel: payload.user.id,
        text: responseText,
      },
      {
        headers: { Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}` },
      }
    );

    res.status(200).send();
  }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));