const express = require('express');
const axios = require('axios');
const { YemotRouter } = require('yemot-router2');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

const FIREBASE_DB_URL = process.env.FIREBASE_DATABASE_URL;
const FIREBASE_SECRET = process.env.FIREBASE_DB_SECRET;
const API_KEY = process.env.FIREBASE_API_KEY;
const BASE_URL = process.env.BASE_URL || 'https://sionyx-auth-server.onrender.com';

// ===== הגשת קבצי קול =====
app.use('/audio', express.static(path.join(__dirname, 'audio')));

// ===== Firebase helpers =====
function dbUrl(path) {
  return `${FIREBASE_DB_URL}/${path}.json?auth=${FIREBASE_SECRET}`;
}
async function dbGet(p) {
  const res = await axios.get(dbUrl(p));
  return res.data;
}
async function dbSet(p, data) {
  await axios.put(dbUrl(p), data);
}

// ===== חיפוש משתמש לפי מספר טלפון =====
async function findUserByPhone(phone) {
  const cleanPhone = phone.replace(/\D/g, '');
  const users = await dbGet('users');
  if (!users) return null;
  const uid = Object.keys(users).find(key => {
    const userPhone = (users[key].phoneNumber || '').replace(/\D/g, '');
    return userPhone === cleanPhone || userPhone.endsWith(cleanPhone) || cleanPhone.endsWith(userPhone);
  });
  return uid ? { uid, ...users[uid] } : null;
}

// ===== בניית רשימת קבצי קול לפי שם =====
function audioFile(name) {
  return { type: 'url', data: `${BASE_URL}/audio/${name}.mp3` };
}

// ===== ימות המשיח — ניהול שיחה =====
const yemotRouter = YemotRouter({ printLog: true });

yemotRouter.get('/yemot', async (call) => {
  const phone = call.phone;
  console.log(`[yemot] שיחה נכנסת מ: ${phone}`);

  try {
    // שלב 1: השמע פתיח וחכה ללחיצה
    // 000 = "שלום וברוך הבא, לחץ 1 לאימות, 2 לסיסמה חדשה"
    const digit = await call.read(
      [audioFile('000')],
      'tap',
      { max_digits: 1, digits_allowed: [1, 2], sec_wait: 25, allow_empty: false }
    );

    if (digit === '1') {
      // ===== אימות מספר טלפון =====
      console.log(`[yemot] אימות עבור: ${phone}`);
      const user = await findUserByPhone(phone);

      if (!user) {
        // 002 = "מספר הטלפון לא נמצא במערכת"
        console.log(`[yemot] מספר לא נמצא: ${phone}`);
        await call.read([audioFile('002')], 'tap', { max_digits: 1, sec_wait: 5, allow_empty: true });
        return;
      }

      // עדכן Firebase
      await dbSet(`users/${user.uid}/phoneVerified`, true);
      await dbSet(`users/${user.uid}/phoneVerifiedAt`, new Date().toISOString());
      await dbSet(`users/${user.uid}/phoneVerifiedBy`, 'phone');

      console.log(`[yemot] אומת בהצלחה: ${user.uid}`);

      // 001 = "מספר הטלפון שלך אומת בהצלחה"
      await call.read([audioFile('001')], 'tap', { max_digits: 1, sec_wait: 5, allow_empty: true });

    } else if (digit === '2') {
      // ===== איפוס סיסמה =====
      console.log(`[yemot] איפוס סיסמה עבור: ${phone}`);
      const user = await findUserByPhone(phone);

      if (!user) {
        // 002 = "מספר הטלפון לא נמצא במערכת"
        await call.read([audioFile('002')], 'tap', { max_digits: 1, sec_wait: 5, allow_empty: true });
        return;
      }

      // צור סיסמה אקראית בת 4 ספרות
      const tempPassword = Math.floor(1000 + Math.random() * 9000).toString();
      console.log(`[yemot] סיסמה חדשה עבור ${user.uid}: ${tempPassword}`);

      // שמור ב-Firebase
      await dbSet(`passwordResets/${user.uid}`, {
        tempPassword,
        expiresAt: Date.now() + 10 * 60 * 1000,
        createdAt: new Date().toISOString()
      });

      // עדכן Firebase Auth
      const userEmail = user.email || `${phone.replace(/\D/g, '')}@sionyx.app`;
      try {
        await axios.post(
          `https://identitytoolkit.googleapis.com/v1/accounts:update?key=${API_KEY}`,
          { email: userEmail, password: tempPassword, returnSecureToken: false }
        );
      } catch (authErr) {
        console.error('[yemot] שגיאה בעדכון Firebase Auth:', authErr.message);
      }

      // השמע: "הסיסמה החדשה שלך היא" + ספרות + "אנא שמור"
      const digits = tempPassword.split('');
      await call.read(
        [
          audioFile('004'),
          ...digits.map(d => audioFile(`num_${d}`)),
          audioFile('005')
        ],
        'tap',
        { max_digits: 1, sec_wait: 8, allow_empty: true }
      );
    }

  } catch (e) {
    console.error('[yemot] שגיאה:', e.message);
    // 003 = "אירעה שגיאה, נסה שנית"
    try {
      await call.read([audioFile('003')], 'tap', { max_digits: 1, sec_wait: 5, allow_empty: true });
    } catch {}
  }
});

app.use(yemotRouter);

// ===== Health check =====
app.get('/', (req, res) => {
  res.send('SIONYX Auth Server running ✓');
});

app.listen(PORT, () => {
  console.log(`SIONYX Auth Server running on port ${PORT}`);
});
