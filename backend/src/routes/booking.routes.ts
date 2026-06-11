import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { getDb } from '../config/db';
import { validate } from '../middleware/validate';
import { bookingRateLimiter } from '../middleware/rateLimiter';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { SeatLockService } from '../services/lock.service';
import { QueueService } from '../services/queue.service';
import { BookingSagaOrchestrator } from '../services/saga.service';
import { NotificationService } from '../services/notification.service';
import { PdfService } from '../services/pdf.service';
import { CircuitBreaker, SurgePricingService } from '../services/pricing.service';
import { maskAadhaar } from '../config/crypto';
import {
  emitBookingConfirmed,
  emitBookingCancelled,
  emitSeatReleased,
} from '../services/kafka.service';

const router = Router();

// Validation Schemas
const lockSeatsSchema = {
  body: z.object({
    trainNumber: z.string(),
    coachLabel: z.string(),
    seatNumbers: z.array(z.number()).min(1).max(6),
  }),
};

const confirmBookingSchema = {
  body: z.object({
    trainNumber: z.string(),
    coachLabel: z.string(),
    seatNumbers: z.array(z.number()).min(1).max(6),
    passengers: z.array(
      z.object({
        name: z.string().min(2),
        age: z.number().int().min(1).max(120),
        gender: z.enum(['M', 'F', 'O']),
        aadhaar: z.string().regex(/^\d{12}$/, 'Aadhaar must be exactly 12 digits'),
      })
    ).min(1),
    paymentMethod: z.enum(['UPI', 'Credit Card', 'Debit Card', 'Net Banking']),
    paymentDetails: z.object({
      upiId: z.string().optional(),
      cardNumber: z.string().optional(),
      cardExpiry: z.string().optional(),
      cardCvv: z.string().optional(),
      cardholderName: z.string().optional(),
      bankName: z.string().optional(),
    }).optional(),
    idempotencyKey: z.string().min(10),
  }),
};

const pnrParamsSchema = {
  params: z.object({
    pnr: z.string(),
  }),
};

// POST Lock Seats (Requires virtual queue window validation & rate limited)
router.post('/lock', authenticate, bookingRateLimiter, validate(lockSeatsSchema), async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ status: 'error', message: 'Unauthorized' });
    return;
  }
  const { trainNumber, coachLabel, seatNumbers } = req.body;
  const userId = req.user.id;

  try {
    // 1. Verify user has virtual queue access
    const hasQueueAccess = await QueueService.verifyBookingAccess(userId);
    if (!hasQueueAccess) {
      res.status(403).json({
        status: 'error',
        message: 'Access Denied: You must join the Virtual Queue and wait for your booking window.',
        requiresQueueRedirect: true,
      });
      return;
    }

    // 2. Lock each seat
    const lockedSeats: number[] = [];
    const db = await getDb();
    let isSwapped = false;

    for (const seatNum of seatNumbers) {
      let success = await SeatLockService.acquireSeatLock(trainNumber, coachLabel, seatNum, userId);
      let allocatedSeat = seatNum;

      if (!success) {
        // Find next nearest available seat in the same coach
        const alternatives = await db.all(
          `SELECT seat_number FROM seats 
           WHERE train_number = ? AND coach_label = ? AND status = 'AVAILABLE'
           ORDER BY ABS(seat_number - ?) ASC`,
          [trainNumber, coachLabel, seatNum]
        );
        
        for (const alt of alternatives) {
          if (!seatNumbers.includes(alt.seat_number) && !lockedSeats.includes(alt.seat_number)) {
            const altSuccess = await SeatLockService.acquireSeatLock(trainNumber, coachLabel, alt.seat_number, userId);
            if (altSuccess) {
              allocatedSeat = alt.seat_number;
              success = true;
              isSwapped = true;
              break;
            }
          }
        }
      }

      if (success) {
        lockedSeats.push(allocatedSeat);
      } else {
        // Compensating step: Release any seats locked so far in this transaction
        for (const rolledBackSeat of lockedSeats) {
          await SeatLockService.releaseSeatLock(trainNumber, coachLabel, rolledBackSeat, userId);
        }
        res.status(409).json({
          status: 'error',
          message: `Seat ${coachLabel}-${seatNum} is currently locked or booked, and no alternatives are available. Transaction aborted.`,
        });
        return;
      }
    }

    // Log lock event
    await db.run(
      "INSERT INTO audit_logs (actor, action, ip, payload) VALUES (?, 'SEATS_LOCKED', ?, ?)",
      [req.user.email, req.ip || 'unknown', JSON.stringify({ trainNumber, coachLabel, originalSeats: seatNumbers, lockedSeats })]
    );

    res.status(200).json({
      status: 'success',
      message: isSwapped 
        ? 'Some selected seats were occupied. Closest alternatives successfully locked.'
        : 'Seats successfully locked for 180 seconds.',
      data: {
        lockExpiresInSeconds: 180,
        lockedSeats,
      },
    });
  } catch (error) {
    next(error);
  }
});

