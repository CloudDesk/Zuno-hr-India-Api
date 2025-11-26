import mongoose, { Types, Document } from 'mongoose';
import { User } from '../models/user.model';
import { ShiftAssignment, IShift } from '../models/shift.model';
import { AttendanceRecord, IAttendanceRecord } from '../models/attendance-record.model';
import { BaseService } from './base.service';
import { RequestContext } from '../types/context';
import { HolidayCalendar, IHoliday } from '../models';
import * as ExcelJS from 'exceljs';


interface ISwipeData {
  biometricId: string; // Biometric ID to identify user
  timestamp: Date;
  location?: {
    latitude: number;
    longitude: number;
    accuracy: number;
    altitude: number;
    address: string;
  };
  hasLocation?: boolean;
  locationValid?: boolean;
  locationAddress?: string;
}

interface IAttendanceRecordsQuery {
  startDate: Date;
  endDate: Date;
  userIds?: string[];
  page: number;
  limit: number;
}
interface ISwipeResponse {
  success: boolean;
  message: string;
  data?: {
    userId: Types.ObjectId;
    shiftCode: string;
    shiftDay: Date;
    swipeTime: Date;
    firstIn?: Date | null;
    lastOut?: Date | null;
    isWithinWindow: boolean;

    needsRegularization?: boolean;
    isLateEntry?: boolean;
    isEarlyExit?: boolean;
    status: string;
    attendanceStatus: string[];
    totalWorkHours?: string;
    breakHours?: string;
    actualWorkHours?: string;
    shiftHours?: string;
    shortfallHours?: string;
    excessHours?: string;
    outOfWindowSwipes?: {
      timestamp: Date;
      direction: 'IN' | 'OUT';
      deviceId: string;
      location: {
        latitude: number;
        longitude: number;
        accuracy: number;
        altitude: number;
        address: string;
      };
      reason: string;
    }[];
    reason?: string;
  };
}

interface IShiftWindow {
  shiftStart: Date;
  shiftEnd: Date;
  windowStart: Date;
  windowEnd: Date;
}

interface IAttendanceMetrics {
  totalWorkHours: string;
  breakHours: string;
  actualWorkHours: string;
  shiftHours: string;
  shortfallHours: string;
  excessHours: string;
  hasShortfall: boolean;
  hasExcessHours: boolean;
}




export class BiometricAttendanceService extends BaseService {
  constructor(context: RequestContext) {
    super(context);// Initialize shiftService with the appropriate service
  }
  // Add this function to check if the attendance date matches with a holiday
  private async checkHolidayCalendar(userId: Types.ObjectId, shiftDay: Date): Promise<IHoliday | null> {
    // Normalize the date to start of day to ensure accurate comparison
    const normalizedDate = new Date(shiftDay);
    normalizedDate.setUTCHours(0, 0, 0, 0);

    // Find holiday calendars assigned to this user
    const holidayCalendars = await HolidayCalendar.find({
      assignedTo: { $in: [userId.toString()] }
    });

    // If no holiday calendars found for this user
    if (!holidayCalendars || holidayCalendars.length === 0) {
      return null;
    }

    // Check each calendar for matching holiday date
    for (const calendar of holidayCalendars) {
      const matchedHoliday = calendar.holidays.find(holiday => {
        const holidayDate = new Date(holiday.date);
        holidayDate.setUTCHours(0, 0, 0, 0);

        return holidayDate.getTime() === normalizedDate.getTime();
      });

      if (matchedHoliday) {
        return matchedHoliday;
      }
    }

    return null;
  }

  private async getUserByBiometricId(biometricId: string) {
    console.log('🔍 getUserByBiometricId called with:', biometricId);

    // Check if biometricId is actually a MongoDB ObjectId (userId)
    if (Types.ObjectId.isValid(biometricId) && biometricId.length === 24) {
      console.log('✅ Detected ObjectId format, treating as userId');
      // If it's a valid ObjectId, treat it as userId
      const user = await User.findById(biometricId);
      if (!user || !user.active) {
        throw new Error('User not found or inactive');
      }
      console.log('✅ User found by ObjectId:', user.name, user.email);
      return user;
    } else {
      console.log('✅ Detected string format, treating as biometricId');
      // If it's not an ObjectId, treat it as biometricId
      const user = await User.findOne({ biometricId, active: true });
      if (!user) {
        throw new Error('User not found or inactive');
      }
      console.log('✅ User found by biometricId:', user.name, user.email);
      return user;
    }
  }

  private async getCurrentShiftAssignment(userId: Types.ObjectId, timestamp: Date) {
    const shiftDay = new Date(timestamp);
    shiftDay.setUTCHours(0, 0, 0, 0);
    console.log("userId", userId, shiftDay, "shiftDay")
    // Find active shift assignment for the user
    const shiftAssignment = await ShiftAssignment.findOne({
      userId,
      isActive: true,
      startDate: { $lte: shiftDay },
      $or: [
        { endDate: { $gte: shiftDay } },
        { endDate: null },
      ],
    }).populate<{ shiftId: any }>('shiftId');
    console.log(shiftAssignment, "shiftAssignment")
    if (!shiftAssignment || !shiftAssignment.shiftId) {
      throw new Error('No active shift assignment found');
    }
    return shiftAssignment;
  }

  private getShiftTimings(shift: IShift & Document, shiftDay: Date): IShiftWindow {
    const parseTime = (timeStr: string): { hours: number; minutes: number } => {
      const [hours, minutes] = timeStr.split(':').map(Number);
      if (isNaN(hours) || isNaN(minutes)) {
        throw new Error('Invalid time format. Expected HH:mm or HH:mm:ss');
      }
      return { hours, minutes };
    };

    const convertISTtoUTC = (istHours: number, istMinutes: number): { hours: number; minutes: number } => {
      let utcHours = istHours - 5;
      let utcMinutes = istMinutes - 30;

      if (utcMinutes < 0) {
        utcMinutes += 60;
        utcHours -= 1;
      }

      if (utcHours < 0) {
        utcHours += 24;
        shiftDay.setUTCDate(shiftDay.getUTCDate() - 1);
      }

      return { hours: utcHours, minutes: utcMinutes };
    };

    const startIST = parseTime(shift.startTime);
    const endIST = parseTime(shift.endTime);
    const windowStartIST = parseTime(shift.shiftWindowStart);
    const windowEndIST = parseTime(shift.shiftWindowEnd);

    const startUTC = convertISTtoUTC(startIST.hours, startIST.minutes);
    const endUTC = convertISTtoUTC(endIST.hours, endIST.minutes);
    const windowStartUTC = convertISTtoUTC(windowStartIST.hours, windowStartIST.minutes);
    const windowEndUTC = convertISTtoUTC(windowEndIST.hours, windowEndIST.minutes);

    const shiftStart = new Date(shiftDay);
    shiftStart.setUTCHours(startUTC.hours, startUTC.minutes, 0, 0);

    const shiftEnd = new Date(shiftDay);
    shiftEnd.setUTCHours(endUTC.hours, endUTC.minutes, 0, 0);

    const windowStart = new Date(shiftDay);
    windowStart.setUTCHours(windowStartUTC.hours, windowStartUTC.minutes, 0, 0);

    const windowEnd = new Date(shiftDay);
    windowEnd.setUTCHours(windowEndUTC.hours, windowEndUTC.minutes, 0, 0);

    if (endUTC.hours < startUTC.hours ||
      (endUTC.hours === startUTC.hours && endUTC.minutes < startUTC.minutes)) {
      shiftEnd.setUTCDate(shiftEnd.getUTCDate() + 1);
    }

    if (windowEndUTC.hours < windowStartUTC.hours ||
      (windowEndUTC.hours === windowStartUTC.hours && windowEndUTC.minutes < windowStartUTC.minutes)) {
      windowEnd.setUTCDate(windowEnd.getUTCDate() + 1);
    }

    return { shiftStart, shiftEnd, windowStart, windowEnd };
  }

