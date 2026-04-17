const express = require("express");
const { v7: uuidv7 } = require("uuid");
const https = require("https");
const db = require("./database");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  next();
});

// Helper: fetch a URL and return parsed JSON
function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let raw = "";
      res.on("data", (chunk) => (raw += chunk));
      res.on("end", () => {
        try {
          resolve(JSON.parse(raw));
        } catch {
          reject(new Error("Invalid JSON"));
        }
      });
    }).on("error", reject);
  });
}

// Helper: classify age group
function classifyAge(age) {
  if (age <= 12) return "child";
  if (age <= 19) return "teenager";
  if (age <= 59) return "adult";
  return "senior";
}

// ── POST /api/profiles ─────────────────────────────────────────────
app.post("/api/profiles", async (req, res) => {
  const { name } = req.body;

  if (name === undefined || name === "") {
    return res.status(400).json({ status: "error", message: "Missing or empty name" });
  }

  if (typeof name !== "string") {
    return res.status(422).json({ status: "error", message: "Name must be a string" });
  }

  // Idempotency check
  const existing = db.prepare("SELECT * FROM profiles WHERE LOWER(name) = LOWER(?)").get(name);
  if (existing) {
    return res.status(200).json({
      status: "success",
      message: "Profile already exists",
      data: existing,
    });
  }

  try {
    const encodedName = encodeURIComponent(name);

    // Call all three APIs in parallel
    const [genderData, ageData, nationData] = await Promise.all([
      fetchJSON(`https://api.genderize.io/?name=${encodedName}`),
      fetchJSON(`https://api.agify.io/?name=${encodedName}`),
      fetchJSON(`https://api.nationalize.io/?name=${encodedName}`),
    ]);

    // Validate Genderize
    if (genderData.error) return res.status(502).json({ status: "502", message: "Genderize returned an invalid response" });
    if (genderData.gender === null || genderData.count === 0) return res.status(502).json({ status: "502", message: "Genderize returned an invalid response" });

    // Validate Agify
    if (ageData.error) return res.status(502).json({ status: "502", message: "Agify returned an invalid response" });
    if (ageData.age === null) return res.status(502).json({ status: "502", message: "Agify returned an invalid response" });

    // Validate Nationalize
    if (nationData.error) return res.status(502).json({ status: "502", message: "Nationalize returned an invalid response" });
    if (!nationData.country || nationData.country.length === 0) return res.status(502).json({ status: "502", message: "Nationalize returned an invalid response" });

    // Process data
    const gender = genderData.gender;
    const gender_probability = genderData.probability;
    const sample_size = genderData.count;

    const age = ageData.age;
    const age_group = classifyAge(age);

    // Pick country with highest probability
    const topCountry = nationData.country.reduce((a, b) =>
      a.probability > b.probability ? a : b
    );
    const country_id = topCountry.country_id;
    const country_probability = topCountry.probability;

    const id = uuidv7();
    const created_at = new Date().toISOString();

    // Store in database
    db.prepare(`
      INSERT INTO profiles (id, name, gender, gender_probability, sample_size, age, age_group, country_id, country_probability, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, name, gender, gender_probability, sample_size, age, age_group, country_id, country_probability, created_at);

    const profile = db.prepare("SELECT * FROM profiles WHERE id = ?").get(id);

    return res.status(201).json({ status: "success", data: profile });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ status: "error", message: "Internal server error" });
  }
});

// ── GET /api/profiles ──────────────────────────────────────────────
app.get("/", (req, res) => {
  res.status(200).json({ status: "success", message: "Profile Intelligence Service is running" });
});
app.get("/api/profiles", (req, res) => {
let query = "SELECT id, name, gender, age, age_group, country_id FROM profiles WHERE 1=1";
  const params = [];

  if (req.query.gender) {
    query += " AND LOWER(gender) = LOWER(?)";
    params.push(req.query.gender);
  }
  if (req.query.country_id) {
    query += " AND LOWER(country_id) = LOWER(?)";
    params.push(req.query.country_id);
  }
  if (req.query.age_group) {
    query += " AND LOWER(age_group) = LOWER(?)";
    params.push(req.query.age_group);
  }

  const profiles = db.prepare(query).all(...params);

  return res.status(200).json({
    status: "success",
    count: profiles.length,
    data: profiles,
  });
});

// ── GET /api/profiles/:id ──────────────────────────────────────────
app.get("/api/profiles/:id", (req, res) => {
  const profile = db.prepare("SELECT * FROM profiles WHERE id = ?").get(req.params.id);

  if (!profile) {
    return res.status(404).json({ status: "error", message: "Profile not found" });
  }

  return res.status(200).json({ status: "success", data: profile });
});

// ── DELETE /api/profiles/:id ───────────────────────────────────────
app.delete("/api/profiles/:id", (req, res) => {
  const profile = db.prepare("SELECT * FROM profiles WHERE id = ?").get(req.params.id);

  if (!profile) {
    return res.status(404).json({ status: "error", message: "Profile not found" });
  }

  db.prepare("DELETE FROM profiles WHERE id = ?").run(req.params.id);
  return res.status(204).send();
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
