import { Types } from 'mongoose';
import { WFHSummary, IWFHSummary } from '../models/wfh-summary.model';
import { BaseService } from './base.service';
import { RequestContext } from '../types/context';

export class WFHSummaryService extends BaseService {
  constructor(context: RequestContext) {
    super(context);
  }

  async createOrUpdateWFHSummary(
    userId: Types.ObjectId,
    year: number,
    updates: {
      alloted?: number;
      availed?: number;
      wfhRequestId?: Types.ObjectId;
    }
  ): Promise<IWFHSummary> {
    // First, ensure the document exists (create if it doesn't)
    let summary = await WFHSummary.findOne({ userId, year });
    
    if (!summary) {
      summary = await WFHSummary.create({
        userId,
        year,
        wfh: { alloted: 0, availed: 0, remaining: 0, wfhRequests: [] },
      });
    }

    // Build update object for wfh
    // Convert to plain object if it's a Mongoose subdocument
    const currentWfh = summary.wfh as any;
    const wfhUpdate: any = {
      alloted: currentWfh.alloted || 0,
      availed: currentWfh.availed || 0,
      remaining: currentWfh.remaining || 0,
      wfhRequests: currentWfh.wfhRequests || [],
    };

    if (updates.alloted !== undefined) {
      wfhUpdate.alloted = updates.alloted;
      wfhUpdate.remaining = Math.max(0, updates.alloted - (wfhUpdate.availed || 0));
    }

    if (updates.availed !== undefined) {
      wfhUpdate.availed = updates.availed;
      const currentAlloted = wfhUpdate.alloted || 0;
      wfhUpdate.remaining = Math.max(0, currentAlloted - updates.availed);
    }

    if (updates.wfhRequestId) {
      const currentRequests = wfhUpdate.wfhRequests || [];
      if (!currentRequests.some((id: Types.ObjectId) => id.toString() === updates.wfhRequestId!.toString())) {
        wfhUpdate.wfhRequests = [...currentRequests, updates.wfhRequestId];
      }
    }

    // Update the document
    const updatedSummary = await WFHSummary.findOneAndUpdate(
      { userId, year },
      { $set: { wfh: wfhUpdate } },
      { new: true }
    );

    if (!updatedSummary) {
      throw new Error('WFH summary not found');
    }

    return updatedSummary;
  }

  async getWFHSummary(userId: Types.ObjectId, year: number): Promise<IWFHSummary> {
    let summary = await WFHSummary.findOne({ userId, year });
    if (!summary) {
      summary = new WFHSummary({
        userId,
        year,
        wfh: { alloted: 0, availed: 0, remaining: 0, wfhRequests: [] },
      });
    }
    return summary;
  }

  async updateWFHAllotments(
    userId: Types.ObjectId,
    year: number,
    alloted: number
  ): Promise<IWFHSummary> {
    return this.createOrUpdateWFHSummary(userId, year, { alloted });
  }

  async getWFHBalance(userId: Types.ObjectId, year: number): Promise<{
    alloted: number;
    availed: number;
    remaining: number;
  }> {
    const summary = await this.getWFHSummary(userId, year);
    return {
      alloted: summary.wfh.alloted || 0,
      availed: summary.wfh.availed || 0,
      remaining: summary.wfh.remaining || 0,
    };
  }
}