const allocateSchema = {
  body: z.object({
    trainNumber: z.string(),
    coachLabel: z.string(),
    passengerCount: z.number().int().min(1).max(6),
  }),
};

// POST Auto-allocate seats (Tatkal-style: allocate after queue window opens)
router.post('/allocate', authenticate, bookingRateLimiter, validate(allocateSchema), async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ status: 'error', message: 'Unauthorized' });
    return;
  }
  const { trainNumber, coachLabel, passengerCount } = req.body;
  const userId = req.user.id;

  try {
    const hasQueueAccess = await QueueService.verifyBookingAccess(userId);
    if (!hasQueueAccess) {
      res.status(403).json({
        status: 'error',
        message: 'Access Denied: You must join the Virtual Queue and wait for your booking window.',
        requiresQueueRedirect: true,
      });
      return;
    }

    const db = await getDb();
    const available = await db.all(
      `SELECT seat_number FROM seats
       WHERE train_number = ? AND coach_label = ? AND status = 'AVAILABLE'
       ORDER BY seat_number
       LIMIT ?`,
      [trainNumber, coachLabel, passengerCount]
    );

    if (!available || available.length < passengerCount) {
      res.status(409).json({
        status: 'error',
        message: `Only ${available?.length ?? 0} seats available in ${coachLabel}, requested ${passengerCount}.`,
      });
      return;
    }

    const seatNumbers: number[] = [];
    for (const row of available) {
      const success = await SeatLockService.acquireSeatLock(trainNumber, coachLabel, row.seat_number, userId);
      if (success) {
        seatNumbers.push(row.seat_number);
      }
    }

    if (seatNumbers.length < passengerCount) {
      for (const sn of seatNumbers) {
        await SeatLockService.releaseSeatLock(trainNumber, coachLabel, sn, userId);
      }
      res.status(409).json({
        status: 'error',
        message: `Could not lock all seats. Only ${seatNumbers.length} locked.`,
      });
      return;
    }

    await db.run(
      "INSERT INTO audit_logs (actor, action, ip, payload) VALUES (?, 'SEATS_AUTO_ALLOCATED', ?, ?)",
      [req.user.email, req.ip || 'unknown', JSON.stringify({ trainNumber, coachLabel, seatNumbers })]
    );

    res.status(200).json({
      status: 'success',
      message: `${seatNumbers.length} seat(s) allocated and locked.`,
      data: { lockExpiresInSeconds: 180, lockedSeats: seatNumbers },
    });
  } catch (error) {
    next(error);
  }
});

