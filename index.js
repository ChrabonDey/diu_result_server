require('dotenv').config(); // Load environment variables from .env file

const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');

const app = express();
const port = process.env.PORT || 3001;

// Access token from environment variable
const accessToken = process.env.ACCESS_TOKEN;

if (!accessToken) {
  console.error('No access token found in environment variables.');
  process.exit(1); // Exit if no token is found
}

// Enable CORS for frontend access
app.use(cors());
app.use(express.json());  // To parse JSON bodies

// A simple in-memory cache to store results for 10 minutes
const cache = {};

// Fetch data with a timeout to avoid hanging the request
const fetchWithTimeout = async (url, options = {}, timeout = 5000) => {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(id);
    return res;
  } catch (err) {
    clearTimeout(id);
    throw err;
  }
};

// Endpoint to fetch data from the external API
app.get('/api/result', async (req, res) => {
  const { studentId, semesterId } = req.query;

  if (!studentId || !semesterId) {
    return res.status(400).json({ error: 'Missing studentId or semesterId' });
  }

  const cacheKey = `${studentId}_${semesterId}`;
  const isCached = cache[cacheKey] && Date.now() - cache[cacheKey].timestamp < 10 * 60 * 1000;

  // If the data is cached, return the cached data
  if (isCached) {
    console.log(`✅ Cache hit for ${cacheKey}`);
    return res.json(cache[cacheKey].data);
  }

  try {
    console.log(`🔄 Fetching data for ${cacheKey}...`);

    // Set the Authorization header using the accessToken from .env
    const headers = {
      'Authorization': `Bearer ${accessToken}`,  // Include the accessToken here
      'Content-Type': 'application/json'
    };

    // Fetch both student and result data with timeout and accessToken in headers
    const [studentRes, resultRes] = await Promise.all([
      fetchWithTimeout(`http://peoplepulse.diu.edu.bd:8189/result/studentInfo?studentId=${studentId}`, { headers }, 7000),
      fetchWithTimeout(`http://peoplepulse.diu.edu.bd:8189/result?grecaptcha=&semesterId=${semesterId}&studentId=${studentId}`, { headers }, 7000)
    ]);

    const studentText = await studentRes.text();
    const resultText = await resultRes.text();

    console.log(`📥 Student Status: ${studentRes.status}`);
    console.log(`📥 Result Status: ${resultRes.status}`);

    if (studentRes.status !== 200) {
      throw new Error(`Failed to fetch student data. Status: ${studentRes.status}`);
    }
    if (resultRes.status !== 200) {
      throw new Error(`Failed to fetch result data. Status: ${resultRes.status}`);
    }

    // Parse the response data if available
    const studentData = studentText ? JSON.parse(studentText) : {};
    const resultData = resultText ? JSON.parse(resultText) : [];

    if (!Array.isArray(resultData)) {
      throw new Error('Result data is not an array');
    }

    // Combine the student and result data
    const responseData = {
      studentInfo: studentData,
      result: resultData
    };

    // Cache the response data
    cache[cacheKey] = {
      data: responseData,
      timestamp: Date.now()
    };

    // Send the response to the client
    res.json(responseData);
  } catch (error) {
    console.error('❌ Error during fetch:', error.message);
    res.status(500).json({ error: 'Failed to fetch result. Try again shortly.' });
  }
});

// Start the Express server
app.get('/', (req, res) => {
  res.send('Welcome to the DIU Result Portal API. Use the /api/result endpoint to fetch results.');
});
app.listen(port, () => {
  console.log(`🚀 Server running at http://localhost:${port}`);
});
