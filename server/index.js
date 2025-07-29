const express = require("express");
const http = require("http");
const cors = require("cors");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

const server = http.createServer(app).listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

// Use Node.js __dirname directly
app.use(express.static(path.join(__dirname, "public")));
app.use(cors({ credentials: true, origin: "*" }));

module.exports = { server };