// POST Confirm Booking (Executes Saga workflow)
router.post('/confirm', authenticate, bookingRateLimiter, validate(confirmBookingSchema), async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ status: 'error', message: 'Unauthorized' });
    return;
  }
  const { trainNumber, coachLabel, seatNumbers, passengers, paymentMethod, idempotencyKey } = req.body;
  const userId = req.user.id;
  const ipAddress = req.ip || 'unknown';

  try {
    // 1. Verify queue access
    const hasQueueAccess = await QueueService.verifyBookingAccess(userId);
    if (!hasQueueAccess) {
      res.status(403).json({
        status: 'error',
        message: 'Access Denied: You must join the Virtual Queue and wait for your booking window.',
        requiresQueueRedirect: true,
      });
      return;
    }

    // 2. Delegate to Saga Orchestrator
    const result = await BookingSagaOrchestrator.executeBookingPayment(
      userId,
      req.user.email,
      trainNumber,
      coachLabel,
      seatNumbers,
      passengers,
      paymentMethod,
      idempotencyKey,
      ipAddress
    );

    if (result.success) {
      res.status(200).json({
        status: 'success',
        message: result.message,
        data: {
          bookingId: result.bookingId,
          pnr: result.pnr,
          qrCode: `otpauth://pnr/RailFlow:${result.pnr}?bookingId=${result.bookingId}`,
          razorpayOrderId: result.razorpayOrderId,
          totalPrice: result.totalPrice,
        },
      });
    } else {
      res.status(400).json({
        status: 'error',
        message: result.message,
        refunded: result.refunded,
      });
    }
  } catch (error) {
    next(error);
  }
});

// GET E-Ticket by PNR (Public - no auth required, like UTS PNR enquiry)
router.get('/pnr/:pnr', validate(pnrParamsSchema), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const { pnr } = req.params;
  const db = await getDb();

  try {
    const booking = await db.get(
      'SELECT b.*, t.name as train_name, t.from_station, t.to_station, t.departure_time, t.arrival_time FROM bookings b JOIN trains t ON b.train_number = t.train_number WHERE b.pnr = ?',
      [pnr]
    );

    if (!booking) {
      res.status(404).json({ status: 'error', message: 'Booking not found with this PNR' });
      return;
    }

    // Parse and mask passenger info Aadhaar fields (API3 check)
    const rawPassengers = JSON.parse(booking.passengers) as any[];
    const maskedPassengers = rawPassengers.map(p => ({
      name: p.name,
      age: p.age,
      gender: p.gender,
      maskedAadhaar: maskAadhaar(p.aadhaar)
    }));

    res.status(200).json({
      status: 'success',
      data: {
        pnr: booking.pnr,
        trainNumber: booking.train_number,
        trainName: booking.train_name,
        fromStation: booking.from_station,
        toStation: booking.to_station,
        departureTime: booking.departure_time,
        arrivalTime: booking.arrival_time,
        status: booking.status,
        price: booking.price,
        createdAt: booking.created_at,
        passengers: maskedPassengers,
        qrCodePayload: `RAILFLOW-PNR:${booking.pnr}:${booking.id}`,
      },
    });
  } catch (error) {
    next(error);
  }
});

// GET E-Ticket by PNR (Authenticated - with ownership check)
router.get('/ticket/:pnr', authenticate, validate(pnrParamsSchema), async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ status: 'error', message: 'Unauthorized' });
    return;
  }
  const { pnr } = req.params;
  const db = await getDb();

  try {
    const booking = await db.get(
      'SELECT b.*, t.name as train_name, t.from_station, t.to_station, t.departure_time, t.arrival_time FROM bookings b JOIN trains t ON b.train_number = t.train_number WHERE b.pnr = ?',
      [pnr]
    );

    if (!booking) {
      res.status(404).json({ status: 'error', message: 'Ticket booking not found' });
      return;
    }

    // Enforce server-side ownership check (API1 OWASP check)
    if (booking.user_id !== req.user.id && req.user.role !== 'Admin' && req.user.role !== 'Super Admin') {
      res.status(403).json({ status: 'error', message: 'Access Denied: Ownership verification failed.' });
      return;
    }

    // Parse and mask passenger info Aadhaar fields (API3 check)
    const rawPassengers = JSON.parse(booking.passengers) as any[];
    const maskedPassengers = rawPassengers.map(p => ({
      name: p.name,
      age: p.age,
      gender: p.gender,
      maskedAadhaar: maskAadhaar(p.aadhaar)
    }));

    res.status(200).json({
      status: 'success',
      data: {
        pnr: booking.pnr,
        trainNumber: booking.train_number,
        trainName: booking.train_name,
        fromStation: booking.from_station,
        toStation: booking.to_station,
        departureTime: booking.departure_time,
        arrivalTime: booking.arrival_time,
        status: booking.status,
        price: booking.price,
        createdAt: booking.created_at,
        passengers: maskedPassengers,
        qrCodePayload: `RAILFLOW-PNR:${booking.pnr}:${booking.id}`,
      },
    });
  } catch (error) {
    next(error);
  }
});

