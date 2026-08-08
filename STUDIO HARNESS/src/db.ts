import { sqlite } from "@flue/runtime/node";

export default sqlite(process.env.PROJECT_STUDIO_DB_PATH ?? "./data/flue.db");
