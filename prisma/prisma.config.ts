import { defineConfig } from '@prisma/cli'

export default defineConfig({
  datasource: {
    adapter: 'postgresql',
    url: process.env.DATABASE_URL,
  },
}