// GET Booking History
router.get('/history', authenticate, async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ status: 'error', message: 'Unauthorized' });
    return;
  }
  const db = await getDb();
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
  const offset = (page - 1) * limit;

  try {
    const countResult = await db.get<{ count: number }>(
      'SELECT COUNT(*) as count FROM bookings WHERE user_id = ?',
      [req.user.id]
    );
    const total = countResult?.count ?? 0;

    const history = await db.all(
      `SELECT b.*, t.name as train_name, t.from_station, t.to_station, t.departure_time, t.arrival_time 
       FROM bookings b 
       JOIN trains t ON b.train_number = t.train_number 
       WHERE b.user_id = ? 
       ORDER BY b.created_at DESC
       LIMIT ? OFFSET ?`,
      [req.user.id, limit, offset]
    );

    // Group bookings into tabs for My Trips UI
    const processed = history.map(b => {
      const passengers = JSON.parse(b.passengers).map((p: any) => ({
        name: p.name,
        maskedAadhaar: maskAadhaar(p.aadhaar),
      }));
      return { ...b, passengers };
    });

    const now = new Date();
    const upcoming = processed.filter(b => b.status === 'CONFIRMED');
    const completed = processed.filter(b => b.status === 'CONFIRMED' && new Date(b.created_at) < new Date(Date.now() - 24 * 60 * 60 * 1000)); // Simulating past trip
    const cancelled = processed.filter(b => b.status === 'CANCELLED' || b.status === 'REFUNDED');

    res.status(200).json({
      status: 'success',
      data: {
        upcoming,
        completed,
        cancelled,
        all: processed,
      },
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    next(error);
  }
});

