import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import crypto from 'crypto';
import dotenv from 'dotenv';
import { Cashfree, CFEnvironment } from 'cashfree-pg';
import OpenAI from 'openai';

dotenv.config();

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static('.')); // Direct root files serve karne ke liye

// Cashfree Client
const cashfreeEnv = process.env.CASHFREE_ENV === 'PRODUCTION' ? CFEnvironment.PRODUCTION : CFEnvironment.SANDBOX;
const cashfree = new Cashfree(cashfreeEnv, process.env.CASHFREE_APP_ID || 'TEST', process.env.CASHFREE_SECRET_KEY || 'TEST');

// OpenAI Client
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || 'dummy_key' });

// ================= SCHEMAS =================

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true },
  mobile: { type: String, unique: true, required: true },
  password: { type: String, required: true },
  role: { type: String, enum: ['DOCTOR', 'PATIENT', 'ADMIN'], default: 'DOCTOR' },
  category: { type: String, default: 'General Physician' }, // Medical Specialty Category
  state: { type: String, required: true },
  city: { type: String, required: true },
  clinicName: String,
  clinicAddress: String,
  whatsappNumber: String,
  isApproved: { type: Boolean, default: false }, // SuperAdmin Approval
  subscriptionStatus: { type: String, enum: ['TRIAL', 'ACTIVE', 'EXPIRED'], default: 'TRIAL' },
  trialEndsAt: { type: Date, default: () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) },
  planExpiresAt: Date
}, { timestamps: true });

const User = mongoose.model('User', userSchema);

const sessionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  token: { type: String, required: true, unique: true },
  deviceInfo: String,
  expiresAt: { type: Date, required: true }
}, { timestamps: true });

const Session = mongoose.model('Session', sessionSchema);

const appointmentSchema = new mongoose.Schema({
  doctorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true }, // Strict Doctor Isolation
  patientName: { type: String, required: true },
  patientPhone: { type: String, required: true },
  tokenNumber: { type: Number, required: true },
  bookingChannel: { type: String, enum: ['WHATSAPP', 'WEB_PORTAL'], default: 'WEB_PORTAL' },
  symptoms: String,
  aiTriageLevel: { type: String, enum: ['ROUTINE', 'MODERATE', 'CRITICAL'], default: 'ROUTINE' },
  aiSummary: String,
  status: { type: String, enum: ['WAITING', 'IN_CABIN', 'COMPLETED', 'CANCELLED'], default: 'WAITING' },
  estimatedWaitMins: Number
}, { timestamps: true });

const Appointment = mongoose.model('Appointment', appointmentSchema);

const paymentTransactionSchema = new mongoose.Schema({
  doctorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  orderId: { type: String, required: true, unique: true },
  amount: { type: Number, required: true },
  planType: String,
  status: { type: String, enum: ['SUCCESS', 'PENDING', 'FAILED'], default: 'PENDING' }
}, { timestamps: true });

const PaymentTransaction = mongoose.model('PaymentTransaction', paymentTransactionSchema);

// ================= MIDDLEWARES =================

const authenticateUser = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'Session Token Missing' });
  }

  const token = authHeader.split(' ')[1];
  const session = await Session.findOne({ token }).populate('userId');

  if (!session || session.expiresAt < new Date()) {
    return res.status(401).json({ success: false, message: 'Session Expired! Please login again.' });
  }

  req.user = session.userId;
  next();
};

const requireDoctorAccess = async (req, res, next) => {
  if (req.user.role !== 'DOCTOR') {
    return res.status(403).json({ success: false, message: 'Doctor Access Required' });
  }

  if (!req.user.isApproved) {
    return res.status(403).json({ success: false, message: 'Account Pending Approval from SuperAdmin' });
  }

  const doctor = req.user;
  const now = new Date();

  if (doctor.subscriptionStatus === 'TRIAL' && now > doctor.trialEndsAt) {
    doctor.subscriptionStatus = 'EXPIRED';
    await doctor.save();
  } else if (doctor.subscriptionStatus === 'ACTIVE' && doctor.planExpiresAt && now > doctor.planExpiresAt) {
    doctor.subscriptionStatus = 'EXPIRED';
    await doctor.save();
  }

  if (doctor.subscriptionStatus === 'EXPIRED') {
    return res.status(402).json({ success: false, message: 'Subscription Expired! Please Upgrade.' });
  }

  next();
};

