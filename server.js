const express = require('express');
const app = express();
const path = require('path');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Explicit Home Route Fix
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// In-Memory Database
let users = [];

// Default Owner Account (Admin Login: Mobile: 0000000000, Pass: admin)
users.push({
  id: 'admin_1',
  name: 'Owner',
  mobile: '0000000000',
  password: 'admin',
  role: 'ADMIN',
  status: 'ACTIVE'
});

// REGISTER ROUTE
app.post('/api/register', (req, res) => {
  const { name, mobile, password, role, clinicName, location } = req.body;

  if (!name || !mobile || !password || !role) {
    return res.status(400).json({ message: 'Sabhi required fields bharein' });
  }

  const existing = users.find(u => u.mobile === mobile);
  if (existing) {
    return res.status(400).json({ message: 'Is mobile number se account pehle se hai' });
  }

  const trialEndDate = new Date();
  trialEndDate.setDate(trialEndDate.getDate() + 7);

  const newUser = {
    id: 'usr_' + Date.now(),
    name,
    mobile,
    password,
    role,
    clinicName: clinicName || '',
    location: location || '',
    status: role === 'DOCTOR' ? 'TRIAL' : 'ACTIVE',
    trialEnd: trialEndDate,
    fees: 500
  };

  users.push(newUser);
  res.json({ message: 'Account Created Successfully!', user: newUser });
});

// LOGIN ROUTE
app.post('/api/login', (req, res) => {
  const { mobile, password } = req.body;
  const user = users.find(u => u.mobile === mobile && u.password === password);

  if (!user) {
    return res.status(401).json({ message: 'Invalid Mobile Number or Password' });
  }

  if (user.role === 'DOCTOR') {
    const now = new Date();
    if (user.status === 'BLOCKED' || user.status === 'EXPIRED') {
      return res.status(403).json({ message: 'Aapka Subscription khatam/blocked hai. Admin se sampark karein.' });
    }
    if (user.status === 'TRIAL' && now > new Date(user.trialEnd)) {
      user.status = 'EXPIRED';
      return res.status(403).json({ message: 'Aapka Free Trial khatam ho chuka hai.' });
    }
  }

  res.json({ message: 'Login Success', user });
});

// ADMIN APIs
app.get('/api/admin/users', (req, res) => {
  res.json(users);
});

app.post('/api/admin/update-status', (req, res) => {
  const { userId, status, days } = req.body;
  const user = users.find(u => u.id === userId);

  if (user) {
    if (status) user.status = status;
    if (days) {
      const currentEnd = new Date(user.trialEnd || Date.now());
      currentEnd.setDate(currentEnd.getDate() + parseInt(days));
      user.trialEnd = currentEnd;
      user.status = 'TRIAL';
    }
    return res.json({ message: 'User Status Updated Successfully', user });
  }
  res.status(404).json({ message: 'User not found' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