// GET Download E-Ticket as PDF
router.get('/ticket/:pnr/download', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const { pnr } = req.params;
  const db = await getDb();

  try {
    const booking = await db.get(
      `SELECT b.*, t.name as train_name, t.from_station, t.to_station, t.departure_time, t.arrival_time
       FROM bookings b JOIN trains t ON b.train_number = t.train_number WHERE b.pnr = ?`,
      [pnr]
    );

    if (!booking) {
      res.status(404).json({ status: 'error', message: 'Booking not found' });
      return;
    }

    const rawPassengers = JSON.parse(booking.passengers) as any[];
    const passengers = rawPassengers.map((p: any, i: number) => ({
      name: p.name,
      age: p.age,
      seat: booking.coach_label ? `${booking.coach_label}-${booking.seat_numbers?.[i] || i + 1}` : `Seat-${i + 1}`,
    }));

    const pdfBuffer = await CircuitBreaker.call(
      'pdf-generation',
      () => PdfService.generateETicket({
        pnr: booking.pnr,
        trainName: booking.train_name,
        trainNumber: booking.train_number,
        fromStation: booking.from_station,
        toStation: booking.to_station,
        departureTime: booking.departure_time,
        arrivalTime: booking.arrival_time,
        date: new Date(booking.created_at).toLocaleDateString('en-IN'),
        passengers,
        price: booking.price,
        status: booking.status,
      }),
      async () => {
        throw new Error('PDF service unavailable');
      }
    );

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="eticket-${pnr}.pdf"`);
    res.send(pdfBuffer);
  } catch (error: any) {
    res.status(503).json({ status: 'error', message: error.message || 'Failed to generate PDF' });
  }
});

// POST Partial Cancel (cancel specific passengers)
router.post('/cancel/:pnr/partial', authenticate, validate(pnrParamsSchema), async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ status: 'error', message: 'Unauthorized' });
    return;
  }
  const { pnr } = req.params;
  const { passengerIndices } = req.body;
  const db = await getDb();

  try {
    const booking = await db.get('SELECT * FROM bookings WHERE pnr = ?', [pnr]);
    if (!booking) {
      res.status(404).json({ status: 'error', message: 'Booking not found' });
      return;
    }

    if (booking.user_id !== req.user.id && req.user.role !== 'Admin' && req.user.role !== 'Super Admin') {
      res.status(403).json({ status: 'error', message: 'Access Denied' });
      return;
    }

    if (booking.status !== 'CONFIRMED') {
      res.status(400).json({ status: 'error', message: 'Only confirmed bookings can be partially cancelled' });
      return;
    }

    const passengers = JSON.parse(booking.passengers) as any[];
    const indices: number[] = Array.isArray(passengerIndices) ? passengerIndices : [passengerIndices];

    const invalid = indices.filter((i: number) => i < 0 || i >= passengers.length);
    if (invalid.length > 0) {
      res.status(400).json({ status: 'error', message: `Invalid passenger indices: ${invalid.join(', ')}` });
      return;
    }

    if (indices.length >= passengers.length) {
      res.status(400).json({ status: 'error', message: 'Use full cancellation for all passengers' });
      return;
    }

    const remaining = passengers.filter((_: any, i: number) => !indices.includes(i));
    const cancelledPassengers = passengers.filter((_: any, i: number) => indices.includes(i));
    const refundPerPassenger = booking.price / passengers.length;
    const refundAmount = Math.round(refundPerPassenger * indices.length);

    await db.run('BEGIN TRANSACTION;');
    try {
      const newPrice = booking.price - refundAmount;
      await db.run(
        'UPDATE bookings SET passengers = ?, price = ? WHERE id = ?',
        [JSON.stringify(remaining), newPrice, booking.id]
      );

      await db.run(
        "INSERT INTO audit_logs (actor, action, ip, payload) VALUES (?, 'BOOKING_PARTIAL_CANCELLED', ?, ?)",
        [req.user.email, req.ip || 'unknown', JSON.stringify({ pnr, cancelledCount: indices.length, refundAmount })]
      );

      await db.run('COMMIT;');

      NotificationService.send({
        userId: req.user.id,
        type: 'EMAIL',
        channel: req.user.email,
        subject: `Partial Cancellation - PNR: ${pnr}`,
        body: `${indices.length} passenger(s) cancelled. Refund: ₹${refundAmount}. Remaining: ${remaining.length} passenger(s).`,
        referenceType: 'BOOKING',
        referenceId: pnr,
      });

      res.status(200).json({
        status: 'success',
        message: `${indices.length} passenger(s) cancelled. Refund: ₹${refundAmount}`,
        data: { pnr, refundAmount, remainingPassengers: remaining.length },
      });
    } catch (e: any) {
      await db.run('ROLLBACK;');
      throw e;
    }
  } catch (error) {
    next(error);
  }
});

// POST Cancel Booking (Self-service cancellation)
router.post('/cancel/:pnr', authenticate, validate(pnrParamsSchema), async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ status: 'error', message: 'Unauthorized' });
    return;
  }
  const { pnr } = req.params;
  const db = await getDb();

  try {
    const booking = await db.get(
      'SELECT * FROM bookings WHERE pnr = ?',
      [pnr]
    );

    if (!booking) {
      res.status(404).json({ status: 'error', message: 'Booking not found' });
      return;
    }

    if (booking.user_id !== req.user.id && req.user.role !== 'Admin' && req.user.role !== 'Super Admin') {
      res.status(403).json({ status: 'error', message: 'Access Denied: You can only cancel your own bookings' });
      return;
    }

    if (booking.status === 'CANCELLED' || booking.status === 'REFUNDED') {
      res.status(400).json({ status: 'error', message: 'Booking is already cancelled or refunded' });
      return;
    }

    const train = await db.get('SELECT * FROM trains WHERE train_number = ?', [booking.train_number]);

    // Begin cancellation transaction
    await db.run('BEGIN TRANSACTION;');
    try {
      // Update booking status
      await db.run("UPDATE bookings SET status = 'CANCELLED' WHERE id = ?", [booking.id]);

      // Release all seats
      await db.run(
        `UPDATE seats SET status = 'AVAILABLE', locked_by = NULL, lock_expires_at = NULL, booking_id = NULL
         WHERE booking_id = ?`,
        [booking.id]
      );

      // Audit log
      await db.run(
        "INSERT INTO audit_logs (actor, action, ip, payload) VALUES (?, 'BOOKING_CANCELLED', ?, ?)",
        [req.user.email, req.ip || 'unknown', JSON.stringify({ pnr, bookingId: booking.id })]
      );

      await db.run('COMMIT;');

      // 1. Notify the cancelling user
      NotificationService.send({
        userId: req.user.id,
        type: 'EMAIL',
        channel: req.user.email,
        subject: `Booking Cancelled - PNR: ${pnr}`,
        body: `Your booking on ${train?.name || booking.train_number} (PNR: ${pnr}) has been cancelled. Any refund will be processed within 5-7 business days.`,
        referenceType: 'BOOKING',
        referenceId: pnr,
      });

      // 2. Automatically promote the top waitlist entry for this train
      (async () => {
        try {
          const nextWaitlist = await db.get(
            `SELECT w.*, u.email AS user_email, u.phone AS user_phone
             FROM booking_waitlist w
             JOIN users u ON w.user_id = u.id
             WHERE w.train_number = $1 AND w.status IN ('WAITLIST', 'RAC')
             ORDER BY w.waitlist_number ASC
             LIMIT 1`,
            [booking.train_number]
          );

          if (nextWaitlist) {
            // Promote: update status to CONFIRMED
            await db.run(
              "UPDATE booking_waitlist SET status = 'CONFIRMED', promoted_at = NOW() WHERE id = $1",
              [nextWaitlist.id]
            );

            // Resequence remaining waitlist positions
            await db.run(
              `UPDATE booking_waitlist SET waitlist_number = waitlist_number - 1
               WHERE train_number = $1 AND status IN ('WAITLIST', 'RAC') AND waitlist_number > $2`,
              [booking.train_number, nextWaitlist.waitlist_number]
            );

            // Notify the promoted user
            if (nextWaitlist.user_email) {
              NotificationService.send({
                userId: nextWaitlist.user_id,
                type: 'EMAIL',
                channel: nextWaitlist.user_email,
                subject: `🎉 Great news! Your waitlist ticket is confirmed — PNR: ${nextWaitlist.pnr}`,
                body: `A seat has become available on ${train?.name || booking.train_number}. Your waitlist booking (PNR: ${nextWaitlist.pnr}) has been CONFIRMED. Please complete payment within 30 minutes to secure your seat.`,
                referenceType: 'BOOKING',
                referenceId: nextWaitlist.pnr,
              });
            }
          }
        } catch (promotionErr: any) {
          // Non-fatal: log but don't surface to the cancelling user
          console.error('[WaitlistPromotion] Error promoting next waitlist entry:', promotionErr.message);
        }
      })();

      res.status(200).json({
        status: 'success',
        message: 'Booking cancelled successfully. Seats released.',
        data: { pnr, status: 'CANCELLED' },
      });
    } catch (e: any) {
      await db.run('ROLLBACK;');
      throw e;
    }
  } catch (error) {
    next(error);
  }
});

// POST Join waitlist / RAC for a train
router.post('/waitlist', authenticate, async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ status: 'error', message: 'Unauthorized' });
    return;
  }
  const { trainNumber, fromStation, toStation, coachClass, passengers } = req.body;

  if (!trainNumber || !fromStation || !toStation || !coachClass) {
    res.status(400).json({ status: 'error', message: 'trainNumber, fromStation, toStation, coachClass required' });
    return;
  }

  const db = await getDb();
  try {
    const train = await db.get('SELECT * FROM trains WHERE train_number = $1', [trainNumber]);
    if (!train) {
      res.status(404).json({ status: 'error', message: 'Train not found' });
      return;
    }

    const totalSeats = await db.get(
      'SELECT COUNT(*) as count FROM seats WHERE train_number = $1 AND coach_class = $2',
      [trainNumber, coachClass]
    );
    const bookedSeats = await db.get(
      "SELECT COUNT(*) as count FROM seats WHERE train_number = $1 AND coach_class = $2 AND status = 'BOOKED'",
      [trainNumber, coachClass]
    );

    const total = Number(totalSeats?.count ?? 0);
    const booked = Number(bookedSeats?.count ?? 0);
    const available = total - booked;

    const pnr = 'WL' + Date.now().toString(36).toUpperCase() + Math.floor(Math.random() * 1000).toString().padStart(3, '0');

    if (available >= (passengers || 1)) {
      res.status(200).json({
        status: 'success',
        message: 'Seats available! Please proceed to booking.',
        data: { availableSeats: available, suggestedAction: 'BOOK_DIRECT', pnr: undefined },
      });
      return;
    }

    const waitlistCount = await db.get(
      "SELECT COUNT(*) as count FROM booking_waitlist WHERE train_number = $1 AND coach_class = $2 AND status IN ('WAITLIST', 'RAC')",
      [trainNumber, coachClass]
    );
    const wlNum = Number(waitlistCount?.count ?? 0) + 1;

    const racThreshold = Math.ceil(total * 0.2);
    const status = wlNum <= racThreshold ? 'RAC' : 'WAITLIST';

    await db.run(
      `INSERT INTO booking_waitlist (user_id, train_number, from_station, to_station, coach_class, passengers, status, pnr, waitlist_number)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [req.user.id, trainNumber, fromStation.toUpperCase(), toStation.toUpperCase(), coachClass, passengers || 1, status, pnr, wlNum]
    );

    const message = status === 'RAC'
      ? `RAC ticket booked (PNR: ${pnr}). ${wlNum} ahead of you. Boarding guaranteed with seat sharing.`
      : `Waitlist ticket booked (PNR: ${pnr}). Current WL position: ${wlNum}.`;

    res.status(200).json({
      status: 'success',
      message,
      data: { pnr, waitlistNumber: wlNum, status, totalSeats: total, bookedSeats: booked },
    });
  } catch (error) {
    next(error);
  }
});

