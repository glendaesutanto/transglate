const line = require("@line/bot-sdk");
const express = require("express");
const axios = require("axios");
const dotenv = require("dotenv");

const env = dotenv.config().parsed;
const app = express();
const mongoose = require("mongoose");

mongoose.connect(env.MONGODB_URL, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});
const db = mongoose.connection;
db.on("error", console.error.bind(console, "connection error:"));
db.once("open", function () {
  console.log("Connected to MongoDB database");
});

const Language = require("./model/language");
const User = require("./model/user");

const lineConfig = {
  channelAccessToken:
    env.NODE_ENV === "dev"
      ? env.CHANNEL_ACCESS_TOKEN_DEV
      : env.CHANNEL_ACCESS_TOKEN_PROD,
  channelSecret:
    env.NODE_ENV === "dev" ? env.CHANNEL_SECRET_DEV : env.CHANNEL_SECRET_PROD,
};

const client = new line.Client(lineConfig);

const appendRapidAPIHeaders = () => {
  return {
    "X-RapidAPI-Host": env.GOOGLE_TRANSLATE_RAPID_API_HOST,
    "X-RapidAPI-Key": env.GOOGLE_TRANSLATE_RAPID_API_KEY,
  };
};

const getUserProfile = async (userId) => {
  const userProfile = await client.getProfile(userId);
  return userProfile;
};

const createOrUpdateLanguage = async (languageData, target) => {
  const existingLanguage = await Language.findOne({
    language: languageData.language,
  });
  if (!existingLanguage) {
    const newLanguage = new Language({
      language: languageData.language,
      name: [
        {
          code: target,
          name: languageData.name,
        },
      ],
    });
    await newLanguage.save();
  } else {
    const existingLanguageName = existingLanguage.name.find(
      (item) => item.code === target
    );
    if (!existingLanguageName) {
      existingLanguage.name.push({
        code: target,
        name: languageData.name,
      });
    } else {
      existingLanguageName.name = languageData.name;
    }
    await existingLanguage.save();
  }
};

app.get("/save-available-languages", async (req, res) => {
  const { target } = req.query;
  const { data } = await axios.get(
    `${env.GOOGLE_TRANSLATE_RAPID_API_URL}/languages?target=${target}`,
    {
      headers: {
        ...appendRapidAPIHeaders(),
        "content-type": "application/x-www-form-urlencoded",
        "accept-encoding": "application/gzip",
      },
    }
  );
  const allLanguages = data.data.languages;
  console.log("allLanguages:", allLanguages);
  for (const languageData of allLanguages) {
    await createOrUpdateLanguage(languageData, target);
  }
  return res.status(200).send("OK");
});

app.post("/webhook", line.middleware(lineConfig), async (req, res) => {
  try {
    const events = req.body.events;
    console.log("events=>>>>", events);
    return events.length > 0
      ? await events.map((item) => handleEvent(item))
      : res.status(200).send("OK");
  } catch (err) {
    res.status(500).send();
  }
});

const createUserIfNotExist = async (userId) => {
  const user = await User.findOne({ userId: userId });
  if (!user) {
    const userProfile = await getUserProfile(userId);
    const newUser = new User({
      userId: userId,
      displayName: userProfile.displayName,
      pictureUrl: userProfile.pictureUrl,
      statusMessage: userProfile.statusMessage,
    });
    await newUser.save();
    return newUser;
  }
  return user;
};

const detectLanguage = async (text) => {
  const encodedParams = new URLSearchParams();
  encodedParams.set("q", text);
  const { data } = await axios.post(
    `${env.GOOGLE_TRANSLATE_RAPID_API_URL}/detect`,
    encodedParams,
    {
      headers: {
        ...appendRapidAPIHeaders(),
        "content-type": "application/x-www-form-urlencoded",
        "accept-encoding": "application/gzip",
      },
    }
  );
  const detectedLanguage = data.data.detections[0][0].language;
  const detectedLanguageCode = "en";
  const detectedLanguageData = await Language.findOne({
    "name.code": detectedLanguageCode,
    language: detectedLanguage,
  });
  if (!detectedLanguageData) {
    return null;
  }
  const detectedLanguageName = detectedLanguageData.name.find(
    (item) => item.code === detectedLanguageCode
  );
  if (detectedLanguageName && detectedLanguageName.name) {
    return detectedLanguageName.name;
  }
  return null;
};