  private async findOrCreateAttendanceRecord(
    userId: Types.ObjectId,
    shiftId: Types.ObjectId,
    shiftDay: Date,
    shiftCode: string,
    shiftStart: Date,
    shiftEnd: Date,
  ) {
    let record = await AttendanceRecord.findOne({
      userId,
      shiftDay,
      shiftCode,
    });

    if (!record) {
      record = await AttendanceRecord.create({
        userId,
        shiftId,
        shiftDay,
        shiftCode,
        shiftStart,
        shiftEnd,
        swipes: [],
        outOfWindowSwipes: [],
        needsRegularization: false,
        attendanceStatus: [],
        isLateEntry: false,
        isEarlyExit: false,
        isWithinWindow: true,
        excessHours: '0:00:00',
        shortfallHours: '0:00:00',
        // status: 'incomplete'
      });
    }

    // Check if this date is a holiday for the user
    const holiday = await this.checkHolidayCalendar(userId, shiftDay);

    if (holiday) {
      // Update record with holiday information
      record.status = 'holiday_swipe';
      record.attendanceStatus = ['Holiday-Swipe'];

      // Initialize regularization field if it doesn't exist
      if (!record.regularization) {
        record.regularization = {
          isRegularized: true,
          hasRegularizationRequest: false,
          regularizationType: ['Holiday-Swipe'],
          status: 'Approved',
          regularizationId: new Types.ObjectId(), // Generate a new ID
        };
      } else {
        // Update existing regularization field
        record.regularization.isRegularized = true;
        record.regularization.regularizationType = ['Holiday-Swipe'];
        record.regularization.status = 'Approved';
      }

      // Save the updated record
      await record.save();
    }

    return record;
  }

