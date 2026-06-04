const express = require('express');
const axios = require('axios');
const { YemotRouter } = require('yemot-router2');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

const FIREBASE_DB_URL = process.env.FIREBASE_DATABASE_URL;
const FIREBASE_SECRET = process.env.FIREBASE_DB_SECRET;
const API_KEY = process.env.FIREBASE_API_KEY;

app.use('/audio', express.static(path.join(__dirname, 'audio')));

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
  await axios.put(dbUrl(p), data);
}

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

function audioFile(name) {
  return { type: 'file', data: path.join(__dirname, 'audio', name + '.mp3') };
}

const yemotRouter = YemotRouter({ printLog: true });

yemotRouter.get('/yemot', async (call) => {
  const phone = call.phone;
  console.log('[yemot] call from: ' + phone);

  try {
    const digit = await call.read(
      [audioFile('000')],
      'tap',
      { max_digits: 1, digits_allowed: [1, 2], sec_wait: 25, allow_empty: false }
    );

    if (digit === '1') {
      console.log('[yemot] verify: ' + phone);
      const user = await findUserByPhone(phone);

      if (!user) {
        console.log('[yemot] not found: ' + phone);
        await call.read([audioFile('002')], 'tap', { max_digits: 1, sec_wait: 5, allow_empty: true });
        return;
      }

      await dbSet('users/' + user.uid + '/phoneVerified', true);
      await dbSet('users/' + user.uid + '/phoneVerifiedAt', new Date().toISOString());
      await dbSet('users/' + user.uid + '/phoneVerifiedBy', 'phone');

      console.log('[yemot] verified: ' + user.uid);
      await call.read([audioFile('001')], 'tap', { max_digits: 1, sec_wait: 5, allow_empty: true });

    } else if (digit === '2') {
      console.log('[yemot] reset password: ' + phone);
      const user = await findUserByPhone(phone);

      if (!user) {
        await call.read([audioFile('002')], 'tap', { max_digits: 1, sec_wait: 5, allow_empty: true });
        return;
      }

      const tempPassword = Math.floor(1000 + Math.random() * 9000).toString();
      console.log('[yemot] new password for ' + user.uid + ': ' + tempPassword);

      await dbSet('passwordResets/' + user.uid, {
        tempPassword,
        expiresAt: Date.now() + 10 * 60 * 1000,
        createdAt: new Date().toISOString()
      });

      const userEmail = user.email || (phone.replace(/\D/g, '') + '@sionyx.app');
      try {
        await axios.post(
          'https://identitytoolkit.googleapis.com/v1/accounts:update?key=' + API_KEY,
          { email: userEmail, password: tempPassword, returnSecureToken: false }
        );
      } catch (authErr) {
        console.error('[yemot] firebase auth error: ' + authErr.message);
      }

      const digits = tempPassword.split('');
      await call.read(
        [audioFile('004'), ...digits.map(d => audioFile('num_' + d)), audioFile('005')],
        'tap',
        { max_digits: 1, sec_wait: 8, allow_empty: true }
      );
    }

  } catch (e) {
    console.error('[yemot] error: ' + e.message);
    try {
      await call.read([audioFile('003')], 'tap', { max_digits: 1, sec_wait: 5, allow_empty: true });
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