require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// Route for Slash Command
app.post("/slack/command", async (req, res) => {
  const { trigger_id } = req.body;

  const modalView = {
    trigger_id,
    view: {
      type: "modal",
      callback_id: "modal_submission",
      title: { type: "plain_text", text: "Modal Form" },
      blocks: [
        {
          type: "input",
          block_id: "input_block",
          element: { type: "plain_text_input", action_id: "user_input" },
          label: { type: "plain_text", text: "Enter something:" },
        },
      ],
      submit: { type: "plain_text", text: "Submit" },
    },
  };

  try {
    await axios.post("https://slack.com/api/views.open", modalView, {
      headers: { Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}` },
    });
    res.status(200).send();
  } catch (error) {
    console.error(error);
    res.status(500).send("Error opening modal");
  }
});

// Route for Modal Submission
app.post("/slack/interactions", async (req, res) => {
  const payload = JSON.parse(req.body.payload);
  
  if (payload.type === "view_submission") {
    const userInput = payload.view.state.values.input_block.user_input.value;
    
    await axios.post("https://slack.com/api/chat.postMessage", {
      channel: payload.user.id,
      text: `You submitted: ${userInput}`,
    }, {
      headers: { Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}` },
    });

    res.status(200).send();
  }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
