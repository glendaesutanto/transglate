const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  userId: String,
  displayName: {
    type: String,
    default: "Anonymous",
  },
  language: {
    type: String,
    default: "en",
  },
  fromLanguage: {
    type: String,
    default: "en",
  },
  toLanguage: {
    type: [String],
    default: ["id", "en"],
  },
  pictureUrl: {
    type: String,
    default: "",
  },
  statusMessage: {
    type: String,
    default: "",
  },
});

const User = mongoose.model("User", userSchema);

module.exports = User;