// GET Check waitlist/RAC status
router.get('/waitlist/status/:pnr', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const { pnr } = req.params;
  const db = await getDb();

  try {
    const entry = await db.get(
      `SELECT w.*, t.name AS train_name, t.train_number
       FROM booking_waitlist w
       JOIN trains t ON w.train_number = t.train_number
       WHERE w.pnr = $1`,
      [pnr]
    );

    if (!entry) {
      res.status(404).json({ status: 'error', message: 'Waitlist entry not found' });
      return;
    }

    res.status(200).json({
      status: 'success',
      data: {
        pnr: entry.pnr,
        trainNumber: entry.train_number,
        trainName: entry.train_name,
        fromStation: entry.from_station,
        toStation: entry.to_station,
        coachClass: entry.coach_class,
        passengers: entry.passengers,
        status: entry.status,
        waitlistNumber: entry.waitlist_number,
        createdAt: entry.created_at,
      },
    });
  } catch (error) {
    next(error);
  }
});

// GET My waitlist/RAC bookings
router.get('/waitlist/my', authenticate, async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ status: 'error', message: 'Unauthorized' });
    return;
  }
  const db = await getDb();

  try {
    const entries = await db.all(
      `SELECT w.*, t.name AS train_name
       FROM booking_waitlist w
       JOIN trains t ON w.train_number = t.train_number
       WHERE w.user_id = $1 AND w.status IN ('WAITLIST', 'RAC')
       ORDER BY w.created_at DESC`,
      [req.user.id]
    );

    res.status(200).json({ status: 'success', data: entries });
  } catch (error) {
    next(error);
  }
});

export default router;
