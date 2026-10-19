import { createDb } from "./db";

// createDb() runs the migrations against DATABASE_URL (called before start on Railway).
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const h = await createDb(url);
await h.close();
console.log("migrations applied");