const translateText = async (text, from, to) => {
  const encodedParams = new URLSearchParams();
  encodedParams.set("q", text);
  encodedParams.set("target", to);
  encodedParams.set("source", from);
  const { data } = await axios.post(
    `${env.GOOGLE_TRANSLATE_RAPID_API_URL}`,
    encodedParams,
    {
      headers: {
        ...appendRapidAPIHeaders(),
        "content-type": "application/x-www-form-urlencoded",
        "accept-encoding": "application/gzip",
      },
    }
  );
  const translatedText = data.data.translations[0].translatedText;
  return translatedText;
};

const sendMessage = async (replyToken, message) => {
  return client.replyMessage(replyToken, {
    type: "text",
    text: message,
  });
};

const handleFollow = async (event) => {
  const user = await createUserIfNotExist(event.source.userId);
  return sendMessage(
    event.replyToken,
    `Once again, welcome ${user.displayName}!`
  );
};

const handleMessage = async (event) => {
  const message = event.message.text;
  const command = message.split(" ")[0];
  console.log("message:", message);
  console.log("command:", command);
  let replyMessage = "";
  let user = null;
  switch (command) {
    case "/commands":
      replyMessage = `Available commands:
      /commands - Show available commands
      /languages - Show available languages
      /set-from-language [language-code] - Set from language (language code can be seen from /languages)
      /set-to-language [language-code] - Set to language (language code can be seen from /languages)
      /translate - Translate text
      /help - Show help`;
      break;
    case "/languages":
      const allLanguages = await Language.find({});
      const languages = allLanguages.map((item, index) => {
        const languageName = item.name.find(
          (nameItem) => nameItem.code === "en"
        );
        return `${index + 1}. ${item.language} - ${languageName.name}`;
      });
      replyMessage = `Available languages:\n
        ${languages.join("\n")}`;
      break;
    case "/set-from-language":
      const fromLanguageCode = message.split(" ")[1];
      const fromLanguageData = await Language.findOne({
        language: fromLanguageCode,
      });
      if (!fromLanguageData) {
        return sendMessage(event.replyToken, `Unknown language`);
      }
      const fromLanguageName = fromLanguageData.name.find(
        (item) => item.code === "en"
      );
      user = await createUserIfNotExist(event.source.userId);
      user.fromLanguage = fromLanguageCode;
      await user.save();
      replyMessage = `Your "from" language has been set to ${fromLanguageName.name}`;
      break;
    case "/set-to-language":
      const toLanguageCode = message.split(" ")[1];
      const toLanguageData = await Language.findOne({
        language: toLanguageCode,
      });
      if (!toLanguageData) {
        return sendMessage(event.replyToken, `Unknown language`);
      }
      const toLanguageName = toLanguageData.name.find(
        (item) => item.code === "en"
      );
      user = await createUserIfNotExist(event.source.userId);
      user.toLanguage = toLanguageCode;
      await user.save();
      replyMessage = `Your "to" language has been set to ${toLanguageName.name}`;
      break;
    case "/translate":
      user = await createUserIfNotExist(event.source.userId);
      const text = message.split(" ").slice(1).join(" ");
      const translatedText = await translateText(
        text,
        user.fromLanguage,
        user.toLanguage
      );
      replyMessage = translatedText;
      break;
    case "/help":
      replyMessage = `Hi, I'm a translator bot. You can use me to translate text. Type /commands to see available commands`;
      break;
    default:
      replyMessage = `Unknown command`;
      break;
  }
  console.log("replyMessage:", replyMessage);
  return sendMessage(event.replyToken, replyMessage);
};

const handleEvent = async (event) => {
  switch (event.type) {
    case "follow":
      return handleFollow(event);
    case "message":
      return handleMessage(event);
    default:
      return handleUnknown(event);
  }
};

app.listen(4000, () => {
  console.log("listening on 4000");
});

module.exports = app;
