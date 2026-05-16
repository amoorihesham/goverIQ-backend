import { relations } from 'drizzle-orm';
import { pgTable, uuid, text, numeric, boolean, timestamp, pgEnum, uniqueIndex, index } from 'drizzle-orm/pg-core';

import { users } from './auth';

export const onboardingStepEnum = pgEnum('onboarding_step', ['PENDING_ROLES', 'PENDING_INVITES', 'COMPLETE']);

export const invitationStatusEnum = pgEnum('invitation_status', ['PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED']);

export const organizations = pgTable(
  'organizations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    nameLower: text('name_lower').notNull().unique(),
    slug: text('slug').notNull().unique(),
    description: text('description'),
    logoUrl: text('logo_url'),
    quorumThreshold: numeric('quorum_threshold', { precision: 3, scale: 2 }).notNull().default('0.50'),
    onboardingStep: onboardingStepEnum('onboarding_step').notNull().default('PENDING_ROLES'),
    archivedAt: timestamp('archived_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    nameLowerIdx: uniqueIndex('organizations_name_lower_idx').on(table.nameLower),
    slugIdx: uniqueIndex('organizations_slug_idx').on(table.slug),
  }),
);

export const roles = pgTable(
  'roles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    isOwner: boolean('is_owner').notNull().default(false),
    permissions: text('permissions').array().notNull().default([]),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    orgIdIdx: index('roles_org_idx').on(table.orgId),
    orgNameUnique: uniqueIndex('roles_org_name_unique').on(table.orgId, table.name),
  }),
);

export const memberships = pgTable(
  'memberships',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    roleId: uuid('role_id').references(() => roles.id, { onDelete: 'set null' }),
    joinedAt: timestamp('joined_at').notNull().defaultNow(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    userOrgUnique: uniqueIndex('memberships_user_org_unique').on(table.userId, table.orgId),
  }),
);

export const invitations = pgTable(
  'invitations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    status: invitationStatusEnum('status').notNull().default('PENDING'),
    expiresAt: timestamp('expires_at').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    tokenHashIdx: uniqueIndex('invitations_token_hash_idx').on(table.tokenHash),
    orgEmailIdx: index('invitations_org_email_idx').on(table.orgId, table.email),
  }),
);

export const rolesRelations = relations(roles, ({ one, many }) => ({
  org: one(organizations, {
    fields: [roles.orgId],
    references: [organizations.id],
  }),
  memberships: many(memberships),
}));

export const membershipsRelations = relations(memberships, ({ one }) => ({
  user: one(users, {
    fields: [memberships.userId],
    references: [users.id],
  }),
  org: one(organizations, {
    fields: [memberships.orgId],
    references: [organizations.id],
  }),
  role: one(roles, {
    fields: [memberships.roleId],
    references: [roles.id],
  }),
}));
