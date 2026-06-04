const express = require('express');
const axios = require('axios');
const { YemotRouter } = require('yemot-router2');

const app = express();
const PORT = process.env.PORT || 3000;

const FIREBASE_DB_URL = process.env.FIREBASE_DATABASE_URL;
const FIREBASE_SECRET = process.env.FIREBASE_DB_SECRET;
const API_KEY = process.env.FIREBASE_API_KEY;

app.use((req, res, next) => {
  console.log('[HTTP] ' + req.method + ' ' + req.url);
  next();
});

function dbUrl(p) {
  return FIREBASE_DB_URL + '/' + p + '.json?auth=' + FIREBASE_SECRET;
}
async function dbGet(p) {
  const res = await axios.get(dbUrl(p));
  return res.data;
}
async function dbSet(p, data) {
  await axios.put(dbUrl(p), JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
}

async function findUserByPhone(phone) {
  const cleanPhone = phone.replace(/\D/g, '');
  const users = await dbGet('organizations/sionov/users');
  if (!users) return null;
  const uid = Object.keys(users).find(key => {
    const userPhone = (users[key].phoneNumber || '').replace(/\D/g, '');
    return userPhone === cleanPhone || userPhone.endsWith(cleanPhone) || cleanPhone.endsWith(userPhone);
  });
  return uid ? { uid, ...users[uid] } : null;
}

const TEXTS = {
  '000': 'להקשת אחד לאימות הקישו אחד לאיפוס סיסמה הקישו שניים',
  '001': 'אומת בהצלחה תודה',
  '002': 'מספר לא נמצא במערכת',
  '003': 'שגיאה נסה שנית',
  '004': 'הסיסמה החדשה שלך היא',
  '005': 'לחזרה הקישו כוכבית'
};

function msg(name) {
  return { type: 'text', data: TEXTS[name] || name };
}

const yemotRouter = YemotRouter({ printLog: true });

yemotRouter.get('/yemot', async (call) => {
  const phone = call.phone;
  console.log('[yemot] call from: ' + phone);

  try {
    const digit = await call.read(
      [msg('000')],
      'tap',
      { max_digits: 1, sec_wait: 25, allow_empty: true }
    );

    if (digit === '1') {
      console.log('[yemot] verify: ' + phone);
      const user = await findUserByPhone(phone);
      if (!user) {
        console.log('[yemot] not found: ' + phone);
        await call.read([msg('002')], 'tap', { max_digits: 1, sec_wait: 5, allow_empty: true });
        return;
      }
      await dbSet('organizations/sionov/users/' + user.uid + '/phoneVerified', true);
      await dbSet('organizations/sionov/users/' + user.uid + '/phoneVerifiedAt', new Date().toISOString());
      console.log('[yemot] verified: ' + user.uid);
      await call.read([msg('001')], 'tap', { max_digits: 1, sec_wait: 5, allow_empty: true });

    } else if (digit === '2') {
      console.log('[yemot] reset: ' + phone);
      const user = await findUserByPhone(phone);
      if (!user) {
        await call.read([msg('002')], 'tap', { max_digits: 1, sec_wait: 5, allow_empty: true });
        return;
      }
      const tempPassword = Math.floor(1000 + Math.random() * 9000).toString();
      console.log('[yemot] password for ' + user.uid + ': ' + tempPassword);
      await dbSet('organizations/sionov/passwordResets/' + user.uid, {
        tempPassword,
        expiresAt: Date.now() + 10 * 60 * 1000,
        createdAt: new Date().toISOString()
      });
      const digits = tempPassword.split('');
      const numTexts = { '0':'אפס','1':'אחד','2':'שניים','3':'שלוש','4':'ארבע','5':'חמש','6':'שש','7':'שבע','8':'שמונה','9':'תשע' };
      const numMsgs = digits.map(d => ({ type: 'text', data: numTexts[d] }));
      await call.read(
        [msg('004'), ...numMsgs, msg('005')],
        'tap',
        { max_digits: 1, sec_wait: 8, allow_empty: true }
      );
    } else {
      await call.read([msg('000')], 'tap', { max_digits: 1, sec_wait: 10, allow_empty: true });
    }

  } catch (e) {
    console.error('[yemot] error: ' + e.message);
    try {
      await call.read([msg('003')], 'tap', { max_digits: 1, sec_wait: 5, allow_empty: true });
    } catch {}
  }
});

app.use(yemotRouter);

app.get('/', (req, res) => {
  res.send('SIONYX Auth Server running');
});

app.listen(PORT, () => {
  console.log('SIONYX Auth Server running on port ' + PORT);
});
