const fs = require("fs");
const path = require("path");

fs.rmSync(path.join(__dirname, "..", "reports"), { recursive: true, force: true });
console.log("reports/ limpo");
