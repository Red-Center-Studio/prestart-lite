import { drizzle } from "drizzle-orm/d1";
import { schema } from "./schema";

export const getDb = (d1: D1Database) => drizzle(d1, { schema });
export type DB = ReturnType<typeof getDb>;