  private convertToIST(date: Date): string {
    // Create a new date object to avoid modifying the original
    const istDate = new Date(date);

    // Add 5 hours and 30 minutes for IST
    istDate.setUTCHours(istDate.getUTCHours() + 5);
    istDate.setUTCMinutes(istDate.getUTCMinutes() + 30);

    // Format time as HH:mm AM/PM
    return istDate.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });
  }

  private async validateAndUpdateWindowStatus(
    record: IAttendanceRecord & Document,
    timestamp: Date,
    shiftWindow: IShiftWindow
  ): Promise<{ isValid: boolean; reason?: string }> {

    /* const isWithinWindow = timestamp >= shiftWindow.windowStart && timestamp <= shiftWindow.windowEnd;
     record.isWithinWindow = isWithinWindow;
 
     const prevDayWindowEnd = new Date(shiftWindow.windowEnd);
     prevDayWindowEnd.setUTCDate(prevDayWindowEnd.getUTCDate() - 1);
 
     const nextDayWindowStart = new Date(shiftWindow.windowStart);
     nextDayWindowStart.setUTCDate(nextDayWindowStart.getUTCDate() + 1);
 
     return {
       isValid: isWithinWindow ||
         timestamp <= prevDayWindowEnd ||
         timestamp >= nextDayWindowStart
     };
       */
    // Create window boundaries for previous, current, and next day
    const prevDayWindowEnd = new Date(shiftWindow.windowEnd);
    prevDayWindowEnd.setUTCDate(prevDayWindowEnd.getUTCDate() - 1);

    const nextDayWindowStart = new Date(shiftWindow.windowStart);
    nextDayWindowStart.setUTCDate(nextDayWindowStart.getUTCDate() + 1);

    // Check if swipe is within the current day's window
    const isWithinWindow = timestamp >= shiftWindow.windowStart && timestamp <= shiftWindow.windowEnd;
    record.isWithinWindow = isWithinWindow;
    console.log(isWithinWindow, "isWithinWindow handler")
    if (isWithinWindow) {
      return { isValid: true };
    }
    // Determine the reason for invalid window
    let reason = '';
    if (timestamp < shiftWindow.windowStart) {
      reason = `Too early. Window starts at ${this.convertToIST(shiftWindow.windowStart)} IST`;
    } else if (timestamp > shiftWindow.windowEnd) {
      reason = `Too late. Window ends at${this.convertToIST(shiftWindow.windowEnd)} IST`;
    }

    // Check if the swipe belongs to previous or next day's window
    const isPrevDayWindow = timestamp <= prevDayWindowEnd;
    const isNextDayWindow = timestamp >= nextDayWindowStart;

    if (isPrevDayWindow || isNextDayWindow) {
      reason += ' - Possible wrong shift assignment';
    }

    return {
      isValid: false,
      reason
    };
  }

  private async getDuration(start: Date, end: Date): Promise<string> {
    const startTime = new Date(start).getTime();
    const endTime = new Date(end).getTime();

    const diffMs = endTime - startTime; // Difference in milliseconds
    const hours = String(Math.floor(diffMs / (1000 * 60 * 60))).padStart(2, '0');
    const minutes = String(Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60))).padStart(2, '0');
    const seconds = String(Math.floor((diffMs % (1000 * 60)) / 1000)).padStart(2, '0');

    return `${hours}:${minutes}:${seconds}`;
  }


  private async processFirstSwipe(
    record: IAttendanceRecord & Document,
    timestamp: Date,
    shiftWindow: IShiftWindow,
    locationData?: {
      latitude: number;
      longitude: number;
      accuracy: number;
      altitude: number;
      address: string;
    }
  ): Promise<void> {

    console.log('🔄 PROCESS FIRST SWIPE CALLED');
    console.log('📍 locationData received:', locationData);
    console.log('📍 shiftWindow:', shiftWindow);

    // Create the IN swipe with actual location data or defaults
    const inSwipe = {
      timestamp,
      direction: 'IN' as const,
      deviceId: 'biometric',
      location: locationData || {
        latitude: 0,
        longitude: 0,
        accuracy: 0,
        altitude: 0,
        address: 'unknown'
      }
    };

    console.log('📍 IN swipe being created:', inSwipe);
    console.log('📍 Location in IN swipe:', inSwipe.location);

    record.swipes = [inSwipe];
    record.firstIn = timestamp;
    record.isLateEntry = timestamp > shiftWindow.shiftStart;
    record.attendanceStatus = record.isLateEntry ? ['Late'] : ['On-Time'];
    record.needsRegularization = record.isLateEntry;

    let workDuration = await this.getDuration(shiftWindow.shiftStart, shiftWindow.shiftEnd)
    console.log(workDuration, "workDuration")
    // Initialize time calculations
    record.totalWorkHours = '00:00:00';
    record.breakHours = '00:00:00';
    record.shortfallHours = '00:00:00';
    record.excessHours = '00:00:00';
    record.actualWorkHours = "00:00:00";
    record.shiftHours = workDuration || "09:00:00"
    console.log(record, "1st swipe record")
    await record.save();
  }

  private async processSecondSwipe(
    record: IAttendanceRecord & Document,
    timestamp: Date,
    shiftWindow: IShiftWindow,
    locationData?: {
      latitude: number;
      longitude: number;
      accuracy: number;
      altitude: number;
      address: string;
    }
  ): Promise<void> {
    console.log('🔄 PROCESS SECOND SWIPE CALLED');
    console.log('📍 locationData received:', locationData);
    console.log('📍 shiftWindow:', shiftWindow);

    // Create the OUT swipe with actual location data or defaults
    const outSwipe = {
      timestamp,
      direction: 'OUT' as const,
      deviceId: 'biometric',
      location: locationData || {
        latitude: 0,
        longitude: 0,
        accuracy: 0,
        altitude: 0,
        address: 'unknown'
      }
    };

    console.log('📍 OUT swipe being created:', outSwipe);
    console.log('📍 Location in OUT swipe:', outSwipe.location);

    record.swipes.push(outSwipe);
    record.lastOut = timestamp;
    record.isEarlyExit = timestamp < shiftWindow.shiftEnd;

    // Calculate metrics
    const metrics = await this.calculateAttendanceMetrics(
      record.firstIn!,
      timestamp,
      shiftWindow.shiftStart,
      shiftWindow.shiftEnd
    );
    console.log(metrics, "2nd swipe metrics")
    // Update all time-related fields
    record.totalWorkHours = metrics.totalWorkHours;
    record.breakHours = metrics.breakHours;
    record.actualWorkHours = metrics.actualWorkHours;
    record.shortfallHours = metrics.shortfallHours;
    record.excessHours = metrics.excessHours;

    // Update attendance status
    if (record.isEarlyExit) {
      record.attendanceStatus.push('Early-Exit');
    }

    // Update regularization flag
    record.needsRegularization =
      record.isLateEntry ||
      record.isEarlyExit ||
      metrics.hasShortfall ||
      !record.isWithinWindow;

    const isPresent = record.isLateEntry ||
      record.isEarlyExit ||
      !record.isWithinWindow;
    console.log(isPresent, "isPresent")
    if (isPresent) {
      record.attendanceStatus.push('Present');
    }
    console.log(record, "2nd swipe record")
    await record.save();
  }


  private async calculateAttendanceMetrics(
    firstIn: Date,
    lastOut: Date,
    shiftStart: Date,
    shiftEnd: Date
  ): Promise<IAttendanceMetrics> {
    console.log("c firstIn", firstIn, "c lastOut", lastOut);
    console.log("c shiftStart", shiftStart, "c shiftEnd", shiftEnd)
    // Calculate total duration in minutes
    const totalMinutes = (lastOut.getTime() - firstIn.getTime()) / (1000 * 60);
    const shiftMinutes = (shiftEnd.getTime() - shiftStart.getTime()) / (1000 * 60);

    // Default break calculation (can be customized based on your rules)
    const breakMinutes = totalMinutes > 360 ? 30 : 0; // 30 min break for > 6 hours

    // Calculate actual work minutes
    const actualWorkMinutes = totalMinutes - breakMinutes;

    // Calculate shortfall/excess
    const difference = actualWorkMinutes - shiftMinutes;
    console.log(difference, "difference")

    return {
      totalWorkHours: await this.formatDuration(totalMinutes),
      breakHours: await this.formatDuration(breakMinutes),
      actualWorkHours: await this.formatDuration(actualWorkMinutes),
      shiftHours: await this.formatDuration(shiftMinutes),
      shortfallHours: difference < 0 ? await this.formatDuration(Math.abs(difference)) : '00:00:00',
      excessHours: difference > 0 ? await this.formatDuration(difference) : '00:00:00',
      hasShortfall: difference < 0,
      hasExcessHours: difference > 0
    };
  }


  private async formatDuration(minutes: number): Promise<string> {
    const hours = Math.floor(minutes / 60);
    const mins = Math.floor(minutes % 60);
    const secs = Math.floor((minutes % 1) * 60);
    console.log("return ", `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`)
    return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

  private async processOutOfWindowSwipe(
    record: IAttendanceRecord & Document,
    timestamp: Date,
    direction: 'IN' | 'OUT',
    reason: string,
    locationData?: {
      latitude: number;
      longitude: number;
      accuracy: number;
      altitude: number;
      address: string;
    }
  ): Promise<void> {
    // Add to outOfWindowSwipes array

    let outOfWindowSwipe = {
      timestamp,
      direction,
      deviceId: 'biometric',
      location: locationData || {
        latitude: 0,
        longitude: 0,
        accuracy: 0,
        altitude: 0,
        address: 'unknown'
      },
      reason
    }

    record.outOfWindowSwipes.push(outOfWindowSwipe);

    // Mark for regularization
    record.needsRegularization = true;

    // Update attendance status
    if (!record.attendanceStatus.includes('Out-Of-Window')) {
      record.attendanceStatus.push('Out-Of-Window');
    }
    console.log(record, "88 record ")
    await record.save();
  }


  async processSwipe(swipeData: ISwipeData): Promise<ISwipeResponse> {
    console.log('🔄 PROCESS SWIPE CALLED - Method 1');
    console.log('📍 Full swipeData received:', JSON.stringify(swipeData, null, 2));

    const { biometricId, timestamp, location, hasLocation, locationValid, locationAddress } = swipeData;

    console.log('📍 Extracted values:');
    console.log('  - biometricId:', biometricId);
    console.log('  - timestamp:', timestamp);
    console.log('  - location:', location);
    console.log('  - hasLocation:', hasLocation);
    console.log('  - locationValid:', locationValid);
    console.log('  - locationAddress:', locationAddress);

    // Extract location data from the swipe data
    let locationData = undefined;

    if (location) {
      // Use the provided location object directly
      locationData = location;
      console.log('✅ Using location object directly:', locationData);
    } else if (hasLocation && locationValid && locationAddress) {
      // If no location object but we have address, create location data with address
      locationData = {
        latitude: 0, // No GPS coordinates available
        longitude: 0,
        accuracy: 0,
        altitude: 0,
        address: locationAddress
      };
      console.log('⚠️ Using address-only location data:', locationData);
    } else {
      console.log('❌ No location data available');
    }

    console.log('🎯 Final locationData being used:', locationData);

    try {
      // 1. Validate user and get shift assignment
      const user = await this.getUserByBiometricId(biometricId);

      const shiftAssignment = await this.getCurrentShiftAssignment(user._id, timestamp);
      const shift = shiftAssignment.shiftId;

      // 2. Get shift window timings
      const shiftDay = new Date(timestamp);
      shiftDay.setUTCHours(0, 0, 0, 0);
      const shiftWindow = this.getShiftTimings(shift, shiftDay);
      console.log(user.name, "username", shiftAssignment, "shiftAssignment")
      // 3. Get or create attendance record
      const record = await this.findOrCreateAttendanceRecord(
        user._id,
        shift._id,
        shiftDay,
        shiftAssignment.shiftCode,
        shiftWindow.shiftStart,
        shiftWindow.shiftEnd
      );
      console.log(record, "record")
      // If it's a holiday, handle it differently
      if (record.status === 'holiday_swipe') {
        const swipe = {
          timestamp,
          direction: record.swipes.length === 0 ? 'IN' : 'OUT',
          deviceId: 'biometric',
          location: locationData || {
            latitude: 0,
            longitude: 0,
            accuracy: 0,
            altitude: 0,
            address: 'holiday_swipe'
          }
        };
        record.swipes.push({
          timestamp: swipe.timestamp,
          direction: swipe.direction as 'IN' | 'OUT',
          deviceId: swipe.deviceId || 'biometric',
          location: swipe.location
        });
        if (record.swipes.length === 1) {
          record.firstIn = timestamp;
        } else {
          record.lastOut = timestamp;
        }
        await record.save();
        return {
          success: true,
          message: 'Swipe recorded successfully for holiday',
          data: {
            userId: record.userId,
            shiftCode: record.shiftCode,
            shiftDay: record.shiftDay,
            swipeTime: timestamp,
            status: 'holiday_swipe',
            attendanceStatus: record.attendanceStatus,
            isWithinWindow: true,
            needsRegularization: false
          }
        };
      }

      // 4. Validate shift window
      const windowValidation = await this.validateAndUpdateWindowStatus(record, timestamp, shiftWindow);
      console.log(windowValidation, "windowValidation")
      // 5. Record swipe (IN or OUT) regardless of window validation
      const direction = record.swipes.length === 0 ? 'IN' : 'OUT';
      if (record.swipes.length >= 2) {
        return {
          success: false,
          message: 'Maximum swipes limit (2) reached for today'
        };
      }

      if (!windowValidation.isValid) {
        await this.processOutOfWindowSwipe(
          record,
          timestamp,
          direction,
          windowValidation.reason || 'Outside allowed window hours',
          locationData
        );
      }

      if (record.swipes.length === 0) {
        await this.processFirstSwipe(record, timestamp, shiftWindow, locationData);
      } else {
        await this.processSecondSwipe(record, timestamp, shiftWindow, locationData);
      }

      // 6. Return success response with out-of-window indication if applicable
      return {
        success: true,
        message: windowValidation.isValid
          ? 'Swipe processed successfully'
          : `Swipe recorded but outside window: ${windowValidation.reason}. Regularization required.`,
        data: {
          userId: record.userId,
          shiftCode: record.shiftCode,
          shiftDay: record.shiftDay,
          swipeTime: timestamp,
          isWithinWindow: record.isWithinWindow,
          firstIn: record.firstIn,
          lastOut: record.lastOut,
          totalWorkHours: record.totalWorkHours,
          breakHours: record.breakHours,
          actualWorkHours: record.actualWorkHours,
          shiftHours: record.shiftHours,
          shortfallHours: record.shortfallHours,
          excessHours: record.excessHours,
          isLateEntry: record.isLateEntry,
          isEarlyExit: record.isEarlyExit,
          status: record.status,
          attendanceStatus: record.attendanceStatus,
          needsRegularization: record.needsRegularization,
          outOfWindowSwipes: record.outOfWindowSwipes.map(swipe => ({
            timestamp: swipe.timestamp,
            direction: swipe.direction!,
            deviceId: swipe.deviceId!,
            location: swipe.location!,
            reason: swipe.reason!
          }))
        }
      };
    } catch (error: any) {
      console.error('Error processing swipe:', error);
      return {
        success: false,
        message: `Error processing swipe: ${error.message}`
      };
    }
  }


  async getAttendanceStatus(userId: string | Types.ObjectId, date: Date) {
    const shiftDay = new Date(date);
    shiftDay.setUTCHours(0, 0, 0, 0); // Normalize to start of UTC day

    // Call the shiftServiceAssignment to get shift assignment details



    const records = await AttendanceRecord.find({
      userId: typeof userId === 'string' ? new Types.ObjectId(userId) : userId,
      shiftDay,
    }).sort({ shiftCode: 1 });
    console.log(records, "getAttendanceStatus record")
    return {
      success: true,
      data: records.map(record => {
        // Ensure swipes array exists before trying to access its elements
        const swipes = record.swipes || [];
        return {
          shiftCode: record.shiftCode || null,
          status: record.status,
          excessHours: record.excessHours || '0:00:00',
          shortfallHours: record.shortfallHours || '0:00:00',
          // Always include these fields with null values if they don't exist
          firstSwipe: swipes.length > 0 ? swipes[0].timestamp : null,
          lastSwipe: swipes.length > 0 ? swipes[swipes.length - 1].timestamp : null,
        };
      }),
    };
  }

  async getAttendanceRecords(query: IAttendanceRecordsQuery) {
    const { startDate, endDate, userIds, page = 1, limit = 10 } = query;
    const skip = (page - 1) * limit;

    // Normalize dates to UTC day boundaries
    const utcStartDate = new Date(startDate);
    utcStartDate.setUTCHours(0, 0, 0, 0);

    const utcEndDate = new Date(endDate);
    utcEndDate.setUTCHours(23, 59, 59, 999);

    const baseQuery: any = {
      shiftDay: {
        $gte: utcStartDate,
        $lte: utcEndDate
      }
    };

    if (userIds?.length) {
      baseQuery.userId = {
        $in: userIds.map(id => new Types.ObjectId(id))
      };
    }

    // Calculate total days in the date range
    const totalDays = Math.ceil((utcEndDate.getTime() - utcStartDate.getTime()) / (1000 * 60 * 60 * 24));

    // Get all records for the period
    const allRecords = await AttendanceRecord.find(baseQuery)
      .populate('userId', 'name')
      .sort({ userId: 1, shiftDay: 1 })
      .lean(); // Add lean() for better performance

    console.log('Retrieved records ', allRecords);

    // Initialize Map to store user records
    const userRecords = new Map();

    // Process each record
    for (const record of allRecords) {
      if (!record.userId || !record.userId._id) {
        console.log('Skipping record with invalid userId:', record);
        continue;
      }

      const userId = record.userId._id.toString();
      const userName = (record.userId as any).name;

      // Initialize user record if it doesn't exist
      if (!userRecords.has(userId)) {
        userRecords.set(userId, {
          userId,
          userName,
          records: [],
          summary: {
            totalDays,
            lateDays: 0,
            presentDays: 0,
            regularisedDays: 0,
            leaveDays: 0
          }
        });
      }

      const userRecord = userRecords.get(userId);

      // Process the record
      const processedRecord = {
        _id: record._id,
        shiftId: record.shiftId,
        shiftDay: record.shiftDay,
        shiftStart: record.shiftStart,
        shiftEnd: record.shiftEnd,
        shiftCode: record.shiftCode,
        status: record.status,
        swipes: record.swipes,

        firstIn: record.firstIn,
        lastOut: record?.lastOut || null,
        attendanceStatus: record.attendanceStatus || [],

        isWithinWindow: record.isWithinWindow,
        isLateEntry: record.isLateEntry,
        isEarlyExit: record.isEarlyExit,
        needsRegularization: record.needsRegularization,
        excessHours: record.excessHours || '00:00:00',
        shortfallHours: record.shortfallHours || '00:00:00',
        totalWorkHours: record.totalWorkHours,
        breakHours: record.breakHours,
        actualWorkHours: record.actualWorkHours,
        shiftHours: record.shiftHours,
        outOfWindowSwipes: record.outOfWindowSwipes || []

      };

      // Add the processed record to user's records
      userRecord.records.push(processedRecord);

      // Update summary - now including all status types
      if (record.status) { // Count all records with a status
        userRecord.summary.presentDays++;
        if (record.attendanceStatus?.includes('Late')) {
          userRecord.summary.lateDays++;
        }
      }
      if (record.needsRegularization) {
        userRecord.summary.regularisedDays++;
      }
    }

    console.log('Users processed:', userRecords.size);

    // Convert Map to array and apply pagination
    const allUsers = Array.from(userRecords.values());
    console.log('Total users before pagination:', allUsers.length);

    const paginatedData = allUsers.slice(skip, skip + limit);
    console.log('Records after pagination:', paginatedData.length);

    return {
      success: true,
      data: paginatedData,
      meta: {
        page,
        limit,
        total: allUsers.length,
        totalPages: Math.ceil(allUsers.length / limit)
      }
    };
  }

  async getAttendanceAndShiftRecords(userId: string, dates: string[]): Promise<any> {
    try {
      console.log(userId, dates, "1 getAttendanceAndShiftRecords")
      // Convert dates to UTC start of the day
      const shiftDays = dates.map(date => {
        const shiftDay = new Date(date);
        shiftDay.setUTCHours(0, 0, 0, 0);
        return shiftDay;
      });
      console.log(shiftDays, "2 getAttendanceAndShiftRecords shiftDays")
      // Fetch attendance records for the given user and dates
      const attendanceRecords = await AttendanceRecord.find({
        userId: new Types.ObjectId(userId),
        shiftDay: { $in: shiftDays },
      }).lean();
      console.log(attendanceRecords, "3 getAttendanceAndShiftRecords attendanceRecords")
      // Fetch shift assignments for the given user and dates
      const shiftAssignments = await ShiftAssignment.find({
        userId: new Types.ObjectId(userId),
        $or: shiftDays.map(shiftDay => ({
          startDate: { $lte: shiftDay },
          $or: [{ endDate: { $gte: shiftDay } }, { endDate: null }],
        })),
      })
        .populate<{ shiftId: IShift }>('shiftId')
        .lean();
      console.log(shiftAssignments, "4 getAttendanceAndShiftRecords shiftAssignments")

      // Transform shiftAssignments to include only required fields in shiftId
      const transformedShiftAssignments = shiftAssignments.map(assignment => ({
        ...assignment,
        shiftId: assignment.shiftId
          ? {
            _id: assignment.shiftId._id,
            code: assignment.shiftId.code,
            startTime: assignment.shiftId.startTime,
            endTime: assignment.shiftId.endTime,
            shiftWindowStart: assignment.shiftId.shiftWindowStart,
            shiftWindowEnd: assignment.shiftId.shiftWindowEnd,
          }
          : null,
      }));
      console.log(transformedShiftAssignments, "5 getAttendanceAndShiftRecords transformedShiftAssignments")
      // Combine attendance and shift assignment data
      return {
        success: true,
        data: {
          attendanceRecords,
          shiftAssignments: transformedShiftAssignments,
        },
      };
    } catch (error: any) {
      console.error('Error fetching attendance and shift records:', error);
      return {
        success: false,
        message: error.message,
      };
    }
  }

  async insertBulkAttendanceRecords(userId: string[], month: number, year: number) {
    try {
      const shifts = {
        NOON: {
          shiftId: '67d7e4a6361b9b6799e3e3c4',
          shiftCode: 'NOON',
          startHour: 13,
          endHour: 22,
          gracePeriod: 15 // in minutes
        },
        MORN: {
          shiftId: '6810647b376481dc7bfa2127',
          shiftCode: 'MORN',
          startHour: 9,
          endHour: 18,
          gracePeriod: 15 // in minutes
        },
        GEN: {
          shiftId: '6810647b376481dc7bfa2127',
          shiftCode: 'GEN',
          startHour: 9,
          endHour: 18,
          gracePeriod: 15 // in minutes
        }
      };

      const bulkRecords = [];
      const endOfMonth = new Date(year, month, 0);

      for (const user of userId) {
        const userObjectId = new mongoose.Types.ObjectId(user);

        // Collect working days
        const workingDays: number[] = [];
        for (let i = 1; i <= endOfMonth.getDate(); i++) {
          const day = new Date(year, month - 1, i);
          const dow = day.getDay();
          if (dow !== 0 && dow !== 6) workingDays.push(i); // Exclude weekends
        }

        // Randomly select one day as LOP
        const lopDay = Math.random() < 0.5 ? workingDays[0] : workingDays[workingDays.length - 1];

        for (let i = 1; i <= endOfMonth.getDate(); i++) {
          const currentDate = new Date(year, month - 1, i);
          const dow = currentDate.getDay();

          if (dow === 0 || dow === 6 || i === lopDay) continue;

          // const shiftType = i % 2 === 0 ? 'NOON' : 'MORN';
          const shiftType = i % 2 === 0 ? 'GEN' : 'GEN';
          const shift = shifts[shiftType];

          // Shift start & end
          const shiftStart = new Date(currentDate);
          shiftStart.setHours(shift.startHour, 0, 0, 0);

          const shiftEnd = new Date(currentDate);
          shiftEnd.setHours(shift.endHour, 0, 0, 0);

          // Grace threshold = shift start + grace period
          const graceThreshold = new Date(shiftStart.getTime());
          graceThreshold.setMinutes(graceThreshold.getMinutes() + shift.gracePeriod);

          // Generate IN and OUT swipe times
          const firstIn = new Date(shiftStart.getTime());
          firstIn.setMinutes(firstIn.getMinutes() + Math.floor(Math.random() * 15));

          const lastOut = new Date(shiftEnd.getTime());
          lastOut.setMinutes(lastOut.getMinutes() - Math.floor(Math.random() * 15));

          // Calculate flags
          const isLateEntry = firstIn.getTime() > graceThreshold.getTime();
          const isEarlyExit = lastOut.getTime() < shiftEnd.getTime();

          const totalWorkHours = ((lastOut.getTime() - firstIn.getTime()) / (1000 * 60 * 60)).toFixed(2);
          const actualWorkHours = (parseFloat(totalWorkHours) - 1).toFixed(2); // assuming 1hr break
          const shortfallHours = (9 - parseFloat(totalWorkHours)).toFixed(2);

          bulkRecords.push({
            userId: userObjectId,
            shiftId: shift.shiftId,
            shiftCode: shift.shiftCode,
            shiftDay: currentDate,
            shiftStart,
            shiftEnd,
            swipes: [
              { timestamp: firstIn, direction: 'IN', deviceId: 'DEVICE_1', location: 'Main Gate' },
              { timestamp: lastOut, direction: 'OUT', deviceId: 'DEVICE_1', location: 'Main Gate' }
            ],
            firstIn,
            lastOut,
            isWithinWindow: true,
            isLateEntry,
            isEarlyExit,
            needsRegularization: false,
            totalWorkHours,
            breakHours: '01:00',
            actualWorkHours,
            shiftHours: '09:00',
            shortfallHours,
            excessHours: '0',
            status: 'complete',
            attendanceStatus: isLateEntry ? ['Late', 'Present'] : ['On-Time', 'Present'],
            outOfWindowSwipes: [],
            createdAt: new Date(),
            updatedAt: new Date()
          });
        }
      }

      await AttendanceRecord.insertMany(bulkRecords);
      return `Bulk attendance records inserted successfully: ${bulkRecords.length}`;
    } catch (error) {
      console.error('Attendance error:', error);
      return { error: 'Internal Server Error' };
    }
  }

  async getUserAttendanceByDateRanges(userId: string, startDate: string, endDate: string) {
    try {
      console.log("getUserAttendanceByDateRanges", userId, startDate, endDate)
      const userObjectId = new mongoose.Types.ObjectId(userId);
      const utcStartDate = new Date(startDate);
      utcStartDate.setUTCHours(0, 0, 0, 0);

      const utcEndDate = new Date(endDate);
      utcEndDate.setUTCHours(23, 59, 59, 999);

      const records = await AttendanceRecord.find({
        userId: userObjectId,
        shiftDay: {
          $gte: utcStartDate,
          $lte: utcEndDate
        }
      }).sort({ shiftDay: 1 }).lean();
      console.log("getUserAttendanceByDateRanges records")
      console.log(records, "getUserAttendanceByDateRanges records")
      console.log(records.length, "getUserAttendanceByDateRanges records length")
      return {
        success: true,
        data: records
      };
    } catch (error) {
      console.error('Error fetching user attendance:', error);
      return {
        success: false,
        message: 'Error fetching user attendance'
      };
    }
  }

  async deleteUserAttendanceByDateRanges(userId: string, startDate: string, endDate: string) {
    try {
      console.log("deleteUserAttendanceByDateRanges", userId, startDate, endDate)
      const userObjectId = new mongoose.Types.ObjectId(userId);
      const utcStartDate = new Date(startDate);
      utcStartDate.setUTCHours(0, 0, 0, 0);

      const utcEndDate = new Date(endDate);
      utcEndDate.setUTCHours(23, 59, 59, 999);

      const result = await AttendanceRecord.deleteMany({
        userId: userObjectId,
        shiftDay: {
          $gte: utcStartDate,
          $lte: utcEndDate
        }
      });

      console.log("deleteUserAttendanceByDateRanges result", result)
      return {
        success: true,
        message: `${result.deletedCount} attendance records deleted successfully`
      };
    } catch (error) {
      console.error('Error deleting user attendance:', error);
      return {
        success: false,
        message: 'Error deleting user attendance'
      };
    }
  }

  /**
   * Generate Weekly Report as Excel based on month
   * Calculates all weeks in the month (including overlapping weeks) and generates report with color coding
   */
  async generateWeeklyReportByMonth(month: string): Promise<Buffer> {
    try {
      // Parse month (YYYY-MM format)
      // Note: In YYYY-MM format, months are 1-indexed (01=January, 12=December)
      // JavaScript Date uses 0-indexed months (0=January, 11=December), so we subtract 1
      const [year, monthNum] = month.split('-').map(Number);
      if (!year || !monthNum || monthNum < 1 || monthNum > 12) {
        throw new Error('Invalid month format. Please use YYYY-MM format (e.g., 2025-11 for November 2025)');
      }

      // Calculate month boundaries (monthNum - 1 converts 1-indexed to 0-indexed for JavaScript Date)
      const firstDayOfMonth = new Date(Date.UTC(year, monthNum - 1, 1));
      const lastDayOfMonth = new Date(Date.UTC(year, monthNum, 0, 23, 59, 59, 999));

      // Calculate all weeks that fall within this month (including overlapping weeks)
      const weeks: Array<{ weekNumber: number; startDate: Date; endDate: Date }> = [];
      
      // Start from the first Monday before or on the first day of month
      const firstDay = new Date(firstDayOfMonth);
      const firstDayOfWeek = firstDay.getUTCDay(); // 0 = Sunday, 1 = Monday, etc.
      
      // Calculate the start of the week (Monday = 1, so we need to go back)
      // ISO week starts on Monday (1), but JavaScript Sunday is 0
      let daysToSubtract = firstDayOfWeek === 0 ? 6 : firstDayOfWeek - 1; // Convert to Monday-based
      const weekStart = new Date(firstDay);
      weekStart.setUTCDate(firstDay.getUTCDate() - daysToSubtract);
      weekStart.setUTCHours(0, 0, 0, 0);
      
      // Calculate week number for the first week
      const getWeekNumber = (date: Date): number => {
        const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
        d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
        const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
        return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
      };

      // Generate all weeks that overlap with the month
      let currentWeekStart = new Date(weekStart);
      let weekNumber = getWeekNumber(currentWeekStart);
      
      while (currentWeekStart <= lastDayOfMonth) {
        const currentWeekEnd = new Date(currentWeekStart);
        currentWeekEnd.setUTCDate(currentWeekEnd.getUTCDate() + 6);
        currentWeekEnd.setUTCHours(23, 59, 59, 999);
        
        // Only include weeks that have at least one day in the target month
        if (currentWeekEnd >= firstDayOfMonth && currentWeekStart <= lastDayOfMonth) {
          weeks.push({
            weekNumber,
            startDate: new Date(currentWeekStart),
            endDate: new Date(currentWeekEnd)
          });
        }
        
        // Move to next week
        currentWeekStart.setUTCDate(currentWeekStart.getUTCDate() + 7);
        weekNumber = getWeekNumber(currentWeekStart);
      }

      // Extended date range to cover all weeks
      const utcStartDate = weeks[0]?.startDate || firstDayOfMonth;
      const utcEndDate = weeks[weeks.length - 1]?.endDate || lastDayOfMonth;

      // Fetch ALL active users (not just those with attendance records)
      const allActiveUsers = await User.find({ active: true })
        .select('_id name employeeCode holidayCalendarId')
        .lean();

      if (allActiveUsers.length === 0) {
        throw new Error('No active users found');
      }

      const allUserIds = allActiveUsers.map(user => user._id.toString());

      // Fetch all attendance records for the date range
      const attendanceRecords = await AttendanceRecord.find({
        shiftDay: {
          $gte: utcStartDate,
          $lte: utcEndDate
        },
        userId: { $in: allUserIds.map(id => new Types.ObjectId(id)) }
      })
        .populate('userId', 'name employeeCode holidayCalendarId')
        .sort({ userId: 1, shiftDay: 1 })
        .lean();

      // Fetch shift assignments for all active users
      const shiftAssignments = await ShiftAssignment.find({
        userId: { $in: allUserIds.map(id => new Types.ObjectId(id)) },
        $or: [
          { endDate: null, startDate: { $lte: utcEndDate } },
          { startDate: { $lte: utcEndDate }, endDate: { $gte: utcStartDate } }
        ]
      })
        .lean();

      // Fetch holiday calendars for all active users
      const userHolidayCalendars = await HolidayCalendar.find({
        assignedTo: { $in: allUserIds.map(id => new Types.ObjectId(id)) },
        year: year
      })
        .lean();

      // Create maps for quick lookup
      const shiftAssignmentMap = new Map<string, any[]>();
      shiftAssignments.forEach(assignment => {
        const userId = assignment.userId.toString();
        if (!shiftAssignmentMap.has(userId)) {
          shiftAssignmentMap.set(userId, []);
        }
        shiftAssignmentMap.get(userId)!.push(assignment);
      });

      const holidayMap = new Map<string, Set<string>>(); // userId -> Set of holiday dates (YYYY-MM-DD)
      userHolidayCalendars.forEach(calendar => {
        calendar.assignedTo?.forEach(userId => {
          const userIdStr = userId.toString();
          if (!holidayMap.has(userIdStr)) {
            holidayMap.set(userIdStr, new Set());
          }
          calendar.holidays.forEach(holiday => {
            const holidayDate = new Date(holiday.date);
            const dateStr = `${holidayDate.getUTCFullYear()}-${String(holidayDate.getUTCMonth() + 1).padStart(2, '0')}-${String(holidayDate.getUTCDate()).padStart(2, '0')}`;
            holidayMap.get(userIdStr)!.add(dateStr);
          });
        });
      });

      // Helper function to get weekend days for a user in a week
      // If no shift assignment exists, default to [0,6] (Saturday and Sunday)
      const getWeekendDaysForWeek = (userId: string, weekStart: Date): number[] => {
        const assignments = shiftAssignmentMap.get(userId) || [];
        const weekendDaysSet = new Set<number>();
        let hasAssignment = false;
        
        // Check each day of the week
        for (let i = 0; i < 7; i++) {
          const checkDate = new Date(weekStart);
          checkDate.setUTCDate(checkDate.getUTCDate() + i);
          
          const activeAssignment = assignments.find(assignment => {
            const start = new Date(assignment.startDate);
            const end = assignment.endDate ? new Date(assignment.endDate) : new Date('2099-12-31');
            return checkDate >= start && checkDate <= end;
          });
          
          if (activeAssignment?.weekendDays) {
            hasAssignment = true;
            activeAssignment.weekendDays.forEach((day: number) => weekendDaysSet.add(day));
          }
        }
        
        // If no shift assignment found, default to [0,6] (Saturday and Sunday)
        if (!hasAssignment) {
          return [0, 6];
        }
        
        return Array.from(weekendDaysSet);
      };

      // Helper function to check if week has holidays
      const weekHasHoliday = (userId: string, weekStart: Date, weekEnd: Date): boolean => {
        const userHolidays = holidayMap.get(userId);
        if (!userHolidays) return false;
        
        for (let d = new Date(weekStart); d <= weekEnd; d.setUTCDate(d.getUTCDate() + 1)) {
          const dateStr = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
          if (userHolidays.has(dateStr)) {
            return true;
          }
        }
        return false;
      };

      // Helper function to convert time string (HH:mm:ss) to hours
      const timeStringToHours = (timeStr: string): number => {
        if (!timeStr || timeStr === '0:00:00') return 0;
        const parts = timeStr.split(':').map(Number);
        return parts[0] + (parts[1] / 60) + (parts[2] / 3600);
      };

      // Helper function to format hours to HH:mm
      const hoursToTimeString = (hours: number): string => {
        const h = Math.floor(hours);
        const m = Math.round((hours - h) * 60);
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
      };

      // Helper function to format date
      const formatDate = (date: Date): string => {
        const d = new Date(date);
        const day = String(d.getUTCDate()).padStart(2, '0');
        const year = d.getUTCFullYear();
        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        return `${day} ${monthNames[d.getUTCMonth()]} ${year}`;
      };

      // Group attendance records by user and week
      const userWeekData = new Map<string, Map<number, { records: any[]; totalHours: number }>>();
      
      attendanceRecords.forEach(record => {
        const userId = (record.userId as any)?._id 
          ? (record.userId as any)._id.toString() 
          : (record.userId as any).toString();
        
        // Find which week this record belongs to
        const recordDate = new Date(record.shiftDay);
        const week = weeks.find(w => 
          recordDate >= w.startDate && recordDate <= w.endDate
        );
        
        if (week) {
          if (!userWeekData.has(userId)) {
            userWeekData.set(userId, new Map());
          }
          
          const userWeeks = userWeekData.get(userId)!;
          if (!userWeeks.has(week.weekNumber)) {
            userWeeks.set(week.weekNumber, { records: [], totalHours: 0 });
          }
          
          const weekData = userWeeks.get(week.weekNumber)!;
          weekData.records.push(record);
          
          // Add hours to total
          const hours = timeStringToHours(record.actualWorkHours || record.totalWorkHours || '0:00:00');
          weekData.totalHours += hours;
        }
      });

      // Prepare Excel data - one row per employee, weeks as columns
      // Create a map: userId -> { employeeCode, name, weeks: { weekNumber: { hours, shouldBeRed } } }
      const employeeDataMap = new Map<string, {
        employeeCode: string;
        employeeName: string;
        weeks: Map<number, { hours: string; shouldBeRed: boolean }>;
      }>();

      // Initialize all active users
      allActiveUsers.forEach(user => {
        const userId = user._id.toString();
        employeeDataMap.set(userId, {
          employeeCode: user.employeeCode || '',
          employeeName: user.name || '',
          weeks: new Map()
        });
      });

      // Process each week for all users
      weeks.forEach(week => {
        allActiveUsers.forEach(user => {
          const userId = user._id.toString();
          const userWeekDataForWeek = userWeekData.get(userId)?.get(week.weekNumber);
          const totalHours = userWeekDataForWeek?.totalHours || 0;
          const hoursString = hoursToTimeString(totalHours);
          
          // Get weekend days for this week
          const weekendDays = getWeekendDaysForWeek(userId, week.startDate);
          const hasHoliday = weekHasHoliday(userId, week.startDate, week.endDate);
          
          // Determine color based on required hours
          let shouldBeRed = false;
          
          if (hasHoliday) {
            shouldBeRed = totalHours < 36;
          } else if (weekendDays.length === 2 && weekendDays.includes(0) && weekendDays.includes(6)) {
            // Weekend is [0,6] - Sat and Sun
            shouldBeRed = totalHours < 45;
          } else if (weekendDays.length === 1 && weekendDays.includes(0)) {
            // Weekend is [0] - Sunday only
            shouldBeRed = totalHours < 54;
          } else {
            // Default: 5 working days = 45 hours (9 hours per day)
            shouldBeRed = totalHours < 45;
          }
          
          const employeeData = employeeDataMap.get(userId)!;
          employeeData.weeks.set(week.weekNumber, {
            hours: hoursString,
            shouldBeRed: shouldBeRed
          });
        });
      });

      // Convert to array and sort by employee code
      const excelData = Array.from(employeeDataMap.values())
        .sort((a, b) => (a.employeeCode || '').localeCompare(b.employeeCode || ''));

      // Create Excel workbook
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Weekly Report');

      // Add company header
      const firstWeek = weeks[0];
      const lastWeek = weeks[weeks.length - 1];
      const totalCols = 2 + weeks.length; // Employee No, Name, and one column per week
      
      worksheet.mergeCells(`A1:${String.fromCharCode(64 + totalCols)}1`);
      const companyCell = worksheet.getCell('A1');
      companyCell.value = 'Cloud Desk Technology Private Limited';
      companyCell.font = { bold: true, size: 14 };
      companyCell.alignment = { horizontal: 'center', vertical: 'middle' };
      
      worksheet.mergeCells(`A2:${String.fromCharCode(64 + totalCols)}2`);
      const addressCell = worksheet.getCell('A2');
      addressCell.value = 'No: 51, TEK Meadows, Old Mahabalipuram Rd, Solinganallur, chennai, Tamilnadu-600119';
      addressCell.alignment = { horizontal: 'center', vertical: 'middle' };
      
      worksheet.mergeCells(`A3:${String.fromCharCode(64 + totalCols)}3`);
      const reportTitleCell = worksheet.getCell('A3');
      reportTitleCell.value = `Attendance Weekly Summary Report from ${formatDate(firstWeek.startDate)} to ${formatDate(lastWeek.endDate)}`;
      reportTitleCell.font = { bold: true };
      reportTitleCell.alignment = { horizontal: 'center', vertical: 'middle' };
      
      // Table headers row
      const headerRow = worksheet.getRow(5);
      headerRow.getCell(1).value = 'Employee No';
      headerRow.getCell(2).value = 'Name';
      
      // Add week headers
      weeks.forEach((week, index) => {
        const colIndex = 3 + index;
        const weekHeader = `Week ${week.weekNumber}\n${formatDate(week.startDate)} - ${formatDate(week.endDate)}`;
        headerRow.getCell(colIndex).value = weekHeader;
      });
      
      headerRow.font = { bold: true };
      headerRow.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE0E0E0' }
      };
      headerRow.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      headerRow.height = 40;
      
      // Data rows - one row per employee
      excelData.forEach((employee, rowIndex) => {
        const dataRow = worksheet.getRow(6 + rowIndex);
        dataRow.getCell(1).value = employee.employeeCode;
        dataRow.getCell(2).value = employee.employeeName;
        
        // Add hours for each week
        weeks.forEach((week, weekIndex) => {
          const colIndex = 3 + weekIndex;
          const weekData = employee.weeks.get(week.weekNumber);
          const hoursCell = dataRow.getCell(colIndex);
          
          if (weekData) {
            hoursCell.value = weekData.hours;
            // Apply color coding
            if (weekData.shouldBeRed) {
              hoursCell.font = { color: { argb: 'FFFF0000' } }; // Red
            } else {
              hoursCell.font = { color: { argb: 'FF000000' } }; // Black
            }
          } else {
            hoursCell.value = '00:00';
            hoursCell.font = { color: { argb: 'FFFF0000' } }; // Red for no data
          }
          hoursCell.alignment = { horizontal: 'center', vertical: 'middle' };
        });
      });
      
      // Set column widths
      worksheet.getColumn(1).width = 18; // Employee No
      worksheet.getColumn(2).width = 30; // Name
      weeks.forEach((_, index) => {
        worksheet.getColumn(3 + index).width = 18; // Each week column
      });

      // Generate Excel buffer
      const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
      return buffer;

    } catch (error: any) {
      console.error('Error generating weekly report:', error);
      throw new Error(`Failed to generate weekly report: ${error.message}`);
    }
  }

}


