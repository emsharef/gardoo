import {
  pgTable,
  pgEnum,
  uuid,
  text,
  real,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// ─── Enums ───────────────────────────────────────────────────────────────────

export const aiProviderEnum = pgEnum("ai_provider", ["claude", "kimi"]);

export const targetTypeEnum = pgEnum("target_type", ["zone", "plant"]);

export const actionTypeEnum = pgEnum("action_type", [
  "water",
  "fertilize",
  "harvest",
  "prune",
  "plant",
  "monitor",
  "protect",
  "other",
]);

export const priorityEnum = pgEnum("priority", [
  "urgent",
  "today",
  "upcoming",
  "informational",
]);

export const analysisScopeEnum = pgEnum("analysis_scope", [
  "zone",
  "plant",
  "garden",
]);

// ─── JSON Column Types ───────────────────────────────────────────────────────

export interface UserSettings {
  timezone?: string;
  hardinessZone?: string;
  skillLevel?: string;
}

export interface CareProfile {
  waterFrequencyDays?: number;
  sunNeeds?: string;
  fertilizerNotes?: string;
  companionPlants?: string[];
  incompatiblePlants?: string[];
}

export interface AnalysisAction {
  targetType: string;
  targetId: string;
  actionType: string;
  priority: string;
  label: string;
  suggestedDate?: string;
  context?: string;
  recurrence?: string;
}

export interface AnalysisResult {
  actions: AnalysisAction[];
  observations: string[];
  alerts: string[];
}

export interface TokenUsage {
  input: number;
  output: number;
}

// ─── Tables ──────────────────────────────────────────────────────────────────

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").unique().notNull(),
  passwordHash: text("password_hash").notNull(),
  settings: jsonb("settings").$type<UserSettings>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const apiKeys = pgTable("api_keys", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  provider: aiProviderEnum("provider").notNull(),
  encryptedKey: text("encrypted_key").notNull(),
  iv: text("iv").notNull(),
  authTag: text("auth_tag").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const gardens = pgTable("gardens", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  locationLat: real("location_lat"),
  locationLng: real("location_lng"),
  hardinessZone: text("hardiness_zone"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const zones = pgTable("zones", {
  id: uuid("id").primaryKey().defaultRandom(),
  gardenId: uuid("garden_id")
    .notNull()
    .references(() => gardens.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  photoUrl: text("photo_url"),
  soilType: text("soil_type"),
  sunExposure: text("sun_exposure"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const plants = pgTable("plants", {
  id: uuid("id").primaryKey().defaultRandom(),
  zoneId: uuid("zone_id")
    .notNull()
    .references(() => zones.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  variety: text("variety"),
  species: text("species"),
  datePlanted: timestamp("date_planted"),
  growthStage: text("growth_stage"),
  photoUrl: text("photo_url"),
  careProfile: jsonb("care_profile").$type<CareProfile>(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const careLogs = pgTable("care_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  targetType: targetTypeEnum("target_type").notNull(),
  targetId: uuid("target_id").notNull(),
  actionType: actionTypeEnum("action_type").notNull(),
  notes: text("notes"),
  photoUrl: text("photo_url"),
  loggedAt: timestamp("logged_at").defaultNow().notNull(),
});

export const sensors = pgTable("sensors", {
  id: uuid("id").primaryKey().defaultRandom(),
  zoneId: uuid("zone_id")
    .notNull()
    .references(() => zones.id, { onDelete: "cascade" }),
  haEntityId: text("ha_entity_id").notNull(),
  sensorType: text("sensor_type").notNull(),
  lastReading: jsonb("last_reading"),
  lastReadAt: timestamp("last_read_at"),
});

export const sensorReadings = pgTable("sensor_readings", {
  id: uuid("id").primaryKey().defaultRandom(),
  sensorId: uuid("sensor_id")
    .notNull()
    .references(() => sensors.id, { onDelete: "cascade" }),
  value: real("value").notNull(),
  unit: text("unit").notNull(),
  recordedAt: timestamp("recorded_at").defaultNow().notNull(),
});

export const analysisResults = pgTable("analysis_results", {
  id: uuid("id").primaryKey().defaultRandom(),
  gardenId: uuid("garden_id")
    .notNull()
    .references(() => gardens.id, { onDelete: "cascade" }),
  scope: analysisScopeEnum("scope").notNull(),
  targetId: uuid("target_id"),
  result: jsonb("result").$type<AnalysisResult>().notNull(),
  modelUsed: text("model_used"),
  tokensUsed: jsonb("tokens_used").$type<TokenUsage>(),
  generatedAt: timestamp("generated_at").defaultNow().notNull(),
});

export const weatherCache = pgTable("weather_cache", {
  id: uuid("id").primaryKey().defaultRandom(),
  gardenId: uuid("garden_id")
    .notNull()
    .references(() => gardens.id, { onDelete: "cascade" }),
  forecast: jsonb("forecast").notNull(),
  fetchedAt: timestamp("fetched_at").defaultNow().notNull(),
});

// ─── Relations ───────────────────────────────────────────────────────────────

export const usersRelations = relations(users, ({ many }) => ({
  apiKeys: many(apiKeys),
  gardens: many(gardens),
}));

export const apiKeysRelations = relations(apiKeys, ({ one }) => ({
  user: one(users, {
    fields: [apiKeys.userId],
    references: [users.id],
  }),
}));

export const gardensRelations = relations(gardens, ({ one, many }) => ({
  user: one(users, {
    fields: [gardens.userId],
    references: [users.id],
  }),
  zones: many(zones),
  analysisResults: many(analysisResults),
  weatherCache: many(weatherCache),
}));

export const zonesRelations = relations(zones, ({ one, many }) => ({
  garden: one(gardens, {
    fields: [zones.gardenId],
    references: [gardens.id],
  }),
  plants: many(plants),
  sensors: many(sensors),
}));

export const plantsRelations = relations(plants, ({ one }) => ({
  zone: one(zones, {
    fields: [plants.zoneId],
    references: [zones.id],
  }),
}));

export const sensorsRelations = relations(sensors, ({ one, many }) => ({
  zone: one(zones, {
    fields: [sensors.zoneId],
    references: [zones.id],
  }),
  readings: many(sensorReadings),
}));

export const sensorReadingsRelations = relations(
  sensorReadings,
  ({ one }) => ({
    sensor: one(sensors, {
      fields: [sensorReadings.sensorId],
      references: [sensors.id],
    }),
  }),
);

export const analysisResultsRelations = relations(
  analysisResults,
  ({ one }) => ({
    garden: one(gardens, {
      fields: [analysisResults.gardenId],
      references: [gardens.id],
    }),
  }),
);

export const weatherCacheRelations = relations(weatherCache, ({ one }) => ({
  garden: one(gardens, {
    fields: [weatherCache.gardenId],
    references: [gardens.id],
  }),
}));
