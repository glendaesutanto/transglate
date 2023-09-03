const mongoose = require("mongoose");

const nameSchema = new mongoose.Schema(
  {
    code: String,
    name: String,
  },
  { _id: false }
);

const languageSchema = new mongoose.Schema({
  language: String,
  name: [nameSchema],
});

const Language = mongoose.model("Language", languageSchema);

module.exports = Language;
