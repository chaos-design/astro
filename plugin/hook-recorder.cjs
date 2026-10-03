const recorder = require("./trace-recorder.cjs");

if (require.main === module) {
  if (!process.argv.some((argument) => argument.startsWith("--source"))) {
    process.argv.push("--source=trae");
  }
  recorder.run();
}

module.exports = recorder;