// Helper: AI Symptom Evaluator
async function evaluateSymptomsWithAI(symptoms) {
  try {
    if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY === 'dummy_key') {
      const text = (symptoms || '').toLowerCase();
      if (text.includes('chest pain') || text.includes('stroke') || text.includes('bleeding')) {
        return { level: 'CRITICAL', summary: 'Emergency symptoms detected.' };
      }
      if (text.includes('fever') || text.includes('vomiting') || text.includes('pain')) {
        return { level: 'MODERATE', summary: 'Moderate condition needing checkup.' };
      }
      return { level: 'ROUTINE', summary: 'Standard Consultation.' };
    }

    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        { role: "system", content: "Analyze patient symptoms. Respond strictly with valid JSON having keys 'level' ('ROUTINE' | 'MODERATE' | 'CRITICAL') and 'summary'." },
        { role: "user", content: `Symptoms: ${symptoms}` }
      ]
    });

    return JSON.parse(response.choices[0].message.content);
  } catch (err) {
    return { level: 'ROUTINE', summary: 'Standard Checkup' };
  }
}

// ================= PUBLIC PATIENT APIS (NO LOGIN NEEDED) =================

app.get('/api/public/doctors', async (req, res) => {
  try {
    const { state, city, category } = req.query;
    let query = { role: 'DOCTOR', isApproved: true };

    if (state) query.state = new RegExp(state, 'i');
    if (city) query.city = new RegExp(city, 'i');
    if (category) query.category = new RegExp(category, 'i');

    const doctors = await User.find(query).select('name email mobile category state city clinicName clinicAddress whatsappNumber');
    res.json({ success: true, doctors });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/api/public/book-appointment', async (req, res) => {
  try {
    const { doctorId, patientName, patientPhone, symptoms } = req.body;

    const doctor = await User.findById(doctorId);
    if (!doctor || doctor.role !== 'DOCTOR') {
      return res.status(404).json({ success: false, message: 'Doctor not found' });
    }

    const aiAnalysis = await evaluateSymptomsWithAI(symptoms);
    const todayCount = await Appointment.countDocuments({ doctorId, createdAt: { $gte: new Date().setHours(0,0,0,0) } });
    const tokenNumber = todayCount + 1;

    const appointment = await Appointment.create({
      doctorId,
      patientName,
      patientPhone,
      tokenNumber,
      bookingChannel: 'WEB_PORTAL',
      symptoms,
      aiTriageLevel: aiAnalysis.level,
      aiSummary: aiAnalysis.summary,
      estimatedWaitMins: (tokenNumber - 1) * 12
    });

    res.json({ success: true, message: 'Token Booked Successfully', appointment });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ================= AUTH APIS =================

app.post('/api/auth/register-doctor', async (req, res) => {
  try {
    const { name, email, mobile, password, category, state, city, clinicName, clinicAddress, whatsappNumber } = req.body;

    const exists = await User.findOne({ mobile });
    if (exists) return res.status(400).json({ success: false, message: 'Mobile already registered' });

    const doctor = await User.create({
      name, email, mobile, password,
      role: 'DOCTOR',
      category: category || 'General Physician',
      state, city, clinicName, clinicAddress, whatsappNumber,
      isApproved: false,
      subscriptionStatus: 'TRIAL'
    });

    res.status(201).json({ success: true, message: 'Doctor Registered Successfully! Awaiting Admin Approval.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { mobile, password, deviceInfo } = req.body;
    const user = await User.findOne({ mobile, password });

    if (!user) return res.status(401).json({ success: false, message: 'Invalid Credentials' });

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    await Session.create({ userId: user._id, token, deviceInfo: deviceInfo || 'Browser', expiresAt });

    res.json({
      success: true,
      token,
      user: {
        id: user._id,
        name: user.name,
        role: user.role,
        isApproved: user.isApproved,
        subscriptionStatus: user.subscriptionStatus
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ================= ISOLATED DOCTOR DASHBOARD APIS =================

app.get('/api/doctor/queue', authenticateUser, requireDoctorAccess, async (req, res) => {
  try {
    // Strictly Isolated Query using req.user._id
    const queue = await Appointment.find({ doctorId: req.user._id }).sort({ createdAt: -1 });
    res.json({ success: true, queue, doctor: req.user });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.patch('/api/doctor/queue-status/:id', authenticateUser, requireDoctorAccess, async (req, res) => {
  try {
    const { status } = req.body;
    const appointment = await Appointment.findOneAndUpdate(
      { _id: req.params.id, doctorId: req.user._id }, // Strict Isolation
      { status },
      { new: true }
    );
    res.json({ success: true, appointment });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Cashfree Checkout Integration
app.post('/api/subscription/checkout', authenticateUser, async (req, res) => {
  try {
    const { planType, amount } = req.body;
    const orderId = `ORDER_${req.user._id}_${Date.now()}`;

    const request = {
      order_id: orderId,
      order_amount: amount,
      order_currency: 'INR',
      customer_details: {
        customer_id: req.user._id.toString(),
        customer_name: req.user.name,
        customer_phone: req.user.mobile,
      },
      order_meta: {
        return_url: `${req.protocol}://${req.get('host')}/doctor.html?order_id=${orderId}`
      }
    };

    const response = await cashfree.PGCreateOrder(request);

    await PaymentTransaction.create({
      doctorId: req.user._id,
      orderId,
      amount,
      planType,
      status: 'PENDING'
    });

    res.json({ success: true, payment_session_id: response.data.payment_session_id, orderId });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ================= DYNAMIC WHATSAPP WEBHOOK =================

app.post('/api/whatsapp/webhook', async (req, res) => {
  try {
    const { doctorId } = req.query; // Dynamic Routing Query
    const { patientName, patientPhone, incomingMessage } = req.body;

    const doctor = await User.findById(doctorId);
    if (!doctor || doctor.role !== 'DOCTOR') return res.status(404).json({ error: 'Doctor not found' });

    const aiAnalysis = await evaluateSymptomsWithAI(incomingMessage);
    const todayCount = await Appointment.countDocuments({ doctorId, createdAt: { $gte: new Date().setHours(0,0,0,0) } });
    const tokenNumber = todayCount + 1;

    const appointment = await Appointment.create({
      doctorId,
      patientName,
      patientPhone,
      tokenNumber,
      bookingChannel: 'WHATSAPP',
      symptoms: incomingMessage,
      aiTriageLevel: aiAnalysis.level,
      aiSummary: aiAnalysis.summary,
      estimatedWaitMins: (tokenNumber - 1) * 12
    });

    res.json({
      success: true,
      reply: `Token Confirmed for Dr. ${doctor.name}!\nToken Number: #${tokenNumber}\nPriority Tag: ${aiAnalysis.level}`
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ================= SUPERADMIN CONTROL PANEL APIS =================

app.get('/api/admin/metrics', authenticateUser, async (req, res) => {
  try {
    if (req.user.role !== 'ADMIN') return res.status(403).json({ success: false, message: 'SuperAdmin Access Only' });

    const totalDoctors = await User.countDocuments({ role: 'DOCTOR' });
    const pendingDoctors = await User.countDocuments({ role: 'DOCTOR', isApproved: false });

    const totalRev = await PaymentTransaction.aggregate([
      { $match: { status: 'SUCCESS' } },
      { $group: { _id: null, total: { $sum: "$amount" } } }
    ]);

    const todayRev = await PaymentTransaction.aggregate([
      { $match: { status: 'SUCCESS', createdAt: { $gte: new Date(new Date().setHours(0,0,0,0)) } } },       {$group: { _id: null, total: { $sum: "$amount" } } }
    ]);

    const doctorsList = await User.find({ role: 'DOCTOR' }).sort({ createdAt: -1 });

    res.json({
      success: true,
      stats: {
        totalDoctors,
        pendingDoctors,
        totalRevenue: totalRev[0]?.total || 0,
        todayRevenue: todayRev[0]?.total || 0
      },
      doctors: doctorsList
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/api/admin/approve-doctor/:doctorId', authenticateUser, async (req, res) => {
  try {
    if (req.user.role !== 'ADMIN') return res.status(403).json({ success: false, message: 'SuperAdmin Access Only' });

    await User.findByIdAndUpdate(req.params.doctorId, { isApproved: true });
    res.json({ success: true, message: 'Doctor Approved Successfully!' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// App Engine Listen
const PORT = process.env.PORT || 5000;
mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/cliniccare')
  .then(() => app.listen(PORT, () => console.log(`🚀 ClinicCare Platform Server Live on Port ${PORT}`)))
  .catch(err => console.error('MongoDB Error:', err));
