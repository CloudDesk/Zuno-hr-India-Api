import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { Domain, Skill, Vertical } from '../src/models';
import { normalizeSkillKey } from '../src/utilis/skill-normalization';

dotenv.config();

interface SeedSkillPayload {
  name: string;
  description?: string;
}

interface SeedDomainPayload {
  name: string;
  description?: string;
  skills: SeedSkillPayload[];
}

interface SeedVerticalPayload {
  name: string;
  description?: string;
  domains: SeedDomainPayload[];
}

const seedData: SeedVerticalPayload[] = [
  {
    name: 'IT & Software',
    domains: [
      {
        name: 'Salesforce',
        skills: [{ name: 'Apex' }, { name: 'LWC' }],
      },
    ],
  },
  {
    name: 'Cloud & Infrastructure',
    domains: [
      {
        name: 'Azure',
        skills: [{ name: 'Azure VNet' }, { name: 'Azure Functions' }],
      },
    ],
  },
  {
    name: 'Manufacturing Operations',
    domains: [
      {
        name: 'CNC Operations',
        skills: [{ name: 'CNC Programming' }, { name: 'Machine Setup' }],
      },
    ],
  },
];

async function findVerticalByName(name: string) {
  return Vertical.findOne({ name }).collation({ locale: 'en', strength: 2 });
}

async function findDomainByName(verticalId: string, name: string) {
  return Domain.findOne({ verticalId, name }).collation({ locale: 'en', strength: 2 });
}

async function upsertSkill(domainId: string, skillPayload: SeedSkillPayload) {
  const normalizedKey = normalizeSkillKey(skillPayload.name);
  const existing = await Skill.findOne({
    domainId,
    normalizedKey,
  });

  if (existing) {
    existing.name = skillPayload.name.trim();
    existing.description = skillPayload.description?.trim();
    existing.isActive = true;
    await existing.save();
    return existing;
  }

  return Skill.create({
    domainId,
    name: skillPayload.name.trim(),
    description: skillPayload.description?.trim(),
    normalizedKey,
    aliases: [],
    isActive: true,
  });
}

async function upsertDomain(verticalId: string, domainPayload: SeedDomainPayload) {
  const existing = await findDomainByName(verticalId, domainPayload.name);

  if (existing) {
    existing.description = domainPayload.description?.trim();
    existing.isActive = true;
    await existing.save();
    return existing;
  }

  return Domain.create({
    verticalId,
    name: domainPayload.name.trim(),
    description: domainPayload.description?.trim(),
    isActive: true,
  });
}

async function upsertVertical(verticalPayload: SeedVerticalPayload) {
  const existing = await findVerticalByName(verticalPayload.name);

  if (existing) {
    existing.description = verticalPayload.description?.trim();
    existing.isActive = true;
    await existing.save();
    return existing;
  }

  return Vertical.create({
    name: verticalPayload.name.trim(),
    description: verticalPayload.description?.trim(),
    isActive: true,
  });
}

async function seedSkillsModule(): Promise<void> {
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    throw new Error('MONGODB_URI is required to run seed script');
  }

  await mongoose.connect(mongoUri);
  console.log('[skills-seed] Connected to MongoDB');

  for (const verticalPayload of seedData) {
    const vertical = await upsertVertical(verticalPayload);
    console.log(`[skills-seed] Vertical ready: ${vertical.name}`);

    for (const domainPayload of verticalPayload.domains) {
      const domain = await upsertDomain(String(vertical._id), domainPayload);
      console.log(`[skills-seed] Domain ready: ${domain.name}`);

      for (const skillPayload of domainPayload.skills) {
        const skill = await upsertSkill(String(domain._id), skillPayload);
        console.log(`[skills-seed] Skill ready: ${skill.name}`);
      }
    }
  }

  await mongoose.disconnect();
  console.log('[skills-seed] Seed completed');
}

seedSkillsModule().catch(async (error) => {
  console.error('[skills-seed] Failed:', error);
  await mongoose.disconnect();
  process.exit(1);
});