/*
  async processSwipe(swipeData: ISwipeData):Promise<ISwipeResponse> {
  const { biometricId, timestamp } = swipeData;
  console.log(timestamp, "0 timestamp")



  
  // Find user by biometric ID
  const user = await this.getUserByBiometricId(biometricId);

  // Get current shift assignment
  const shiftAssignment = await this.getCurrentShiftAssignment(user._id, timestamp);
  console.log(shiftAssignment, "1,shiftAssignmnet")
  const shift = shiftAssignment.shiftId;

  // Get shift timings
  const shiftDay = new Date(timestamp);
  shiftDay.setUTCHours(0, 0, 0, 0); // Normalize to start of UTC day

  const { shiftStart, shiftEnd, windowStart, windowEnd } = this.getShiftTimings(shift, shiftDay);

  console.log(timestamp, windowStart, windowEnd, "1.0 time,wS,wE")
  // Find or create attendance record
  const record = await this.findOrCreateAttendanceRecord(
    user._id,
    shift._id,
    shiftDay,
    shiftAssignment.shiftCode,
    shiftStart,
    shiftEnd
  );
  console.log(record, "2,record")
  // Initialize arrays if they don't exist
  if (!record.swipes) record.swipes = [];
  if (!record.outOfWindowSwipes) record.outOfWindowSwipes = [];
  if (!record.attendanceStatus) record.attendanceStatus = [];

  // Check if swipe is within window
  const isWithinWindow = timestamp >= windowStart && timestamp <= windowEnd;
  console.log(isWithinWindow, "3,isWithinWindow")
  if (!isWithinWindow) {
    // Determine if this is for previous day or next day's shift
    const prevDayWindowEnd = new Date(windowEnd);
    prevDayWindowEnd.setUTCDate(prevDayWindowEnd.getUTCDate() - 1);
    const nextDayWindowStart = new Date(windowStart);
    nextDayWindowStart.setUTCDate(nextDayWindowStart.getUTCDate() + 1);

    let targetShiftDay = shiftDay;
    let reason: 'before_window' | 'after_window';

    if (timestamp < windowStart) {
      // Check if it belongs to previous day's shift
      if (timestamp <= prevDayWindowEnd) {
        targetShiftDay = new Date(shiftDay);
        targetShiftDay.setUTCDate(targetShiftDay.getUTCDate() - 1);
      }
      reason = 'before_window';
    } else {
      // Check if it belongs to next day's shift
      if (timestamp >= nextDayWindowStart) {
        targetShiftDay = new Date(shiftDay);
        targetShiftDay.setUTCDate(targetShiftDay.getUTCDate() + 1);
      }
      reason = 'after_window';
    }

    // Add to out of window swipes
    record.outOfWindowSwipes.push({
      timestamp: timestamp,
      deviceId: 'biometric',
      location: 'unknown',
      reason: reason
    });
    record.needsRegularization = true;
  } else {
    console.log("else")
  }

  // Add swipe to record and determine type
  const isFirstSwipe = record.swipes.length === 0;
  const isLastSwipeOfDay = timestamp > shiftEnd; // Check if this is potentially a checkout swipe

  record.swipes.push({
    timestamp: timestamp,
    direction: isFirstSwipe ? 'IN' : 'OUT',
    deviceId: 'biometric',
    location: 'unknown',
  });

  // Update status
  if (isFirstSwipe) {
    record.isLateEntry = timestamp > shiftStart;
    record.attendanceStatus = record.isLateEntry ? ['Late'] : ['On-Time'];
  }

  if (isLastSwipeOfDay) {
    record.isEarlyExit = timestamp < shiftEnd;
    if (record.isEarlyExit) {
      record.attendanceStatus.push('Early-Exit');
    }
  }

  // Save record
  await record.save();

  console.log(record, "record")
  return {
    success: true,
    data: {
      userId: user._id,
      shiftCode: shiftAssignment.shiftCode,
      shiftDay: record.shiftDay,
      swipeTime: timestamp,
      isWithinWindow,
      isLateEntry: record.isLateEntry,
      isEarlyExit: record.isEarlyExit,
      needsRegularization: record.needsRegularization,
      status: record.status,
      attendanceStatus: record.attendanceStatus
    },
  };
}
   */
