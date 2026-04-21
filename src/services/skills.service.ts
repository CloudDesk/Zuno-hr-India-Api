import { Types } from 'mongoose';
import { BaseService } from './base.service';
import { RequestContext } from '../types/context';
import {
  Domain,
  EmployeeSkill,
  IDomain,
  IEmployeeSkill,
  ISkill,
  IVertical,
  Skill,
  User,
  Vertical,
} from '../models';
import { escapeRegex, normalizeAliases, normalizeSkillKey } from '../utilis/skill-normalization';
import {
  SkillsModuleError,
  ensureNonNegativeNumber,
  ensureObjectId,
  ensureOptionalDate,
  ensureOptionalString,
  ensureProficiencyLevel,
  ensureRequiredString,
  ensureStringArray,
  parseOptionalBoolean,
  parsePagination,
  parseSort,
} from '../validators/skills.validator';

interface PaginatedMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

interface PaginatedResult<T> {
  items: T[];
  meta: PaginatedMeta;
}

export interface IVerticalCreate {
  name: string;
  description?: string;
  isActive?: boolean;
}

export interface IVerticalUpdate {
  name?: string;
  description?: string;
  isActive?: boolean;
}

export interface IVerticalQuery {
  isActive?: boolean | string;
  search?: string;
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface IDomainCreate {
  verticalId: string;
  name: string;
  description?: string;
  isActive?: boolean;
}

export interface IDomainUpdate {
  verticalId?: string;
  name?: string;
  description?: string;
  isActive?: boolean;
}

export interface IDomainQuery {
  verticalId?: string;
  isActive?: boolean | string;
  search?: string;
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface ISkillCreate {
  domainId: string;
  name: string;
  description?: string;
  aliases?: string[];
  normalizedKey?: string;
  isActive?: boolean;
}

export interface ISkillUpdate {
  domainId?: string;
  name?: string;
  description?: string;
  aliases?: string[];
  normalizedKey?: string;
  isActive?: boolean;
}

export interface ISkillQuery {
  domainId?: string;
  verticalId?: string;
  search?: string;
  isActive?: boolean | string;
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface IEmployeeSkillCreate {
  employeeId: string;
  skillId: string;
  proficiencyLevel: number;
  yearsExperience: number;
  lastUsedOn?: Date | string;
  isCertified?: boolean;
  certificationName?: string;
  remarks?: string;
}

export interface IEmployeeSkillUpdate {
  employeeId?: string;
  skillId?: string;
  proficiencyLevel?: number;
  yearsExperience?: number;
  lastUsedOn?: Date | string | null;
  isCertified?: boolean;
  certificationName?: string;
  remarks?: string;
}

export interface IEmployeeSkillQuery {
  employeeId?: string;
  skillId?: string;
  domainId?: string;
  verticalId?: string;
  proficiencyLevel?: number;
  isCertified?: boolean | string;
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface IEmployeeSkillsByEmployeeQuery {
  grouped?: boolean | string;
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

interface IGroupedEmployeeSkill {
  employeeSkillId: string;
  skillId: string;
  name: string;
  normalizedKey: string;
  proficiencyLevel: number;
  yearsExperience: number;
  lastUsedOn?: Date;
  isCertified: boolean;
  certificationName?: string;
  remarks?: string;
}

interface IGroupedDomain {
  domainId: string;
  domainName: string;
  skills: IGroupedEmployeeSkill[];
}

interface IGroupedVertical {
  verticalId: string;
  verticalName: string;
  domains: IGroupedDomain[];
}

const NAME_COLLATION = { locale: 'en', strength: 2 } as const;

export class SkillsService extends BaseService {
  constructor(context: RequestContext) {
    super(context);
  }

  private buildMeta(page: number, limit: number, total: number): PaginatedMeta {
    return {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    };
  }

  private async ensureVerticalExists(verticalId: string): Promise<void> {
    ensureObjectId(verticalId, 'verticalId');
    const exists = await Vertical.exists({ _id: verticalId });
    if (!exists) {
      throw new SkillsModuleError('Vertical not found', 404);
    }
  }

  private async ensureDomainExists(domainId: string): Promise<void> {
    ensureObjectId(domainId, 'domainId');
    const exists = await Domain.exists({ _id: domainId });
    if (!exists) {
      throw new SkillsModuleError('Domain not found', 404);
    }
  }

  private async ensureSkillExists(skillId: string): Promise<void> {
    ensureObjectId(skillId, 'skillId');
    const exists = await Skill.exists({ _id: skillId });
    if (!exists) {
      throw new SkillsModuleError('Skill not found', 404);
    }
  }

  private async ensureEmployeeExists(employeeId: string): Promise<void> {
    ensureObjectId(employeeId, 'employeeId');
    const exists = await User.exists({ _id: employeeId });
    if (!exists) {
      throw new SkillsModuleError('Employee not found', 404);
    }
  }

  private buildSearchQuery(search?: string): RegExp | undefined {
    const trimmed = typeof search === 'string' ? search.trim() : '';
    if (!trimmed) {
      return undefined;
    }
    return new RegExp(escapeRegex(trimmed), 'i');
  }

  private async checkActiveVerticalNameUniqueness(
    name: string,
    excludeId?: string,
  ): Promise<void> {
    const filter: Record<string, unknown> = {
      name,
      isActive: true,
    };

    if (excludeId) {
      filter._id = { $ne: new Types.ObjectId(excludeId) };
    }

    const existing = await Vertical.findOne(filter).collation(NAME_COLLATION);
    if (existing) {
      throw new SkillsModuleError(
        'Active vertical with this name already exists',
        409,
      );
    }
  }

  private async checkActiveDomainNameUniqueness(
    verticalId: Types.ObjectId,
    name: string,
    excludeId?: string,
  ): Promise<void> {
    const filter: Record<string, unknown> = {
      verticalId,
      name,
      isActive: true,
    };

    if (excludeId) {
      filter._id = { $ne: new Types.ObjectId(excludeId) };
    }

    const existing = await Domain.findOne(filter).collation(NAME_COLLATION);
    if (existing) {
      throw new SkillsModuleError(
        'Active domain with this name already exists under the selected vertical',
        409,
      );
    }
  }

  private async checkActiveSkillUniqueness(
    domainId: Types.ObjectId,
    normalizedKey: string,
    excludeId?: string,
  ): Promise<void> {
    const filter: Record<string, unknown> = {
      domainId,
      normalizedKey,
      isActive: true,
    };

    if (excludeId) {
      filter._id = { $ne: new Types.ObjectId(excludeId) };
    }

    const existing = await Skill.findOne(filter);
    if (existing) {
      throw new SkillsModuleError(
        'Active skill with this normalized key already exists in the selected domain',
        409,
      );
    }
  }

  private async enrichSkill<T>(skill: T): Promise<T> {
    const skillDoc = skill as unknown as {
      populate: (populateOptions: unknown) => Promise<T>;
    };

    return skillDoc.populate({
      path: 'domainId',
      select: 'name verticalId isActive',
      populate: {
        path: 'verticalId',
        select: 'name isActive',
      },
    });
  }

  private async enrichEmployeeSkill<T>(employeeSkill: T): Promise<T> {
    const employeeSkillDoc = employeeSkill as unknown as {
      populate: (populateOptions: unknown) => Promise<T>;
    };

    return employeeSkillDoc.populate([
      {
        path: 'employeeId',
        select: 'name email employeeCode active',
      },
      {
        path: 'skillId',
        select: 'name normalizedKey domainId isActive aliases',
        populate: {
          path: 'domainId',
          select: 'name verticalId isActive',
          populate: {
            path: 'verticalId',
            select: 'name isActive',
          },
        },
      },
    ]);
  }

  private async getDomainIdsByFilter(
    domainId?: string,
    verticalId?: string,
  ): Promise<Types.ObjectId[] | undefined> {
    let scopedDomainIds: Types.ObjectId[] | undefined;

    if (domainId) {
      ensureObjectId(domainId, 'domainId');
      scopedDomainIds = [new Types.ObjectId(domainId)];
    }

    if (verticalId) {
      ensureObjectId(verticalId, 'verticalId');
      const domainRecords = await Domain.find({
        verticalId: new Types.ObjectId(verticalId),
      }).select('_id');
      const domainIdsForVertical = domainRecords.map((item) => item._id);

      if (scopedDomainIds) {
        scopedDomainIds = scopedDomainIds.filter((candidate) =>
          domainIdsForVertical.some((recordId) => recordId.equals(candidate)),
        );
      } else {
        scopedDomainIds = domainIdsForVertical;
      }
    }

    return scopedDomainIds;
  }

  private async getSkillIdsByHierarchyFilter(
    domainId?: string,
    verticalId?: string,
  ): Promise<Types.ObjectId[] | undefined> {
    const domainIds = await this.getDomainIdsByFilter(domainId, verticalId);
    if (!domainIds) {
      return undefined;
    }

    if (domainIds.length === 0) {
      return [];
    }

    const skills = await Skill.find({ domainId: { $in: domainIds } }).select('_id');
    return skills.map((item) => item._id);
  }

  private groupEmployeeSkills(employeeSkills: IEmployeeSkill[]): IGroupedVertical[] {
    const groupedByVertical = new Map<
      string,
      { vertical: IGroupedVertical; domainsMap: Map<string, IGroupedDomain> }
    >();

    for (const employeeSkill of employeeSkills) {
      const populatedSkill = employeeSkill.skillId as unknown as {
        _id?: Types.ObjectId;
        name?: string;
        normalizedKey?: string;
        domainId?: {
          _id?: Types.ObjectId;
          name?: string;
          verticalId?: {
            _id?: Types.ObjectId;
            name?: string;
          };
        };
      };

      const domain = populatedSkill?.domainId;
      const vertical = domain?.verticalId;

      if (!vertical?._id || !domain?._id || !populatedSkill?._id) {
        continue;
      }

      const verticalId = String(vertical._id);
      const domainId = String(domain._id);

      if (!groupedByVertical.has(verticalId)) {
        groupedByVertical.set(verticalId, {
          vertical: {
            verticalId,
            verticalName: vertical.name || '',
            domains: [],
          },
          domainsMap: new Map<string, IGroupedDomain>(),
        });
      }

      const verticalEntry = groupedByVertical.get(verticalId)!;
      if (!verticalEntry.domainsMap.has(domainId)) {
        const domainNode: IGroupedDomain = {
          domainId,
          domainName: domain.name || '',
          skills: [],
        };
        verticalEntry.domainsMap.set(domainId, domainNode);
        verticalEntry.vertical.domains.push(domainNode);
      }

      const domainEntry = verticalEntry.domainsMap.get(domainId)!;
      domainEntry.skills.push({
        employeeSkillId: String(employeeSkill._id),
        skillId: String(populatedSkill._id),
        name: populatedSkill.name || '',
        normalizedKey: populatedSkill.normalizedKey || '',
        proficiencyLevel: employeeSkill.proficiencyLevel,
        yearsExperience: employeeSkill.yearsExperience,
        lastUsedOn: employeeSkill.lastUsedOn,
        isCertified: employeeSkill.isCertified,
        certificationName: employeeSkill.certificationName,
        remarks: employeeSkill.remarks,
      });
    }

    return Array.from(groupedByVertical.values()).map((item) => item.vertical);
  }

  async createVertical(payload: IVerticalCreate): Promise<IVertical> {
    const name = ensureRequiredString(payload.name, 'name', 150);
    const description = ensureOptionalString(payload.description, 'description', 500);
    const isActive = payload.isActive ?? true;

    if (isActive) {
      await this.checkActiveVerticalNameUniqueness(name);
    }

    return Vertical.create({
      name,
      description,
      isActive,
    });
  }

  async findAllVerticals(query: IVerticalQuery): Promise<PaginatedResult<IVertical>> {
    const { page, limit, skip } = parsePagination(query.page, query.limit);
    const sort = parseSort(query.sortBy, query.sortOrder, 'name');
    const searchRegex = this.buildSearchQuery(query.search);

    const filter: Record<string, unknown> = {};
    const isActive = parseOptionalBoolean(query.isActive);
    if (typeof isActive === 'boolean') {
      filter.isActive = isActive;
    }

    if (searchRegex) {
      filter.$or = [
        { name: { $regex: searchRegex } },
        { description: { $regex: searchRegex } },
      ];
    }

    const [items, total] = await Promise.all([
      Vertical.find(filter).collation(NAME_COLLATION).sort(sort).skip(skip).limit(limit),
      Vertical.countDocuments(filter),
    ]);

    return {
      items,
      meta: this.buildMeta(page, limit, total),
    };
  }

  async findVerticalById(id: string): Promise<IVertical> {
    ensureObjectId(id, 'id');
    const vertical = await Vertical.findById(id);
    if (!vertical) {
      throw new SkillsModuleError('Vertical not found', 404);
    }
    return vertical;
  }

  async updateVertical(id: string, payload: IVerticalUpdate): Promise<IVertical> {
    ensureObjectId(id, 'id');
    const existingVertical = await Vertical.findById(id);
    if (!existingVertical) {
      throw new SkillsModuleError('Vertical not found', 404);
    }

    const updatePayload: Record<string, unknown> = {};
    const name = ensureOptionalString(payload.name, 'name', 150);
    const description = ensureOptionalString(payload.description, 'description', 500);

    if (name !== undefined) {
      updatePayload.name = name;
    }

    if (description !== undefined) {
      updatePayload.description = description;
    }

    if (typeof payload.isActive === 'boolean') {
      updatePayload.isActive = payload.isActive;
    }

    const nextName = name ?? existingVertical.name;
    const nextIsActive =
      typeof payload.isActive === 'boolean'
        ? payload.isActive
        : existingVertical.isActive;

    if (nextIsActive) {
      await this.checkActiveVerticalNameUniqueness(nextName, id);
    }

    const updatedVertical = await Vertical.findByIdAndUpdate(
      id,
      { $set: updatePayload },
      { new: true, runValidators: true },
    );

    if (!updatedVertical) {
      throw new SkillsModuleError('Vertical not found', 404);
    }

    return updatedVertical;
  }

  async updateVerticalStatus(id: string, isActive: boolean): Promise<IVertical> {
    ensureObjectId(id, 'id');
    const vertical = await Vertical.findById(id);

    if (!vertical) {
      throw new SkillsModuleError('Vertical not found', 404);
    }

    if (isActive) {
      await this.checkActiveVerticalNameUniqueness(vertical.name, id);
    }

    vertical.isActive = isActive;
    await vertical.save();

    return vertical;
  }

  async createDomain(payload: IDomainCreate): Promise<IDomain> {
    ensureObjectId(payload.verticalId, 'verticalId');
    const verticalId = new Types.ObjectId(payload.verticalId);
    await this.ensureVerticalExists(payload.verticalId);

    const name = ensureRequiredString(payload.name, 'name', 150);
    const description = ensureOptionalString(payload.description, 'description', 500);
    const isActive = payload.isActive ?? true;

    if (isActive) {
      await this.checkActiveDomainNameUniqueness(verticalId, name);
    }

    const domain = await Domain.create({
      verticalId,
      name,
      description,
      isActive,
    });

    return domain.populate({ path: 'verticalId', select: 'name isActive' });
  }

  async findAllDomains(query: IDomainQuery): Promise<PaginatedResult<IDomain>> {
    const { page, limit, skip } = parsePagination(query.page, query.limit);
    const sort = parseSort(query.sortBy, query.sortOrder, 'name');
    const searchRegex = this.buildSearchQuery(query.search);

    const filter: Record<string, unknown> = {};
    if (query.verticalId) {
      ensureObjectId(query.verticalId, 'verticalId');
      filter.verticalId = new Types.ObjectId(query.verticalId);
    }

    const isActive = parseOptionalBoolean(query.isActive);
    if (typeof isActive === 'boolean') {
      filter.isActive = isActive;
    }

    if (searchRegex) {
      filter.$or = [
        { name: { $regex: searchRegex } },
        { description: { $regex: searchRegex } },
      ];
    }

    const [items, total] = await Promise.all([
      Domain.find(filter)
        .collation(NAME_COLLATION)
        .populate({ path: 'verticalId', select: 'name isActive' })
        .sort(sort)
        .skip(skip)
        .limit(limit),
      Domain.countDocuments(filter),
    ]);

    return {
      items,
      meta: this.buildMeta(page, limit, total),
    };
  }

  async findDomainById(id: string): Promise<IDomain> {
    ensureObjectId(id, 'id');
    const domain = await Domain.findById(id).populate({
      path: 'verticalId',
      select: 'name isActive',
    });

    if (!domain) {
      throw new SkillsModuleError('Domain not found', 404);
    }

    return domain;
  }

  async updateDomain(id: string, payload: IDomainUpdate): Promise<IDomain> {
    ensureObjectId(id, 'id');
    const existingDomain = await Domain.findById(id);
    if (!existingDomain) {
      throw new SkillsModuleError('Domain not found', 404);
    }

    const updatePayload: Record<string, unknown> = {};
    const name = ensureOptionalString(payload.name, 'name', 150);
    const description = ensureOptionalString(payload.description, 'description', 500);

    let nextVerticalId = existingDomain.verticalId as Types.ObjectId;
    if (payload.verticalId) {
      ensureObjectId(payload.verticalId, 'verticalId');
      await this.ensureVerticalExists(payload.verticalId);
      nextVerticalId = new Types.ObjectId(payload.verticalId);
      updatePayload.verticalId = nextVerticalId;
    }

    if (name !== undefined) {
      updatePayload.name = name;
    }

    if (description !== undefined) {
      updatePayload.description = description;
    }

    if (typeof payload.isActive === 'boolean') {
      updatePayload.isActive = payload.isActive;
    }

    const nextName = name ?? existingDomain.name;
    const nextIsActive =
      typeof payload.isActive === 'boolean' ? payload.isActive : existingDomain.isActive;

    if (nextIsActive) {
      await this.checkActiveDomainNameUniqueness(nextVerticalId, nextName, id);
    }

    const updatedDomain = await Domain.findByIdAndUpdate(
      id,
      { $set: updatePayload },
      { new: true, runValidators: true },
    ).populate({
      path: 'verticalId',
      select: 'name isActive',
    });

    if (!updatedDomain) {
      throw new SkillsModuleError('Domain not found', 404);
    }

    return updatedDomain;
  }

  async updateDomainStatus(id: string, isActive: boolean): Promise<IDomain> {
    ensureObjectId(id, 'id');
    const domain = await Domain.findById(id);

    if (!domain) {
      throw new SkillsModuleError('Domain not found', 404);
    }

    if (isActive) {
      await this.checkActiveDomainNameUniqueness(
        domain.verticalId as Types.ObjectId,
        domain.name,
        id,
      );
    }

    domain.isActive = isActive;
    await domain.save();

    return domain.populate({ path: 'verticalId', select: 'name isActive' });
  }

  async createSkill(payload: ISkillCreate): Promise<ISkill> {
    ensureObjectId(payload.domainId, 'domainId');
    const domainId = new Types.ObjectId(payload.domainId);
    await this.ensureDomainExists(payload.domainId);

    const name = ensureRequiredString(payload.name, 'name', 150);
    const description = ensureOptionalString(payload.description, 'description', 500);
    const aliases = normalizeAliases(ensureStringArray(payload.aliases, 'aliases') || []);
    const normalizedKeyInput =
      ensureOptionalString(payload.normalizedKey, 'normalizedKey', 200) || name;
    const normalizedKey = normalizeSkillKey(normalizedKeyInput);
    const isActive = payload.isActive ?? true;

    if (!normalizedKey) {
      throw new SkillsModuleError('normalizedKey could not be generated', 400);
    }

    const filteredAliases = aliases.filter(
      (alias) => normalizeSkillKey(alias) !== normalizedKey,
    );

    if (isActive) {
      await this.checkActiveSkillUniqueness(domainId, normalizedKey);
    }

    const createdSkill = await Skill.create({
      domainId,
      name,
      description,
      aliases: filteredAliases,
      normalizedKey,
      isActive,
    });

    return this.enrichSkill(createdSkill);
  }

  async findAllSkills(query: ISkillQuery): Promise<PaginatedResult<ISkill>> {
    const { page, limit, skip } = parsePagination(query.page, query.limit);
    const sort = parseSort(query.sortBy, query.sortOrder, 'name');
    const searchRegex = this.buildSearchQuery(query.search);

    const filter: Record<string, unknown> = {};
    const scopedDomainIds = await this.getDomainIdsByFilter(
      query.domainId,
      query.verticalId,
    );

    if (scopedDomainIds && scopedDomainIds.length === 0) {
      return {
        items: [],
        meta: this.buildMeta(page, limit, 0),
      };
    }

    if (scopedDomainIds) {
      filter.domainId =
        scopedDomainIds.length === 1 ? scopedDomainIds[0] : { $in: scopedDomainIds };
    }

    const isActive = parseOptionalBoolean(query.isActive);
    if (typeof isActive === 'boolean') {
      filter.isActive = isActive;
    }

    if (searchRegex) {
      filter.$or = [
        { name: { $regex: searchRegex } },
        { aliases: { $regex: searchRegex } },
      ];
    }

    const [items, total] = await Promise.all([
      Skill.find(filter)
        .populate({
          path: 'domainId',
          select: 'name verticalId isActive',
          populate: {
            path: 'verticalId',
            select: 'name isActive',
          },
        })
        .sort(sort)
        .skip(skip)
        .limit(limit),
      Skill.countDocuments(filter),
    ]);

    return {
      items,
      meta: this.buildMeta(page, limit, total),
    };
  }

  async findSkillById(id: string): Promise<ISkill> {
    ensureObjectId(id, 'id');
    const skill = await Skill.findById(id).populate({
      path: 'domainId',
      select: 'name verticalId isActive',
      populate: {
        path: 'verticalId',
        select: 'name isActive',
      },
    });

    if (!skill) {
      throw new SkillsModuleError('Skill not found', 404);
    }

    return skill;
  }

  async updateSkill(id: string, payload: ISkillUpdate): Promise<ISkill> {
    ensureObjectId(id, 'id');
    const existingSkill = await Skill.findById(id);
    if (!existingSkill) {
      throw new SkillsModuleError('Skill not found', 404);
    }

    const updatePayload: Record<string, unknown> = {};
    let nextDomainId = existingSkill.domainId as Types.ObjectId;

    if (payload.domainId) {
      ensureObjectId(payload.domainId, 'domainId');
      await this.ensureDomainExists(payload.domainId);
      nextDomainId = new Types.ObjectId(payload.domainId);
      updatePayload.domainId = nextDomainId;
    }

    const name = ensureOptionalString(payload.name, 'name', 150);
    const description = ensureOptionalString(payload.description, 'description', 500);
    const normalizedKeyInput = ensureOptionalString(
      payload.normalizedKey,
      'normalizedKey',
      200,
    );

    if (name !== undefined) {
      updatePayload.name = name;
    }

    if (description !== undefined) {
      updatePayload.description = description;
    }

    if (typeof payload.isActive === 'boolean') {
      updatePayload.isActive = payload.isActive;
    }

    if (payload.aliases !== undefined) {
      const aliases = normalizeAliases(ensureStringArray(payload.aliases, 'aliases') || []);
      updatePayload.aliases = aliases;
    }

    const nextName = name ?? existingSkill.name;
    const nextNormalizedKey = normalizedKeyInput
      ? normalizeSkillKey(normalizedKeyInput)
      : name
        ? normalizeSkillKey(nextName)
        : existingSkill.normalizedKey;

    if (!nextNormalizedKey) {
      throw new SkillsModuleError('normalizedKey could not be generated', 400);
    }

    updatePayload.normalizedKey = nextNormalizedKey;

    if (updatePayload.aliases) {
      const aliases = updatePayload.aliases as string[];
      updatePayload.aliases = aliases.filter(
        (alias) => normalizeSkillKey(alias) !== nextNormalizedKey,
      );
    }

    const nextIsActive =
      typeof payload.isActive === 'boolean' ? payload.isActive : existingSkill.isActive;

    if (nextIsActive) {
      await this.checkActiveSkillUniqueness(nextDomainId, nextNormalizedKey, id);
    }

    const updatedSkill = await Skill.findByIdAndUpdate(
      id,
      { $set: updatePayload },
      { new: true, runValidators: true },
    ).populate({
      path: 'domainId',
      select: 'name verticalId isActive',
      populate: {
        path: 'verticalId',
        select: 'name isActive',
      },
    });

    if (!updatedSkill) {
      throw new SkillsModuleError('Skill not found', 404);
    }

    return updatedSkill;
  }

  async updateSkillStatus(id: string, isActive: boolean): Promise<ISkill> {
    ensureObjectId(id, 'id');
    const skill = await Skill.findById(id);
    if (!skill) {
      throw new SkillsModuleError('Skill not found', 404);
    }

    if (isActive) {
      await this.checkActiveSkillUniqueness(
        skill.domainId as Types.ObjectId,
        skill.normalizedKey,
        id,
      );
    }

    skill.isActive = isActive;
    await skill.save();

    return this.enrichSkill(skill);
  }

  async createEmployeeSkill(payload: IEmployeeSkillCreate): Promise<IEmployeeSkill> {
    ensureObjectId(payload.employeeId, 'employeeId');
    ensureObjectId(payload.skillId, 'skillId');

    await this.ensureEmployeeExists(payload.employeeId);
    await this.ensureSkillExists(payload.skillId);

    const proficiencyLevel = ensureProficiencyLevel(payload.proficiencyLevel);
    const yearsExperience = ensureNonNegativeNumber(
      payload.yearsExperience,
      'yearsExperience',
    );
    const lastUsedOn = ensureOptionalDate(payload.lastUsedOn, 'lastUsedOn');
    const isCertified = payload.isCertified ?? false;
    const certificationName = ensureOptionalString(
      payload.certificationName,
      'certificationName',
      200,
    );
    const remarks = ensureOptionalString(payload.remarks, 'remarks', 1000);

    const existing = await EmployeeSkill.findOne({
      employeeId: new Types.ObjectId(payload.employeeId),
      skillId: new Types.ObjectId(payload.skillId),
    });

    if (existing) {
      throw new SkillsModuleError(
        'Employee skill mapping already exists for this employee and skill',
        409,
      );
    }

    const createdEmployeeSkill = await EmployeeSkill.create({
      employeeId: new Types.ObjectId(payload.employeeId),
      skillId: new Types.ObjectId(payload.skillId),
      proficiencyLevel,
      yearsExperience,
      lastUsedOn,
      isCertified,
      certificationName,
      remarks,
    });

    return this.enrichEmployeeSkill(createdEmployeeSkill);
  }

  async findAllEmployeeSkills(
    query: IEmployeeSkillQuery,
  ): Promise<PaginatedResult<IEmployeeSkill>> {
    const { page, limit, skip } = parsePagination(query.page, query.limit);
    const sort = parseSort(query.sortBy, query.sortOrder, 'createdAt');

    const filter: Record<string, unknown> = {};
    if (query.employeeId) {
      ensureObjectId(query.employeeId, 'employeeId');
      filter.employeeId = new Types.ObjectId(query.employeeId);
    }

    if (query.skillId) {
      ensureObjectId(query.skillId, 'skillId');
      filter.skillId = new Types.ObjectId(query.skillId);
    }

    if (query.proficiencyLevel !== undefined) {
      filter.proficiencyLevel = ensureProficiencyLevel(query.proficiencyLevel);
    }

    const isCertified = parseOptionalBoolean(query.isCertified);
    if (typeof isCertified === 'boolean') {
      filter.isCertified = isCertified;
    }

    const scopedSkillIds = await this.getSkillIdsByHierarchyFilter(
      query.domainId,
      query.verticalId,
    );

    if (scopedSkillIds && scopedSkillIds.length === 0) {
      return {
        items: [],
        meta: this.buildMeta(page, limit, 0),
      };
    }

    if (scopedSkillIds) {
      const directSkillFilter = filter.skillId as Types.ObjectId | undefined;
      if (directSkillFilter) {
        const allowed = scopedSkillIds.some((skillId) => skillId.equals(directSkillFilter));
        if (!allowed) {
          return {
            items: [],
            meta: this.buildMeta(page, limit, 0),
          };
        }
      } else {
        filter.skillId =
          scopedSkillIds.length === 1 ? scopedSkillIds[0] : { $in: scopedSkillIds };
      }
    }

    const [items, total] = await Promise.all([
      EmployeeSkill.find(filter)
        .populate([
          {
            path: 'employeeId',
            select: 'name email employeeCode active',
          },
          {
            path: 'skillId',
            select: 'name normalizedKey domainId isActive aliases',
            populate: {
              path: 'domainId',
              select: 'name verticalId isActive',
              populate: {
                path: 'verticalId',
                select: 'name isActive',
              },
            },
          },
        ])
        .sort(sort)
        .skip(skip)
        .limit(limit),
      EmployeeSkill.countDocuments(filter),
    ]);

    return {
      items,
      meta: this.buildMeta(page, limit, total),
    };
  }

  async findEmployeeSkillById(id: string): Promise<IEmployeeSkill> {
    ensureObjectId(id, 'id');
    const employeeSkill = await EmployeeSkill.findById(id).populate([
      {
        path: 'employeeId',
        select: 'name email employeeCode active',
      },
      {
        path: 'skillId',
        select: 'name normalizedKey domainId isActive aliases',
        populate: {
          path: 'domainId',
          select: 'name verticalId isActive',
          populate: {
            path: 'verticalId',
            select: 'name isActive',
          },
        },
      },
    ]);

    if (!employeeSkill) {
      throw new SkillsModuleError('Employee skill mapping not found', 404);
    }

    return employeeSkill;
  }

  async updateEmployeeSkill(
    id: string,
    payload: IEmployeeSkillUpdate,
  ): Promise<IEmployeeSkill> {
    ensureObjectId(id, 'id');
    const existingEmployeeSkill = await EmployeeSkill.findById(id);
    if (!existingEmployeeSkill) {
      throw new SkillsModuleError('Employee skill mapping not found', 404);
    }

    const updatePayload: Record<string, unknown> = {};
    let nextEmployeeId = existingEmployeeSkill.employeeId as Types.ObjectId;
    let nextSkillId = existingEmployeeSkill.skillId as Types.ObjectId;

    if (payload.employeeId) {
      ensureObjectId(payload.employeeId, 'employeeId');
      await this.ensureEmployeeExists(payload.employeeId);
      nextEmployeeId = new Types.ObjectId(payload.employeeId);
      updatePayload.employeeId = nextEmployeeId;
    }

    if (payload.skillId) {
      ensureObjectId(payload.skillId, 'skillId');
      await this.ensureSkillExists(payload.skillId);
      nextSkillId = new Types.ObjectId(payload.skillId);
      updatePayload.skillId = nextSkillId;
    }

    if (payload.proficiencyLevel !== undefined) {
      updatePayload.proficiencyLevel = ensureProficiencyLevel(payload.proficiencyLevel);
    }

    if (payload.yearsExperience !== undefined) {
      updatePayload.yearsExperience = ensureNonNegativeNumber(
        payload.yearsExperience,
        'yearsExperience',
      );
    }

    if (payload.lastUsedOn !== undefined) {
      updatePayload.lastUsedOn =
        payload.lastUsedOn === null
          ? null
          : ensureOptionalDate(payload.lastUsedOn, 'lastUsedOn');
    }

    if (payload.isCertified !== undefined) {
      if (typeof payload.isCertified !== 'boolean') {
        throw new SkillsModuleError('isCertified must be a boolean', 400);
      }
      updatePayload.isCertified = payload.isCertified;
    }

    if (payload.certificationName !== undefined) {
      updatePayload.certificationName = ensureOptionalString(
        payload.certificationName,
        'certificationName',
        200,
      );
    }

    if (payload.remarks !== undefined) {
      updatePayload.remarks = ensureOptionalString(payload.remarks, 'remarks', 1000);
    }

    const duplicate = await EmployeeSkill.findOne({
      _id: { $ne: new Types.ObjectId(id) },
      employeeId: nextEmployeeId,
      skillId: nextSkillId,
    });

    if (duplicate) {
      throw new SkillsModuleError(
        'Employee skill mapping already exists for this employee and skill',
        409,
      );
    }

    const updatedEmployeeSkill = await EmployeeSkill.findByIdAndUpdate(
      id,
      { $set: updatePayload },
      { new: true, runValidators: true },
    ).populate([
      {
        path: 'employeeId',
        select: 'name email employeeCode active',
      },
      {
        path: 'skillId',
        select: 'name normalizedKey domainId isActive aliases',
        populate: {
          path: 'domainId',
          select: 'name verticalId isActive',
          populate: {
            path: 'verticalId',
            select: 'name isActive',
          },
        },
      },
    ]);

    if (!updatedEmployeeSkill) {
      throw new SkillsModuleError('Employee skill mapping not found', 404);
    }

    return updatedEmployeeSkill;
  }

  async deleteEmployeeSkill(id: string): Promise<{ deletedId: string }> {
    ensureObjectId(id, 'id');
    const deleted = await EmployeeSkill.findByIdAndDelete(id);
    if (!deleted) {
      throw new SkillsModuleError('Employee skill mapping not found', 404);
    }

    return { deletedId: id };
  }

  async findEmployeeSkillsByEmployee(
    employeeId: string,
    query: IEmployeeSkillsByEmployeeQuery,
  ): Promise<PaginatedResult<IEmployeeSkill> | PaginatedResult<IGroupedVertical>> {
    await this.ensureEmployeeExists(employeeId);

    const listResult = await this.findAllEmployeeSkills({
      employeeId,
      page: query.page,
      limit: query.limit,
      sortBy: query.sortBy,
      sortOrder: query.sortOrder,
    });

    const grouped = parseOptionalBoolean(query.grouped) || false;
    if (!grouped) {
      return listResult;
    }

    return {
      items: this.groupEmployeeSkills(listResult.items),
      meta: listResult.meta,
    };
  }
}
