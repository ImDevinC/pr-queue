import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default("0.0.0.0"),
  DATABASE_URL: z.string().min(1),
  CONFIG_PATH: z.string().default("./config/queue.yaml"),
  GITHUB_APP_ID: z.coerce.number().int().positive(),
  GITHUB_APP_PRIVATE_KEY: z.string().min(1),
  GITHUB_WEBHOOK_SECRET: z.string().min(1),
  GITHUB_API_URL: z.string().url().default("https://api.github.com"),
  SLACK_BOT_TOKEN: z.string().min(1),
  SLACK_SIGNING_SECRET: z.string().min(1),
});

export type Environment = z.infer<typeof envSchema>;

export function loadEnvironment(
  source: NodeJS.ProcessEnv = process.env,
): Environment {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    throw new Error(`Invalid environment: ${result.error.message}`);
  }
  return result.data;
}