/*
  async getAttendanceRecords(query: IAttendanceRecordsQuery) {
  console.log(query?.userIds)
  const { startDate, endDate, userIds, page, limit } = query;
  const skip = (page - 1) * limit;

  // Normalize dates to UTC day boundaries
  const utcStartDate = new Date(startDate);
  utcStartDate.setUTCHours(0, 0, 0, 0);

  const utcEndDate = new Date(endDate);
  utcEndDate.setUTCHours(23, 59, 59, 999);
  // console.log("1 dates", utcStartDate, utcEndDate)
  // Create base query
  const baseQuery: any = {
    shiftDay: {
      $gte: utcStartDate,
      $lte: utcEndDate
    }
  };
  // console.log("1.1 basequery", baseQuery)
  // Add userIds filter if provided
  if (userIds?.length) {
    baseQuery.userId = {
      $in: userIds.map(id => new Types.ObjectId(id))
    };
  }

  // console.log("1.2 basequery", baseQuery)

  // Calculate total days in the date range
  const totalDays = Math.ceil((utcEndDate.getTime() - utcStartDate.getTime()) / (1000 * 60 * 60 * 24));
  console.log("1.3 total days", totalDays)
  // Get all records for the period without pagination when summary is requested
  const allRecords = await AttendanceRecord.find(baseQuery)
    .populate('userId', 'name')
    .sort({ userId: 1, shiftDay: 1 });

  console.log(allRecords, "2,allRecords")

  // Group records by user
  const userRecords = new Map<string, {
    userId: string;
    userName: string;
    records: any[];
    summary: {
      totalDays: number;
      lateDays: number;
      presentDays: number;
      regularisedDays: number;
      leaveDays: number;
    };
  }>();
  console.log("3.0 , userRec", userRecords)
  allRecords.forEach(record => {
    const userId = record.userId._id.toString();
    const userName = (record.userId as any).name;
    console.log("3.1, userId,name", userId, userName)
    if (!userRecords.has(userId)) {
      console.log("3.2 inside ")
      userRecords.set(userId, {
        userId,
        userName,
        records: [],
        summary: {
          totalDays,
          lateDays: 0,
          presentDays: 0,
          regularisedDays: 0,
          leaveDays: 0
        }
      });
    }
    console.log("3, userRecords", userRecords)
    const userRecord = userRecords.get(userId)!;
    console.log("3.5,userRecord", userRecord)
    // Add record data
    userRecord.records.push({
      shiftDay: record.shiftDay,
      shiftCode: record.shiftCode,
      status: record.status,
      excessHours: record.excessHours || '00:00:00',
      shortfallHours: record.shortfallHours || '00:00:00',
      firstSwipe: record.swipes[0]?.timestamp,
      lastSwipe: record.swipes[record.swipes.length - 1]?.timestamp,
      attendanceStatus: record.attendanceStatus
    });

    // Update summary
    if (record.status === 'complete') {
      userRecord.summary.presentDays++;
      if (record.attendanceStatus.includes('Late')) {
        userRecord.summary.lateDays++;
      }
    }
    if (record.needsRegularization) {
      userRecord.summary.regularisedDays++;
    }
  });

  // Convert to array and apply pagination
  const data = Array.from(userRecords.values())
    .slice(skip, skip + limit);

  return {
    success: true,
    data,
    meta: {
      page,
      limit,
      total: userRecords.size,
      totalPages: Math.ceil(userRecords.size / limit)
    }
  };
}
   */
