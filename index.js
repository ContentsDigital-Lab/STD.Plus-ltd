const express = require('express');
const app = express();
const PORT = 3000;

// A simple "Route"
app.get('/', (req, res) => {
    res.send('Hello World! Your Express server is running.');
});

// Start the server
app.listen(PORT, () => {
    console.log(`Server is vibrating on http://localhost:${PORT}`);
});