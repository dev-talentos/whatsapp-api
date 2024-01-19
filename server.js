const app = require("./src/app");
require("dotenv").config();

// Start the server
const port = process.env.PORT || 3000;

// Check if BASE_WEBHOOK_URL environment variable is available

app.listen(port, () => {
	console.log(`Server running teste on port ${port}`);
});
