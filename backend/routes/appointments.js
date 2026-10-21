import express from 'express';
import { randomUUID } from 'node:crypto';
import { ethers } from 'ethers';
import { requireAuth } from '../middleware/authMiddleware.js';
import { createAppointmentStore } from '../services/appointmentStore.js';

const text = value => typeof value === 'string' ? value.trim() : '';
export function createAppointmentRouter({ store = createAppointmentStore(), auth = requireAuth } = {}) {
  const router = express.Router();
  router.use(auth);
  router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  router.post('/book', (req, res) => {
    const { doctorAddress } = req.body;
    const doctor = text(req.body.doctor), date = text(req.body.date), reason = text(req.body.reason);
    const time = text(req.body.time) || '10:00 AM';
    const parsed = new Date(date + 'T00:00:00Z');
    if (typeof doctorAddress !== 'string' || !ethers.isAddress(doctorAddress)) return res.status(400).json({ error: 'A valid doctor wallet address is required. A display name cannot authorize a booking.' });
    if (!doctor || doctor.length > 160 || !reason || reason.length > 2000 || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date || !/^(0?[1-9]|1[0-2]):[0-5]\d (AM|PM)$/.test(time)) return res.status(400).json({ error: 'Enter a doctor name, valid date/time, and reason (up to 2,000 characters).' });
    const appointment = {
      id: randomUUID(), patientName: text(req.body.patientName).slice(0, 160) || 'Patient',
      patientId: req.user.patientId || null, patientAddress: req.user.address.toLowerCase(),
      doctor, doctorAddress: doctorAddress.toLowerCase(), date, time, reason,
      status: 'pending', bookedAt: new Date().toISOString(),
    };
    try { const appointments = store.read(); appointments.push(appointment); store.write(appointments); res.json({ success: true, appointment }); }
    catch { res.status(503).json({ error: 'Appointment storage unavailable. Please retry.' }); }
  });
  router.get('/patient', (req, res) => {
    try { res.json({ appointments: store.read().filter(a => a.patientAddress === req.user.address.toLowerCase()) }); }
    catch { res.status(503).json({ error: 'Appointment storage unavailable. Please retry.' }); }
  });
  router.get('/doctor', (req, res) => {
    try { res.json({ appointments: store.read().filter(a => a.doctorAddress === req.user.address.toLowerCase()) }); }
    catch { res.status(503).json({ error: 'Appointment storage unavailable. Please retry.' }); }
  });
  router.post('/confirm/:id', (req, res) => {
    try {
      const appointments = store.read();
      const appointment = appointments.find(a => a.id === req.params.id);
      if (!appointment) return res.status(404).json({ error: 'Appointment not found' });
      if (appointment.doctorAddress !== req.user.address.toLowerCase()) return res.status(403).json({ error: 'Only the assigned doctor wallet can confirm this appointment.' });
      if (appointment.status !== 'confirmed') {
        appointment.status = 'confirmed'; appointment.confirmedAt = new Date().toISOString(); store.write(appointments);
      }
      res.json({ success: true, appointment });
    } catch { res.status(503).json({ error: 'Appointment storage unavailable. Please retry.' }); }
  });
  return router;
}
export default createAppointmentRouter();
