const express = require('express');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// Firebase config from environment variables
const FIREBASE_DB_URL = process.env.FIREBASE_DATABASE_URL || 'https://pc-sion-default-rtdb.firebaseio.com';
const FIREBASE_SECRET = process.env.FIREBASE_DB_SECRET;
const ORG_ID = process.env.ORG_ID || 'sionov';
const API_KEY = process.env.FIREBASE_API_KEY;

// ─── helpers ────────────────────────────────────────────────

function dbUrl(path) {
  return `${FIREBASE_DB_URL}/${path}.json?auth=${FIREBASE_SECRET}`;
}

async function dbGet(path) {
  const res = await axios.get(dbUrl(path));
  return res.data;
}

async function dbSet(path, data) {
  await axios.put(dbUrl(path), data);
}

async function dbDelete(path) {
  await axios.delete(dbUrl(path));
}

// ─── שלוחה 1 — אימות קוד ────────────────────────────────────
// ימות המשיח קורא: GET /verify?code=1234
app.get('/verify', async (req, res) => {
  const { code } = req.query;
  console.log(`[verify] code=${code}`);

  if (!code) {
    return res.send('id=invalid\n');
  }

  try {
    const data = await dbGet(`verificationCodes/${code}`);

    if (!data) {
      console.log(`[verify] code ${code} not found`);
      return res.send('id=invalid\n');
    }

    // בדיקת תפוגה
    const now = Date.now();
    if (data.expiresAt && now > data.expiresAt) {
      console.log(`[verify] code ${code} expired`);
      await dbDelete(`verificationCodes/${code}`);
      return res.send('id=expired\n');
    }

    // אימות הצליח — עדכן משתמש ב-Firebase
    const uid = data.uid;
    await dbSet(`users/${uid}/phoneVerified`, true);
    await dbSet(`users/${uid}/phoneVerifiedAt`, new Date().toISOString());
    await dbSet(`users/${uid}/phoneVerifiedBy`, 'phone');

    // מחק את הקוד
    await dbDelete(`verificationCodes/${code}`);

    console.log(`[verify] SUCCESS uid=${uid}`);
    return res.send('id=valid\n');

  } catch (err) {
    console.error('[verify] error:', err.message);
    return res.send('id=error\n');
  }
});

// ─── שלוחה 2 — איפוס סיסמה ──────────────────────────────────
// ימות המשיח קורא: GET /reset?phone=0501234567
app.get('/reset', async (req, res) => {
  const { phone } = req.query;
  console.log(`[reset] phone=${phone}`);

  if (!phone) {
    return res.send('id=error\n');
  }

  try {
    // חפש משתמש לפי מספר טלפון
    const users = await dbGet('users');
    if (!users) {
      return res.send('id=notfound\n');
    }

    const uid = Object.keys(users).find(
      key => users[key].phoneNumber === phone ||
             users[key].phoneNumber === phone.replace(/\D/g, '')
    );

    if (!uid) {
      console.log(`[reset] phone ${phone} not found`);
      return res.send('id=notfound\n');
    }

    // צור סיסמה זמנית — 6 ספרות
    const tempPassword = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = Date.now() + 10 * 60 * 1000; // 10 דקות

    // שמור ב-Firebase
    await dbSet(`passwordResets/${uid}`, {
      tempPassword,
      expiresAt,
      createdAt: new Date().toISOString()
    });

    // עדכן Firebase Auth דרך REST API
    // מצא את ה-email של המשתמש
    const userEmail = `${phone.replace(/\D/g, '')}@sionyx.app`;

    // עדכן סיסמה דרך Firebase Auth REST
    const authRes = await axios.post(
      `https://identitytoolkit.googleapis.com/v1/accounts:update?key=${API_KEY}`,
      {
        email: userEmail,
        password: tempPassword,
        returnSecureToken: false
      }
    );

    console.log(`[reset] SUCCESS uid=${uid} tempPass=${tempPassword}`);

    // החזר את הסיסמה לימות המשיח להשמעה
    return res.send(`id=success&password=${tempPassword}\n`);

  } catch (err) {
    console.error('[reset] error:', err.message);
    return res.send('id=error\n');
  }
});

// ─── health check ────────────────────────────────────────────
app.get('/', (req, res) => {
  res.send('SIONYX Auth Server running ✓');
});

app.listen(PORT, () => {
  console.log(`SIONYX Auth Server running on port ${PORT}`);
});
